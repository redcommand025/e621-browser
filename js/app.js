import {
  buildSearchQuery,
  applyClientFilters,
  filterPools,
  filterPosts,
  filterSuggestions,
  collectTagsByCategory,
  formatPoolName,
  formatPostStats,
  formatTagCategoryLabel,
  isBlockedTag,
  isValidUsername,
  nameContainsBlockedTerm,
  poolResponseHasMore,
  poolDirectionOpen,
  shouldFetchMorePools,
  postChildIds,
  postHasActiveChildren,
  postParentId,
  postPoolIds,
  stepPoolIds,
  sanitizeUsername,
  tagName,
  tokenize,
} from "./filter.js?v=20261122i";
import {
  getItem,
  setItem,
  removeItem,
  isStoragePersistent,
} from "./storage.js?v=20261122i";
import {
  PAGE_LIMIT,
  POOL_PAGE_LIMIT,
  basicAuthUsername,
  clearBasicAuth,
  fetchAutocomplete,
  fetchPoolById,
  fetchPools,
  fetchPopular,
  fetchPosts,
  fetchPostsByIds,
  formatCount,
  hasBasicAuth,
  isVideoPost,
  originalUrl,
  postPageUrl,
  previewUrl,
  sampleImageUrl,
  setBasicAuth,
  verifyBasicAuth,
  videoSources,
} from "./api.js?v=20261122i";

const AGE_KEY = "e621-browser:age-ok";
const SAMPLE_KEY = "e621-browser:prefer-sample";
const BLACKLIST_KEY = "e621-browser:blacklist";
const FAV_USER_KEY = "e621-browser:fav-user";
const AUTH_USER_KEY = "e621-browser:auth-user";
const AUTH_KEY_KEY = "e621-browser:auth-key";
const SAVED_KEY = "e621-browser:saved-searches";
const AUTOCOMPLETE_MIN = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 350;
const MAX_APPENDED_PAGES = 5;
const MAX_PAGE = 750;
const POOL_FILL_MAX_EXTRA = 10;

const els = {
  gate: document.getElementById("age-gate"),
  declined: document.getElementById("age-declined"),
  confirm: document.getElementById("age-confirm"),
  decline: document.getElementById("age-decline"),
  app: document.getElementById("app"),
  form: document.getElementById("search-form"),
  search: document.getElementById("search"),
  suggest: document.getElementById("suggest"),
  rating: document.getElementById("rating"),
  sort: document.getElementById("sort"),
  preferSample: document.getElementById("prefer-sample"),
  subNav: document.getElementById("sub-nav"),
  blacklistPanel: document.getElementById("blacklist-panel"),
  blacklistForm: document.getElementById("blacklist-form"),
  blacklistAdd: document.getElementById("blacklist-add"),
  blacklistList: document.getElementById("blacklist-list"),
  blacklistEmpty: document.getElementById("blacklist-empty"),
  blacklistStorageNote: document.getElementById("blacklist-storage-note"),
  savedPanel: document.getElementById("saved-panel"),
  savedAdd: document.getElementById("saved-add"),
  savedList: document.getElementById("saved-list"),
  savedEmpty: document.getElementById("saved-empty"),
  savedStorageNote: document.getElementById("saved-storage-note"),
  storageBanner: document.getElementById("storage-banner"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  more: document.getElementById("more"),
  pageLabel: document.getElementById("page-label"),
  sentinel: document.getElementById("scroll-sentinel"),
  viewer: document.getElementById("viewer"),
  viewerStage: document.getElementById("viewer-stage"),
  viewerClose: document.getElementById("viewer-close"),
  viewerPrev: document.getElementById("viewer-prev"),
  viewerNext: document.getElementById("viewer-next"),
  viewerQuality: document.getElementById("viewer-quality"),
  viewerOpen: document.getElementById("viewer-open"),
  viewerMeta: document.getElementById("viewer-meta"),
  viewerAlts: document.getElementById("viewer-alts"),
  viewerContextBtn: document.getElementById("viewer-context-btn"),
  viewerSearchBar: document.getElementById("viewer-search-bar"),
  viewerPoolBar: document.getElementById("viewer-pool-bar"),
  viewerPoolPrev: document.getElementById("viewer-pool-prev"),
  viewerPoolName: document.getElementById("viewer-pool-name"),
  viewerPoolNext: document.getElementById("viewer-pool-next"),
  viewerStats: document.getElementById("viewer-stats"),
  viewerFamily: document.getElementById("viewer-family"),
  viewerTags: document.getElementById("viewer-tags"),
  brandHome: document.getElementById("brand-home"),
  viewerBrandHome: document.getElementById("viewer-brand-home"),
  retry: document.getElementById("retry"),
  viewNav: document.getElementById("view-nav"),
  favoritesPanel: document.getElementById("favorites-panel"),
  favUser: document.getElementById("fav-user"),
  favLoad: document.getElementById("fav-load"),
  authUser: document.getElementById("auth-user"),
  authKey: document.getElementById("auth-key"),
  authRemember: document.getElementById("auth-remember"),
  authRememberNote: document.getElementById("auth-remember-note"),
  authSave: document.getElementById("auth-save"),
  authClear: document.getElementById("auth-clear"),
  authStatus: document.getElementById("auth-status"),
  authSigned: document.getElementById("auth-signed"),
  accountBtn: document.getElementById("account-btn"),
  accountDialog: document.getElementById("account-dialog"),
  accountClose: document.getElementById("account-close"),
  accountTitle: document.getElementById("account-title"),
  favAccountNote: document.getElementById("fav-account-note"),
  favOpenAccount: document.getElementById("fav-open-account"),
  poolsPanel: document.getElementById("pools-panel"),
  poolSearch: document.getElementById("pool-search"),
  poolOrder: document.getElementById("pool-order"),
  poolNav: document.getElementById("pool-nav"),
  poolBack: document.getElementById("pool-back"),
  poolTitle: document.getElementById("pool-title"),
  poolList: document.getElementById("pool-list"),
  popularPanel: document.getElementById("popular-panel"),
  popularRange: document.getElementById("popular-range"),
};

const state = {
  posts: [],
  page: 1,
  appended: 0,
  hasMore: false,
  loading: false,
  query: "",
  activeIndex: -1,
  suggestItems: [],
  suggestIndex: -1,
  suggestTimer: 0,
  suggestAbort: null,
  searchAbort: null,
  suggestSeq: 0,
  view: "posts",
  sub: "",
  blacklist: [],
  saved: [],
  activePool: null,
  poolIds: [],
  pools: [],
  pageStart: 1,
  popularScale: "day",
  popularDates: {},
  popularAll: [],
  poolCache: {},
  contextSeq: 0,
  viewerSource: "search",
  viewerPost: null,
  viewerPool: null,
  poolPostStatus: {},
  poolPostCache: {},
  poolNavLoading: false,
  poolNavSeq: 0,
  familySeq: 0,
  familyCache: {},
};

function parseStoredList(raw, asTags = false) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    /* plain text */
  }
  return asTags ? tokenize(raw) : [];
}

function normalizeBlacklist(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of tags || []) {
    const name = tagName(raw);
    if (!name || isBlockedTag(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function blacklistTags() {
  return state.blacklist.slice();
}

function persistBlacklist() {
  setItem(BLACKLIST_KEY, JSON.stringify(state.blacklist));
}

function orderFromSearch() {
  const token = tokenize(els.search.value).find((item) => /^order:/i.test(item));
  return token || "";
}

function currentQuery() {
  return buildSearchQuery({
    userQuery: els.search.value,
    rating: els.rating.value,
    order: orderFromSearch() || els.sort.value,
    blacklist: blacklistTags(),
  });
}

function clientFilter(posts) {
  return applyClientFilters(posts, {
    rating: els.rating.value,
    blacklist: blacklistTags(),
  });
}

function exclusionTagString() {
  return buildSearchQuery({
    userQuery: "",
    rating: els.rating.value,
    order: "",
    blacklist: blacklistTags(),
  }).tags;
}

function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function clampDate(iso) {
  const today = todayISO();
  return iso > today ? today : iso;
}

function shiftDate(iso, scale, direction) {
  const [year, month, day] = (iso || todayISO()).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (scale === "week") date.setDate(date.getDate() + 7 * direction);
  else if (scale === "month") date.setMonth(date.getMonth() + direction);
  else date.setDate(date.getDate() + direction);
  const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return clampDate(next);
}

function setStatus(message, kind = "", { retry = false } = {}) {
  if (!els.status) return;
  els.status.textContent = message || "";
  els.status.dataset.kind = kind;
  if (els.retry) els.retry.hidden = !retry;
}

function showStorageBanner() {
  if (isStoragePersistent() || !els.storageBanner) return;
  els.storageBanner.hidden = false;
  els.storageBanner.textContent =
    "Browser storage is blocked, so the 18+ confirmation, blacklist, saved searches, and account will reset when this tab closes.";
  setTimeout(() => {
    if (els.storageBanner) els.storageBanner.hidden = true;
  }, 15000);
}

function openApp() {
  try {
    if (els.gate) els.gate.hidden = true;
    if (els.declined) els.declined.hidden = true;
    if (els.app) els.app.hidden = false;
    showStorageBanner();
  } catch (error) {
    console.error(error);
  }
  return Promise.resolve()
    .then(function () {
      restoreRememberedAuth();
      return goPostsRecent();
    })
    .catch(function (error) {
      setStatus((error && error.message) || "Could not load posts.", "error", { retry: true });
    });
}

function setupGate() {
  if (getItem(AGE_KEY) === "1") {
    openApp();
    return;
  }
  els.gate.hidden = false;
  els.app.hidden = true;
  els.confirm.addEventListener("click", () => {
    setItem(AGE_KEY, "1");
    openApp();
  });
  els.decline.addEventListener("click", () => {
    els.gate.hidden = true;
    els.declined.hidden = false;
    els.app.hidden = true;
  });
}

function hideSuggestions() {
  state.suggestItems = [];
  state.suggestIndex = -1;
  els.suggest.hidden = true;
  els.suggest.innerHTML = "";
  els.search.setAttribute("aria-expanded", "false");
}

function lastSearchTerm(value, caret) {
  const text = value.slice(0, caret ?? value.length);
  const parts = text.split(/\s+/);
  return parts[parts.length - 1] || "";
}

function applySuggestion(name) {
  const input = els.search;
  const caret = input.selectionStart ?? input.value.length;
  const term = lastSearchTerm(input.value, caret);
  const prefix = input.value.slice(0, caret - term.length);
  const suffix = input.value.slice(caret);
  const minus = term.startsWith("-") ? "-" : "";
  const next = `${prefix}${minus}${name} ${suffix.replace(/^\s*/, "")}`;
  input.value = next.replace(/\s+$/, " ");
  const pos = (prefix + minus + name + " ").length;
  input.focus();
  input.setSelectionRange(pos, pos);
  hideSuggestions();
}

function renderSuggestions(items) {
  const filtered = filterSuggestions(items).filter((item) => item && item.name);
  state.suggestItems = filtered;
  state.suggestIndex = -1;
  els.suggest.innerHTML = "";
  if (!filtered.length) {
    els.suggest.hidden = true;
    els.search.setAttribute("aria-expanded", "false");
    return;
  }
  for (const [index, item] of filtered.entries()) {
    const li = document.createElement("li");
    li.role = "option";
    li.id = `suggest-${index}`;
    li.dataset.name = item.name;
    const label = document.createElement("span");
    label.className = "suggest-name";
    if (item.antecedent_name && item.antecedent_name !== item.name) {
      label.textContent = `${item.antecedent_name} → ${item.name}`;
    } else {
      label.textContent = item.name;
    }
    const count = document.createElement("span");
    count.className = "suggest-count";
    count.textContent = formatCount(item.post_count);
    li.append(label, count);
    li.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySuggestion(item.name);
    });
    els.suggest.append(li);
  }
  els.suggest.hidden = false;
  els.search.setAttribute("aria-expanded", "true");
}

function highlightSuggestion(index) {
  const options = [...els.suggest.querySelectorAll('[role="option"]')];
  for (const option of options) option.ariaSelected = "false";
  state.suggestIndex = index;
  if (index >= 0 && options[index]) {
    options[index].ariaSelected = "true";
    options[index].scrollIntoView({ block: "nearest" });
    els.search.setAttribute("aria-activedescendant", options[index].id);
  } else {
    els.search.removeAttribute("aria-activedescendant");
  }
}

async function requestSuggestions() {
  const termRaw = lastSearchTerm(els.search.value, els.search.selectionStart);
  const term = termRaw.replace(/^-+/, "");
  if (term.length < AUTOCOMPLETE_MIN || term.includes(":") || isBlockedTag(term)) {
    hideSuggestions();
    return;
  }
  if (state.suggestAbort) state.suggestAbort.abort();
  const abort = new AbortController();
  state.suggestAbort = abort;
  const seq = ++state.suggestSeq;
  try {
    const results = await fetchAutocomplete(term, { signal: abort.signal });
    if (seq !== state.suggestSeq) return;
    renderSuggestions(results);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    hideSuggestions();
  }
}

function scheduleSuggestions() {
  window.clearTimeout(state.suggestTimer);
  state.suggestTimer = window.setTimeout(requestSuggestions, AUTOCOMPLETE_DEBOUNCE_MS);
}

function ratingClass(rating) {
  if (rating === "s") return "rating-s";
  if (rating === "q") return "rating-q";
  return "rating-e";
}

function ratingLabel(rating) {
  if (rating === "s") return "S";
  if (rating === "q") return "Q";
  return "E";
}

function fillStatsLine(node, post) {
  if (!node) return;
  node.innerHTML = "";
  const stats = formatPostStats(post);
  const fav = document.createElement("span");
  fav.className = "stat-fav";
  fav.textContent = stats.favText;
  const score = document.createElement("span");
  score.className = "stat-score score-" + stats.direction;
  score.textContent = stats.scoreText;
  node.append(fav, document.createTextNode(" "), score);
  node.setAttribute("aria-label", stats.favs + " favorites, score " + stats.total);
}

function renderGrid(reset) {
  if (reset) els.grid.innerHTML = "";
  const start = reset ? 0 : els.grid.childElementCount;
  for (let i = start; i < state.posts.length; i += 1) {
    const post = state.posts[i];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb";
    button.dataset.index = String(i);
    const img = document.createElement("img");
    const src = previewUrl(post) || sampleImageUrl(post);
    img.alt = `Post ${post.id}`;
    img.loading = "lazy";
    img.decoding = "async";
    const fallbacks = [src, sampleImageUrl(post), previewUrl(post)].filter(Boolean);
    const unique = [...new Set(fallbacks)];
    let fi = 0;
    if (unique[0]) img.src = unique[0];
    img.addEventListener("error", () => {
      fi += 1;
      if (fi < unique.length) img.src = unique[fi];
    });
    const badge = document.createElement("span");
    badge.className = `badge ${ratingClass(post.rating)}`;
    badge.textContent = ratingLabel(post.rating);
    button.append(img, badge);
    if (isVideoPost(post)) {
      const play = document.createElement("span");
      play.className = "play-mark";
      play.textContent = "▶";
      button.append(play);
    }
    const bar = document.createElement("span");
    bar.className = "thumb-stats";
    fillStatsLine(bar, post);
    button.append(bar);
    button.addEventListener("click", () => openViewer(i));
    els.grid.append(button);
  }
  updatePager();
}

async function loadPage({ page, append }) {
  const built = currentQuery();
  if (state.searchAbort) state.searchAbort.abort();
  const abort = new AbortController();
  state.searchAbort = abort;
  state.loading = true;
  els.prev.disabled = true;
  els.next.disabled = true;
  els.more.disabled = true;
  setStatus(append ? "Loading more…" : "Loading…");
  try {
    const posts = clientFilter(
      await fetchPosts({
        tags: built.tags,
        page,
        limit: PAGE_LIMIT,
        signal: abort.signal,
      })
    );
    state.page = page;
    state.hasMore = posts.length >= PAGE_LIMIT && page < MAX_PAGE;
    if (append) {
      state.posts = state.posts.concat(posts);
      state.appended += 1;
    } else {
      state.posts = posts;
      state.appended = 0;
      state.activeIndex = -1;
    }
    renderGrid(!append);
    const warning = built.warning ? ` ${built.warning}` : "";
    if (!state.posts.length) {
      setStatus(`No posts found.${warning}`, "warn");
    } else {
      setStatus(`${state.posts.length} posts loaded.${warning}`);
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus(error.message || "Search failed.", "error", { retry: true });
  } finally {
    state.loading = false;
    els.prev.disabled = state.page <= 1 || state.loading;
    els.next.disabled = !state.hasMore || state.loading;
    els.more.disabled =
      !state.hasMore || state.loading || state.appended >= MAX_APPENDED_PAGES;
    if (els.viewer && els.viewer.open) updateViewerNav();
  }
}

function searchFromStart() {
  hideSuggestions();
  return loadPage({ page: 1, append: false });
}

function preferSample() {
  return els.preferSample.checked;
}

function clearViewerMedia() {
  const media = els.viewerStage.querySelector("video, img");
  if (media && media.tagName === "VIDEO") {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
  els.viewerStage.innerHTML = "";
  els.viewerAlts.innerHTML = "";
}

function showViewerError(message, sources) {
  const note = document.createElement("p");
  note.className = "viewer-error";
  note.textContent = message;
  els.viewerStage.append(note);
  if (sources && sources.length) {
    const altTitle = document.createElement("p");
    altTitle.className = "alts-label";
    altTitle.textContent = "Try another version:";
    els.viewerAlts.append(altTitle);
    for (const source of sources) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = source.label;
      button.addEventListener("click", () => {
        renderVideo(state.posts[state.activeIndex], source.url, sources);
      });
      els.viewerAlts.append(button);
    }
  }
}

function renderVideo(post, chosenUrl, sources) {
  clearViewerMedia();
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  const source = document.createElement("source");
  const selected = sources.find((item) => item.url === chosenUrl) || sources[0];
  if (selected && selected.type) source.type = selected.type;
  source.src = chosenUrl;
  video.append(source);
  video.addEventListener("error", () => {
    const remaining = sources.filter((item) => item.url !== chosenUrl);
    showViewerError(
      "This device could not play that video file.",
      remaining
    );
  });
  els.viewerStage.append(video);
  if (sources.length > 1) {
    const altTitle = document.createElement("p");
    altTitle.className = "alts-label";
    altTitle.textContent = "Versions:";
    els.viewerAlts.append(altTitle);
    for (const item of sources) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.disabled = item.url === chosenUrl;
      button.addEventListener("click", () => renderVideo(post, item.url, sources));
      els.viewerAlts.append(button);
    }
  }
}

function renderImage(post, useSample) {
  clearViewerMedia();
  const url = useSample
    ? sampleImageUrl(post) || originalUrl(post)
    : originalUrl(post) || sampleImageUrl(post);
  if (!url) {
    showViewerError("This post has no viewable file.", []);
    return;
  }
  const img = document.createElement("img");
  img.alt = `Post ${post.id}`;
  img.src = url;
  img.addEventListener("error", () => {
    if (!useSample && sampleImageUrl(post) && sampleImageUrl(post) !== url) {
      renderImage(post, true);
      setStatus("Original failed to load; showing sample.");
    } else {
      showViewerError("The image could not be loaded.", []);
    }
  });
  els.viewerStage.append(img);
}

function updateQualityButton(post) {
  if (isVideoPost(post)) {
    els.viewerQuality.hidden = true;
    return;
  }
  els.viewerQuality.hidden = false;
  els.viewerQuality.textContent = preferSample() ? "Load original" : "Use sample";
}

function atViewerStart() {
  return state.activeIndex <= 0 && !(state.page > 1 && state.appended === 0);
}

function atViewerEnd() {
  return state.activeIndex >= state.posts.length - 1 && !state.hasMore;
}

function updateViewerNav() {
  syncSearchBarVisibility();
  const post = currentViewerPost();
  const idx = searchIndexOfPost(post);
  if (idx >= 0) state.activeIndex = idx;
  const usable = searchNavAvailable();
  const disablePrev = !usable || atViewerStart() || state.loading;
  const disableNext = !usable || atViewerEnd() || state.loading;
  if (els.viewerPrev) els.viewerPrev.disabled = disablePrev;
  if (els.viewerNext) els.viewerNext.disabled = disableNext;
}

function currentUserSearchLabel() {
  const text = els.search && els.search.value ? String(els.search.value).trim() : "";
  return text;
}

function currentViewerPost() {
  if (state.viewerPost) return state.viewerPost;
  if (state.activeIndex >= 0 && state.posts[state.activeIndex]) return state.posts[state.activeIndex];
  return null;
}

function searchIndexOfPost(post) {
  if (!post) return -1;
  const id = Number(post.id);
  for (let i = 0; i < state.posts.length; i++) {
    if (state.posts[i] && Number(state.posts[i].id) === id) return i;
  }
  return -1;
}

function searchNavAvailable() {
  if (state.viewerSource === "pools") return false;
  return searchIndexOfPost(currentViewerPost()) >= 0;
}

function setBarsMode(mode) {
  if (els.viewer) els.viewer.dataset.bars = mode;
}

function syncSearchBarVisibility() {
  if (els.viewerSearchBar) els.viewerSearchBar.hidden = state.viewerSource === "pools";
}

function markPoolPostStatus(id, status) {
  if (!state.poolPostStatus) state.poolPostStatus = {};
  if (id == null) return;
  state.poolPostStatus[String(id)] = status;
}

function cachePoolPost(post) {
  if (!post || post.id == null) return;
  if (!state.poolPostCache) state.poolPostCache = {};
  state.poolPostCache[String(post.id)] = post;
  markPoolPostStatus(post.id, "ok");
}

function setContextSearchLabel() {
  if (!els.viewerContextBtn) return;
  const query = currentUserSearchLabel();
  els.viewerContextBtn.textContent = "Search: (" + (query || "none") + ")";
  els.viewerContextBtn.dataset.kind = "search";
  els.viewerContextBtn.removeAttribute("data-pool-id");
  els.viewerContextBtn.title = els.viewerContextBtn.textContent;
}

function currentPoolIds() {
  if (state.viewerPool && Array.isArray(state.viewerPool.post_ids) && state.viewerPool.post_ids.length) {
    return state.viewerPool.post_ids;
  }
  if (Array.isArray(state.poolIds) && state.poolIds.length) return state.poolIds;
  return [];
}

function currentPoolIndex() {
  const post = currentViewerPost();
  if (!post) return -1;
  const id = Number(post.id);
  const ids = currentPoolIds();
  for (let i = 0; i < ids.length; i++) {
    if (Number(ids[i]) === id) return i;
  }
  return -1;
}

function setViewerPool(pool) {
  if (!pool || nameContainsBlockedTerm(pool.name) || !formatPoolName(pool.name)) {
    state.viewerPool = null;
    if (els.viewerPoolBar) els.viewerPoolBar.hidden = true;
    if (els.viewerPoolName) {
      els.viewerPoolName.textContent = "Pool";
      els.viewerPoolName.removeAttribute("data-pool-id");
    }
    updatePoolNavButtons();
    return false;
  }
  cachePool(pool);
  state.viewerPool = pool;
  const name = formatPoolName(pool.name);
  if (els.viewerPoolBar) els.viewerPoolBar.hidden = false;
  if (els.viewerPoolName) {
    els.viewerPoolName.textContent = name;
    els.viewerPoolName.dataset.poolId = String(pool.id);
    els.viewerPoolName.title = name;
  }
  updatePoolNavButtons();
  return true;
}

function readyBarsMode() {
  const searchVisible = !(els.viewerSearchBar && els.viewerSearchBar.hidden);
  const poolVisible = !!(state.viewerPool && els.viewerPoolBar && !els.viewerPoolBar.hidden);
  if (searchVisible && poolVisible) setBarsMode("both");
  else if (poolVisible) setBarsMode("pool");
  else setBarsMode("search");
}

function cachePool(pool) {
  if (!pool || pool.id == null) return;
  if (!state.poolCache) state.poolCache = {};
  state.poolCache[String(pool.id)] = pool;
}

function cachedPool(id) {
  if (!state.poolCache) return null;
  return state.poolCache[String(id)] || null;
}

function updateViewerContext(post) {
  setContextSearchLabel();
  syncSearchBarVisibility();
  const seq = (state.contextSeq = (state.contextSeq || 0) + 1);
  const openedFrom = state.viewerSource === "pools" && (state.activePool || state.viewerPool);
  if (openedFrom && setViewerPool(openedFrom)) {
    readyBarsMode();
    return;
  }
  const ids = postPoolIds(post);
  if (!ids.length) {
    setViewerPool(null);
    readyBarsMode();
    return;
  }
  if (state.viewerPool && ids.indexOf(Number(state.viewerPool.id)) !== -1) {
    setViewerPool(state.viewerPool);
    readyBarsMode();
    return;
  }
  const pending = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const cached = cachedPool(id);
    if (cached) {
      if (setViewerPool(cached)) {
        readyBarsMode();
        return;
      }
      continue;
    }
    pending.push(id);
  }
  if (!pending.length) {
    setViewerPool(null);
    readyBarsMode();
    return;
  }
  setViewerPool(null);
  setBarsMode("pending");
  loadPoolsForContext(pending, seq);
}

function loadPoolsForContext(ids, seq) {
  Promise.resolve()
    .then(function () {
      function next(index) {
        if (index >= ids.length) return null;
        if (seq !== state.contextSeq) return null;
        return fetchPoolById(ids[index]).then(function (pool) {
          if (seq !== state.contextSeq) return null;
          if (pool) {
            cachePool(pool);
            if (!nameContainsBlockedTerm(pool.name) && formatPoolName(pool.name)) {
              return pool;
            }
          }
          return next(index + 1);
        });
      }
      return next(0);
    })
    .then(function (pool) {
      if (seq !== state.contextSeq) return;
      if (pool) setViewerPool(pool);
      else setViewerPool(null);
      readyBarsMode();
    })
    .catch(function (error) {
      if (error && error.name === "AbortError") return;
      console.error(error);
      if (seq === state.contextSeq) {
        setViewerPool(null);
        readyBarsMode();
      }
    });
}

function updatePoolNavButtons() {
  const ids = currentPoolIds();
  const from = currentPoolIndex();
  const loading = !!state.poolNavLoading;
  const hasPool = !!state.viewerPool && !(els.viewerPoolBar && els.viewerPoolBar.hidden);
  const disablePrev = !hasPool || loading || from < 0 || !poolDirectionOpen(ids, from, -1, state.poolPostStatus);
  const disableNext = !hasPool || loading || from < 0 || !poolDirectionOpen(ids, from, 1, state.poolPostStatus);
  if (els.viewerPoolPrev) els.viewerPoolPrev.disabled = disablePrev;
  if (els.viewerPoolNext) els.viewerPoolNext.disabled = disableNext;
}

function showViewerPost(post) {
  if (!post) return;
  state.viewerPost = post;
  cachePoolPost(post);
  cacheFamilyPost(post);
  const idx = searchIndexOfPost(post);
  if (idx >= 0) state.activeIndex = idx;
  renderViewer();
}

function stepPool(delta) {
  if (state.poolNavLoading) return Promise.resolve();
  if (!state.viewerPool) return Promise.resolve();
  const ids = currentPoolIds();
  const from = currentPoolIndex();
  const dir = delta < 0 ? -1 : 1;
  return walkPool(ids, from, dir, {});
}

function walkPool(ids, from, dir, attempted) {
  const stepped = stepPoolIds(ids, from, dir, state.poolPostStatus, 8);
  if (stepped.id != null) {
    const cached = state.poolPostCache && state.poolPostCache[String(stepped.id)];
    if (cached) {
      showViewerPost(cached);
      return Promise.resolve();
    }
    stepped.need = [stepped.id];
  }
  const need = [];
  const seen = attempted || {};
  const list = stepped.need || [];
  for (let i = 0; i < list.length; i++) {
    const key = String(list[i]);
    if (seen[key]) continue;
    seen[key] = true;
    need.push(list[i]);
  }
  if (!need.length) {
    updatePoolNavButtons();
    return Promise.resolve();
  }
  const seq = (state.poolNavSeq = (state.poolNavSeq || 0) + 1);
  state.poolNavLoading = true;
  updatePoolNavButtons();
  return fetchPostsByIds(need, { extraTags: exclusionTagString() })
    .then(function (posts) {
      if (seq !== state.poolNavSeq) return;
      const allowed = clientFilter(posts || []);
      const allowedIds = {};
      for (let i = 0; i < allowed.length; i++) {
        allowedIds[String(allowed[i].id)] = allowed[i];
        cachePoolPost(allowed[i]);
      }
      for (let i = 0; i < need.length; i++) {
        if (!allowedIds[String(need[i])]) markPoolPostStatus(need[i], "blocked");
      }
      const again = stepPoolIds(ids, from, dir, state.poolPostStatus, 8);
      if (again.id != null && state.poolPostCache && state.poolPostCache[String(again.id)]) {
        showViewerPost(state.poolPostCache[String(again.id)]);
        return;
      }
      if (again.need && again.need.length) {
        state.poolNavLoading = false;
        return walkPool(ids, from, dir, seen);
      }
    })
    .catch(function (error) {
      if (error && error.name === "AbortError") return;
      console.error(error);
      setStatus((error && error.message) || "Could not load that pool post.", "error");
    })
    .then(function () {
      if (seq === state.poolNavSeq) {
        state.poolNavLoading = false;
        updatePoolNavButtons();
      }
    });
}

function activateViewerContext() {
  closeViewer();
}

function activateViewerPool() {
  if (!els.viewerPoolName) return;
  const id = Number(els.viewerPoolName.dataset.poolId);
  const current = state.viewerPool && Number(state.viewerPool.id) === id ? state.viewerPool : cachedPool(id);
  closeViewer();
  if (current && !nameContainsBlockedTerm(current.name)) {
    if (state.view === "pools" && state.activePool && Number(state.activePool.id) === id) return;
    setView("pools");
    openPool(current);
    return;
  }
  if (!Number.isFinite(id)) return;
  setView("pools");
  beginLoad("Loading pool…");
  fetchPoolById(id)
    .then(function (pool) {
      if (!pool || nameContainsBlockedTerm(pool.name)) {
        setStatus("That pool is not available.", "warn");
        finishLoad();
        return;
      }
      cachePool(pool);
      finishLoad();
      openPool(pool);
    })
    .catch(function (error) {
      if (error && error.name === "AbortError") return;
      setStatus((error && error.message) || "Could not open that pool.", "error", { retry: true });
      finishLoad();
    });
}

function renderViewerTags(post) {
  if (!els.viewerTags) return;
  els.viewerTags.innerHTML = "";
  const groups = collectTagsByCategory(post);
  for (const group of groups) {
    const wrap = document.createElement("div");
    wrap.className = "tag-group";
    const title = document.createElement("p");
    title.className = "tag-group-title";
    title.textContent = formatTagCategoryLabel(group.category);
    wrap.dataset.category = group.category;
    wrap.append(title);
    for (const name of group.tags) {
      const row = document.createElement("div");
      row.className = "tag-row";
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "tag-plus";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "Add " + name);
      plus.addEventListener("click", function () {
        applyTagToSearch("add", name);
      });
      const label = document.createElement("button");
      label.type = "button";
      label.className = "tag-name";
      label.textContent = name;
      label.addEventListener("click", function () {
        applyTagToSearch("replace", name);
      });
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "tag-minus";
      minus.textContent = "-";
      minus.setAttribute("aria-label", "Exclude " + name);
      minus.addEventListener("click", function () {
        applyTagToSearch("exclude", name);
      });
      row.append(plus, label, minus);
      wrap.append(row);
    }
    els.viewerTags.append(wrap);
  }
}

function applyTagToSearch(mode, raw) {
  if (isBlockedTag(raw)) return;
  const name = tagName(raw);
  if (!name) return;
  const tokens = tokenize(els.search && els.search.value);
  let next = [];
  if (mode === "replace") {
    next = [name];
  } else if (mode === "add") {
    next = tokens.filter(function (token) {
      return tagName(token) !== name;
    });
    next.push(name);
  } else {
    next = tokens.filter(function (token) {
      return tagName(token) !== name;
    });
    next.push("-" + name);
  }
  if (els.search) els.search.value = next.join(" ");
  closeViewer();
  setView("posts");
  setSub("");
  searchFromStart();
}

function hideViewerFamily() {
  if (!els.viewerFamily) return;
  els.viewerFamily.hidden = true;
  els.viewerFamily.innerHTML = "";
}

function cacheFamilyPost(post) {
  if (!post || post.id == null) return;
  if (!state.familyCache) state.familyCache = {};
  state.familyCache[String(post.id)] = post;
}

function cachedFamilyPost(id) {
  const key = String(id);
  if (state.familyCache && state.familyCache[key]) return state.familyCache[key];
  if (state.poolPostCache && state.poolPostCache[key]) return state.poolPostCache[key];
  const idx = searchIndexOfPost({ id: id });
  if (idx >= 0) return state.posts[idx];
  if (state.viewerPost && Number(state.viewerPost.id) === Number(id)) return state.viewerPost;
  return null;
}

function loadAllowedPostsByIds(ids) {
  const unique = [];
  const seen = {};
  const have = [];
  const need = [];
  for (let i = 0; i < (ids || []).length; i++) {
    const id = Number(ids[i]);
    if (!Number.isFinite(id) || id <= 0 || seen[id]) continue;
    seen[id] = true;
    unique.push(id);
    const cached = cachedFamilyPost(id);
    if (cached) have.push(cached);
    else need.push(id);
  }
  if (!need.length) return Promise.resolve(have);
  return fetchPostsByIds(need, { extraTags: exclusionTagString() }).then(function (posts) {
    const allowed = clientFilter(posts || []);
    for (let i = 0; i < allowed.length; i++) cacheFamilyPost(allowed[i]);
    return have.concat(allowed);
  });
}

function postsByIdMap(posts) {
  const map = {};
  for (let i = 0; i < (posts || []).length; i++) {
    const post = posts[i];
    if (post && post.id != null) map[String(post.id)] = post;
  }
  return map;
}

function updateViewerFamily(post) {
  hideViewerFamily();
  if (!post) return;
  cacheFamilyPost(post);
  const seq = (state.familySeq = (state.familySeq || 0) + 1);
  const selfId = Number(post.id);
  const parentId = postParentId(post);
  const childIds = postChildIds(post);
  if (!parentId && !childIds.length && !postHasActiveChildren(post)) return;
  const firstIds = [];
  if (parentId) firstIds.push(parentId);
  for (let i = 0; i < childIds.length; i++) {
    if (childIds[i] !== parentId && childIds[i] !== selfId) firstIds.push(childIds[i]);
  }
  loadAllowedPostsByIds(firstIds)
    .then(function (posts) {
      if (seq !== state.familySeq) return null;
      const byId = postsByIdMap(posts);
      const parent = parentId ? byId[String(parentId)] || null : null;
      const children = [];
      for (let i = 0; i < childIds.length; i++) {
        const related = byId[String(childIds[i])];
        if (related) children.push(related);
      }
      let siblingIds = [];
      if (parent && !children.length) {
        const fromParent = postChildIds(parent);
        for (let i = 0; i < fromParent.length; i++) {
          if (fromParent[i] !== selfId) siblingIds.push(fromParent[i]);
        }
      }
      if (!siblingIds.length) {
        return { parent: parent, children: children, siblings: [] };
      }
      return loadAllowedPostsByIds(siblingIds).then(function (siblingPosts) {
        if (seq !== state.familySeq) return null;
        const siblings = [];
        for (let i = 0; i < (siblingPosts || []).length; i++) {
          if (Number(siblingPosts[i].id) !== selfId) siblings.push(siblingPosts[i]);
        }
        return { parent: parent, children: children, siblings: siblings };
      });
    })
    .then(function (family) {
      if (!family || seq !== state.familySeq) return;
      renderViewerFamily(family);
    })
    .catch(function (error) {
      if (error && error.name === "AbortError") return;
      console.error(error);
    });
}

function createFamilyThumb(post, role) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "family-thumb";
  button.dataset.role = role;
  button.dataset.postId = String(post.id);
  button.setAttribute("aria-label", (role === "parent" ? "Parent post " : "Related post ") + post.id);
  const img = document.createElement("img");
  const src = previewUrl(post) || sampleImageUrl(post);
  img.alt = "Post " + post.id;
  img.loading = "lazy";
  if (src) img.src = src;
  const badge = document.createElement("span");
  badge.className = "badge " + ratingClass(post.rating);
  badge.textContent = ratingLabel(post.rating);
  button.append(img, badge);
  if (isVideoPost(post)) {
    const play = document.createElement("span");
    play.className = "play-mark";
    play.textContent = "▶";
    button.append(play);
  }
  button.addEventListener("click", function () {
    showViewerPost(post);
  });
  return button;
}

function renderFamilySide(label, posts, role) {
  const side = document.createElement("div");
  side.className = "family-side family-" + (role === "parent" ? "parent" : "children");
  const title = document.createElement("p");
  title.className = "family-label";
  title.textContent = label;
  const row = document.createElement("div");
  row.className = "family-row";
  for (let i = 0; i < posts.length; i++) {
    row.append(createFamilyThumb(posts[i], role));
  }
  side.append(title, row);
  return side;
}

function renderViewerFamily(family) {
  if (!els.viewerFamily) return;
  const parent = family && family.parent;
  const children = (family && family.children) || [];
  const siblings = (family && family.siblings) || [];
  const right = children.length ? children : siblings;
  const rightRole = children.length ? "child" : "sibling";
  const rightLabel = children.length ? (children.length === 1 ? "Child" : "Children") : (siblings.length === 1 ? "Sibling" : "Siblings");
  if (!parent && !right.length) {
    hideViewerFamily();
    return;
  }
  els.viewerFamily.innerHTML = "";
  if (parent) els.viewerFamily.append(renderFamilySide("Parent", [parent], "parent"));
  if (right.length) els.viewerFamily.append(renderFamilySide(rightLabel, right, rightRole));
  els.viewerFamily.hidden = false;
}

function renderViewer() {
  const post = currentViewerPost();
  if (!post) return;
  state.viewerPost = post;
  cachePoolPost(post);
  if (els.viewerOpen) els.viewerOpen.href = postPageUrl(post);
  if (els.viewerMeta) {
    els.viewerMeta.textContent = "#" + post.id + " · " + String(post.rating || "").toUpperCase();
  }
  if (els.viewerStats) {
    els.viewerStats.hidden = false;
    fillStatsLine(els.viewerStats, post);
  }
  updateViewerNav();
  updateQualityButton(post);
  renderViewerTags(post);
  updateViewerContext(post);
  updatePoolNavButtons();
  updateViewerFamily(post);
  if (isVideoPost(post)) {
    const sources = videoSources(post);
    const chosen =
      (preferSample() &&
        sources.find((item) => /480p|720p/i.test(item.label))) ||
      sources.find((item) => item.type === "video/mp4") ||
      sources[0];
    if (!chosen) {
      clearViewerMedia();
      showViewerError("No playable video URL was returned.", []);
      return;
    }
    renderVideo(post, chosen.url, sources);
  } else {
    renderImage(post, preferSample());
  }
}

function openViewer(index) {
  state.activeIndex = index;
  state.viewerSource = state.view === "pools" && state.activePool ? "pools" : "search";
  state.viewerPost = state.posts[index] || null;
  if (state.viewerSource === "pools") state.viewerPool = state.activePool;
  else state.viewerPool = null;
  setBarsMode("pending");
  renderViewer();
  if (typeof els.viewer.showModal === "function") els.viewer.showModal();
  else els.viewer.setAttribute("open", "");
}

function closeViewer() {
  try {
    if (els.viewerStage) clearViewerMedia();
    if (els.viewerTags) els.viewerTags.innerHTML = "";
    state.familySeq = (state.familySeq || 0) + 1;
    hideViewerFamily();
    if (!els.viewer) return;
    if (els.viewer.open && typeof els.viewer.close === "function") els.viewer.close();
    else els.viewer.removeAttribute("open");
  } catch (error) {
    console.error(error);
  }
}

function stepViewer(delta) {
  if (state.loading) return Promise.resolve();
  if (!searchNavAvailable() && searchIndexOfPost(currentViewerPost()) < 0) {
    updateViewerNav();
    return Promise.resolve();
  }
  const next = state.activeIndex + delta;
  if (next >= 0 && next < state.posts.length) {
    state.activeIndex = next;
    state.viewerPost = state.posts[next];
    renderViewer();
    return Promise.resolve();
  }
  if (delta > 0 && state.hasMore) {
    const from = state.posts.length;
    if (els.viewerNext) els.viewerNext.disabled = true;
    return Promise.resolve(reloadCurrent({ page: state.page + 1, append: true })).then(function () {
      if (state.posts.length > from) {
        state.activeIndex = from;
        state.viewerPost = state.posts[from];
        renderViewer();
      } else {
        updateViewerNav();
      }
    });
  }
  if (delta < 0 && state.page > 1 && state.appended === 0) {
    if (els.viewerPrev) els.viewerPrev.disabled = true;
    return Promise.resolve(reloadCurrent({ page: state.page - 1, append: false })).then(function () {
      if (state.posts.length) {
        state.activeIndex = state.posts.length - 1;
        state.viewerPost = state.posts[state.activeIndex];
        renderViewer();
        if (els.viewer && !els.viewer.open) openViewer(state.activeIndex);
      } else {
        updateViewerNav();
      }
    });
  }
  updateViewerNav();
  return Promise.resolve();
}

function stepActiveViewer(delta) {
  if (searchNavAvailable()) return stepViewer(delta);
  if (state.viewerPool) return stepPool(delta);
  return Promise.resolve();
}

function bindViewerSwipe() {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  els.viewerStage.addEventListener(
    "touchstart",
    (event) => {
      if (!event.changedTouches.length) return;
      tracking = true;
      startX = event.changedTouches[0].clientX;
      startY = event.changedTouches[0].clientY;
    },
    { passive: true }
  );
  els.viewerStage.addEventListener(
    "touchend",
    (event) => {
      if (!tracking || !event.changedTouches.length) return;
      tracking = false;
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
      stepActiveViewer(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}

function bindInfiniteScroll() {
  if (!("IntersectionObserver" in window) || !els.sentinel) return;
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (state.loading || !state.hasMore || appendLimitReached()) return;
    if (poolCatalogView()) {
      if (!(state.pools && state.pools.length)) return;
      reloadCurrent({ page: state.page + 1, append: true });
      return;
    }
    if (!state.posts.length) return;
    reloadCurrent({ page: state.page + 1, append: true });
  });
  observer.observe(els.sentinel);
}


function abortSearch() {
  if (state.searchAbort) state.searchAbort.abort();
  const abort = new AbortController();
  state.searchAbort = abort;
  return abort;
}

function poolCatalogView() {
  return state.view === "pools" && !state.activePool;
}

function pagerStartPage() {
  if (poolCatalogView() && state.pageStart) return state.pageStart;
  return state.page || 1;
}

function appendLimitReached() {
  if (poolCatalogView()) return false;
  return state.appended >= MAX_APPENDED_PAGES;
}

function updatePager() {
  const start = pagerStartPage();
  if (els.pageLabel) {
    els.pageLabel.textContent =
      start !== state.page && start
        ? "Pages " + start + "–" + state.page
        : "Page " + (state.page || 1);
  }
  if (els.prev) els.prev.disabled = start <= 1 || state.loading;
  if (els.next) els.next.disabled = !state.hasMore || state.loading;
  if (els.more) {
    els.more.disabled = !state.hasMore || state.loading || appendLimitReached();
    els.more.hidden = appendLimitReached() && state.hasMore === false;
  }
}

function beginLoad(message) {
  state.loading = true;
  if (els.prev) els.prev.disabled = true;
  if (els.next) els.next.disabled = true;
  if (els.more) els.more.disabled = true;
  setStatus(message || "Loading…");
}

function finishLoad() {
  state.loading = false;
  updatePager();
  if (els.viewer && els.viewer.open) updateViewerNav();
}

function showPostGrid() {
  if (els.poolList) els.poolList.hidden = true;
  els.grid.hidden = false;
}

function assignPosts(posts, { page, append, pageSize = PAGE_LIMIT }) {
  state.page = page;
  state.hasMore = posts.length >= pageSize && page < MAX_PAGE;
  if (append) {
    state.posts = state.posts.concat(posts);
    state.appended += 1;
  } else {
    state.posts = posts;
    state.appended = 0;
    state.activeIndex = -1;
  }
  showPostGrid();
  renderGrid(!append);
}

function resetResults() {
  state.posts = [];
  state.popularAll = [];
  state.page = 1;
  state.appended = 0;
  state.hasMore = false;
  state.activeIndex = -1;
  if (els.grid) els.grid.innerHTML = "";
  setStatus("");
}

function hidePostsSubPanels() {
  if (els.favoritesPanel) els.favoritesPanel.hidden = true;
  if (els.popularPanel) els.popularPanel.hidden = true;
  if (els.blacklistPanel) els.blacklistPanel.hidden = true;
  if (els.savedPanel) els.savedPanel.hidden = true;
}

function updateSortVisibility() {
  const sortLabel = els.sort && els.sort.closest("label");
  if (sortLabel) sortLabel.hidden = state.view === "pools" || state.sub === "popular";
}

function setView(view) {
  state.view = view;
  if (view !== "pools") {
    state.activePool = null;
    state.poolIds = [];
  }
  hideSuggestions();
  closeViewer();
  if (els.viewNav) {
    for (const button of els.viewNav.querySelectorAll("[data-view]")) {
      button.setAttribute("aria-selected", button.dataset.view === view ? "true" : "false");
    }
  }
  const posts = view === "posts";
  if (els.form) els.form.hidden = !posts;
  if (els.subNav) els.subNav.hidden = !posts;
  if (els.poolsPanel) els.poolsPanel.hidden = view !== "pools";
  if (els.poolList) els.poolList.hidden = view !== "pools" || Boolean(state.activePool);
  if (els.poolNav) els.poolNav.hidden = !(view === "pools" && state.activePool);
  if (!posts) {
    state.sub = "";
    hidePostsSubPanels();
    if (els.subNav) {
      for (const button of els.subNav.querySelectorAll("[data-sub]")) {
        button.setAttribute("aria-selected", "false");
      }
    }
  }
  els.grid.hidden = view === "pools" && !state.activePool;
  const pager = document.querySelector(".pager");
  if (pager) pager.hidden = view === "pools" && !state.activePool;
  updateSortVisibility();
  if (view !== "pools" && els.poolList) els.poolList.innerHTML = "";
  resetResults();
}

function setSub(sub) {
  state.sub = sub || "";
  if (els.subNav) {
    for (const button of els.subNav.querySelectorAll("[data-sub]")) {
      button.setAttribute("aria-selected", button.dataset.sub === state.sub ? "true" : "false");
    }
  }
  if (els.favoritesPanel) els.favoritesPanel.hidden = state.sub !== "favorites";
  if (els.popularPanel) els.popularPanel.hidden = state.sub !== "popular";
  if (els.blacklistPanel) els.blacklistPanel.hidden = state.sub !== "blacklist";
  if (els.savedPanel) els.savedPanel.hidden = state.sub !== "saved";
  updateSortVisibility();
  const showGrid = state.view === "posts" && state.sub !== "blacklist" && state.sub !== "saved";
  els.grid.hidden = !showGrid;
  const pager = document.querySelector(".pager");
  if (pager) pager.hidden = !showGrid;
}

function goPostsRecent() {
  if (els.search) els.search.value = "";
  if (els.sort) els.sort.value = "";
  setView("posts");
  setSub("");
  return loadPage({ page: 1, append: false });
}

function goHomeToPosts() {
  closeViewer();
  return goPostsRecent();
}

function runHot() {
  setView("posts");
  const tokens = tokenize(els.search.value).filter((item) => !/^[-]?order:/i.test(item));
  tokens.push("order:hot");
  els.search.value = tokens.join(" ");
  if (els.sort) els.sort.value = "";
  setSub("hot");
  return searchFromStart();
}

function persistAccountIfNeeded() {
  if (!(els.authRemember && els.authRemember.checked)) {
    removeItem(FAV_USER_KEY);
    removeItem(AUTH_USER_KEY);
    removeAuthKey();
    return;
  }
  const fav = sanitizeUsername(els.favUser && els.favUser.value);
  const auth = sanitizeUsername(els.authUser && els.authUser.value) || fav;
  if (fav) setItem(FAV_USER_KEY, fav);
  if (auth) setItem(AUTH_USER_KEY, auth);
}

function renderBlacklist() {
  if (!els.blacklistList) return;
  if (els.blacklistStorageNote) els.blacklistStorageNote.hidden = isStoragePersistent();
  els.blacklistList.innerHTML = "";
  for (const tag of state.blacklist) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = tag;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.blacklist = state.blacklist.filter((entry) => entry !== tag);
      persistBlacklist();
      renderBlacklist();
      setStatus("Removed " + tag + " from your blacklist.");
    });
    item.append(name, remove);
    els.blacklistList.append(item);
  }
  if (els.blacklistEmpty) els.blacklistEmpty.hidden = state.blacklist.length > 0;
}

function addBlacklistTag(raw) {
  const tokens = tokenize(raw);
  if (!tokens.length) {
    setStatus("Enter a tag to blacklist.", "error");
    return;
  }
  if (tokens.every((item) => isBlockedTag(item))) {
    setStatus("That tag is already always hidden and cannot be added to your list.", "warn");
    return;
  }
  const names = normalizeBlacklist(tokens);
  let added = 0;
  for (const name of names) {
    if (!state.blacklist.includes(name)) {
      state.blacklist.push(name);
      added += 1;
    }
  }
  persistBlacklist();
  renderBlacklist();
  if (els.blacklistAdd) els.blacklistAdd.value = "";
  if (!added) setStatus("That tag is already on your blacklist.");
  else setStatus("Blacklist updated" + (isStoragePersistent() ? "." : ". Storage is blocked, so this lasts only until this tab closes."));
}

function persistSaved() {
  setItem(SAVED_KEY, JSON.stringify(state.saved));
}

function renderSaved() {
  if (!els.savedList) return;
  if (els.savedStorageNote) els.savedStorageNote.hidden = isStoragePersistent();
  els.savedList.innerHTML = "";
  for (const query of state.saved) {
    const item = document.createElement("li");
    const run = document.createElement("button");
    run.type = "button";
    run.textContent = query;
    run.addEventListener("click", () => runSaved(query));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Delete";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      state.saved = state.saved.filter((entry) => entry !== query);
      persistSaved();
      renderSaved();
      setStatus("Deleted saved search.");
    });
    item.append(run, remove);
    els.savedList.append(item);
  }
  if (els.savedEmpty) els.savedEmpty.hidden = state.saved.length > 0;
}

function saveCurrentSearch() {
  const query = (els.search.value || "").trim();
  if (!query) {
    setStatus("Type a search to save, for example canid order:score.", "error");
    return;
  }
  if (state.saved.includes(query)) {
    setStatus("That search is already saved.");
    renderSaved();
    return;
  }
  state.saved.push(query);
  persistSaved();
  renderSaved();
  setStatus("Search saved" + (isStoragePersistent() ? "." : ". Storage is blocked, so this lasts only until this tab closes."));
}

function runSaved(query) {
  setView("posts");
  els.search.value = query;
  if (/\border:hot\b/i.test(query)) setSub("hot");
  else setSub("");
  return searchFromStart();
}

function activateSub(sub) {
  if (state.view !== "posts") setView("posts");
  if (sub === "hot") return runHot();
  resetResults();
  setSub(sub);
  if (sub === "popular") {
    if (!state.popularScale) state.popularScale = "day";
    syncPopularButtons();
    updatePopularRange();
    return loadPopular({ page: 1, append: false });
  }
  if (sub === "favorites") {
    if (hasBasicAuth() && els.favUser && !sanitizeUsername(els.favUser.value)) {
      els.favUser.value = basicAuthUsername();
    }
    updateAuthStatus();
    if (hasBasicAuth()) {
      setStatus("Signed in as " + basicAuthUsername() + ".");
    } else {
      setStatus("Enter an e621 username to load favorites.");
    }
    return;
  }
  if (sub === "blacklist") {
    renderBlacklist();
    return;
  }
  if (sub === "saved") {
    renderSaved();
  }
}

function popularDate(scale) {
  if (!state.popularDates) state.popularDates = {};
  return state.popularDates[scale] || todayISO();
}

function setPopularDate(scale, iso) {
  if (!state.popularDates) state.popularDates = {};
  state.popularDates[scale] = clampDate(iso);
}

function formatPopularRange(scale, iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const fmt = (date) => date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  if (scale === "day") return fmt(start);
  if (scale === "week") return "Week of " + fmt(start);
  return start.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

function updatePopularRange() {
  if (!els.popularRange) return;
  const scale = state.popularScale || "day";
  const label = scale === "day" ? "Day" : scale === "week" ? "Week" : "Month";
  els.popularRange.textContent = label + ": " + formatPopularRange(scale, popularDate(scale));
}

function syncPopularButtons() {
  if (!els.popularPanel) return;
  for (const button of els.popularPanel.querySelectorAll("[data-pop='scale']")) {
    button.setAttribute("aria-selected", button.dataset.scale === state.popularScale ? "true" : "false");
  }
}

function resolvedAuthUsername() {
  const fromAuth = sanitizeUsername(els.authUser && els.authUser.value);
  if (isValidUsername(fromAuth)) return fromAuth;
  return sanitizeUsername(els.favUser && els.favUser.value);
}

function signedInNote() {
  const remember = Boolean(els.authRemember && els.authRemember.checked);
  const extra = remember
    ? (isStoragePersistent() ? " The API key is saved on this device." : " Storage is blocked, so the API key is remembered only until this tab closes.")
    : " The API key stays in this tab only.";
  return "Signed in as " + basicAuthUsername() + "." + extra;
}

function updateAuthStatus(message, kind) {
  const signed = hasBasicAuth();
  const name = basicAuthUsername();
  if (els.authStatus) {
    if (message) els.authStatus.textContent = message;
    else if (signed) els.authStatus.textContent = signedInNote();
    else els.authStatus.textContent = "Not signed in. Public favorites still work.";
    if (kind) els.authStatus.setAttribute("data-kind", kind);
    else if (message) els.authStatus.removeAttribute("data-kind");
    else els.authStatus.setAttribute("data-kind", signed ? "ok" : "");
  }
  if (els.authSigned) {
    els.authSigned.hidden = !signed;
    els.authSigned.textContent = signed ? "Signed in as " + name : "";
  }
  if (els.accountBtn) {
    els.accountBtn.textContent = signed ? name : "Sign in";
    els.accountBtn.setAttribute("data-signed", signed ? "true" : "false");
    els.accountBtn.setAttribute("aria-label", signed ? "Account, signed in as " + name : "Sign in");
  }
  if (els.accountTitle) els.accountTitle.textContent = signed ? "Account" : "Sign in";
  if (els.favOpenAccount) els.favOpenAccount.hidden = signed;
  if (els.favAccountNote) {
    els.favAccountNote.textContent = signed
      ? "Signed in as " + name + ". Private favorites use this account. Your e621 account blacklist is not imported; only this site's blacklist and the always-hidden tags apply."
      : "Use Sign in next to Posts and Pools for private favorites and full API access. Public favorites still work with just a username.";
  }
  if (els.authClear) els.authClear.disabled = !signed;
  if (els.authSave) els.authSave.disabled = Boolean(state.authBusy);
  if (els.authRememberNote) {
    els.authRememberNote.hidden = isStoragePersistent();
  }
}

function openAccountDialog() {
  updateAuthStatus();
  if (els.authUser && !sanitizeUsername(els.authUser.value)) {
    const fromFav = sanitizeUsername(els.favUser && els.favUser.value);
    els.authUser.value = hasBasicAuth() ? basicAuthUsername() : (fromFav || "");
  }
  const dialog = els.accountDialog;
  if (!dialog) return;
  try {
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  } catch (error) {
    dialog.setAttribute("open", "");
  }
}

function closeAccountDialog() {
  const dialog = els.accountDialog;
  if (!dialog) return;
  try {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  } catch (error) {
    dialog.removeAttribute("open");
  }
}

function removeAuthKey() {
  removeItem(AUTH_KEY_KEY);
}

function restoreRememberedAuth() {
  const pending = state.pendingAuth;
  state.pendingAuth = null;
  if (!pending || !pending.username || !pending.apiKey) return;
  if (els.authKey && !els.authKey.value) els.authKey.value = pending.apiKey;
  if (els.authUser && !els.authUser.value) els.authUser.value = pending.username;
  signIn();
}

function signIn() {
  if (state.authBusy) return Promise.resolve();
  const username = resolvedAuthUsername();
  const apiKey = (els.authKey && els.authKey.value) || "";
  if (!isValidUsername(username) || !apiKey.replace(/\s+/g, "")) {
    const message = "Enter a username and API key to sign in.";
    updateAuthStatus(message, "error");
    setStatus(message, "error");
    return Promise.resolve();
  }
  if (els.authUser && !sanitizeUsername(els.authUser.value)) els.authUser.value = username;
  if (els.favUser && !sanitizeUsername(els.favUser.value)) els.favUser.value = username;
  state.authBusy = true;
  updateAuthStatus("Checking the API key with e621…", "");
  setStatus("Checking the API key with e621…");
  if (els.authSave) els.authSave.disabled = true;
  return verifyBasicAuth(username, apiKey)
    .then(function (user) {
      const shown = sanitizeUsername((user && user.name) || username) || username;
      if (els.authUser) els.authUser.value = shown;
      if (els.favUser && !sanitizeUsername(els.favUser.value)) els.favUser.value = shown;
      setBasicAuth(shown, apiKey);
      const remember = Boolean(els.authRemember && els.authRemember.checked);
      if (remember) {
        setItem(AUTH_USER_KEY, shown);
        setItem(AUTH_KEY_KEY, apiKey.replace(/\s+/g, ""));
        persistAccountIfNeeded();
      } else {
        removeAuthKey();
      }
      if (els.authKey) els.authKey.value = "";
      updateAuthStatus(signedInNote(), "ok");
      setStatus(signedInNote());
    })
    .catch(function (error) {
      if (error && error.name === "AbortError") return;
      const message = (error && error.message) || "Could not sign in.";
      updateAuthStatus(message, "error");
      setStatus(message, "error");
    })
    .then(function () {
      state.authBusy = false;
      if (els.authSave) els.authSave.disabled = false;
    });
}

function signOut() {
  clearBasicAuth();
  removeAuthKey();
  if (els.authKey) els.authKey.value = "";
  updateAuthStatus();
  setStatus("Signed out. The API key was cleared from memory.");
}

async function loadFavorites({ page, append }) {
  if (els.favUser && !sanitizeUsername(els.favUser.value) && hasBasicAuth()) {
    els.favUser.value = basicAuthUsername();
  }
  const username = sanitizeUsername(els.favUser && els.favUser.value);
  if (!isValidUsername(username)) {
    setStatus("Enter a valid e621 username to load favorites.", "error");
    return;
  }
  if (els.authRemember && els.authRemember.checked) setItem(FAV_USER_KEY, username);
  const built = buildSearchQuery({
    userQuery: `fav:${username}`,
    rating: els.rating.value,
    order: els.sort.value,
    blacklist: blacklistTags(),
  });
  const abort = abortSearch();
  beginLoad(append ? "Loading more favorites…" : "Loading favorites…");
  try {
    const posts = clientFilter(
      await fetchPosts({
        tags: built.tags,
        page,
        limit: PAGE_LIMIT,
        signal: abort.signal,
      })
    );
    assignPosts(posts, { page, append });
    const warning = built.warning ? ` ${built.warning}` : "";
    if (!state.posts.length) setStatus(`No favorites found.${warning}`, "warn");
    else setStatus(`${state.posts.length} favorites loaded for ${username}.${warning}`);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus(error.message || "Could not load favorites.", "error", { retry: true });
  } finally {
    finishLoad();
  }
}

async function fillPoolCovers(pools) {
  const ids = [];
  const indexById = new Map();
  for (const [index, pool] of pools.entries()) {
    const first = (pool.post_ids || [])[0];
    if (first && !indexById.has(first)) {
      indexById.set(first, []);
      ids.push(first);
    }
    if (first) indexById.get(first).push(index);
  }
  if (!ids.length) return;
  const extra = exclusionTagString();
  const posts = clientFilter(await fetchPostsByIds(ids, { extraTags: extra }));
  for (const post of posts) {
    const indexes = indexById.get(post.id) || [];
    for (const index of indexes) {
      const img = document.querySelector(`[data-pool-cover="${pools[index].id}"]`);
      const src = previewUrl(post);
      if (img && src) {
        img.src = src;
        img.alt = "";
      }
    }
  }
}

function renderPoolList(pools, append) {
  els.grid.hidden = true;
  els.poolList.hidden = false;
  if (!append) els.poolList.innerHTML = "";
  const seen = {};
  if (append) {
    const existing = els.poolList.querySelectorAll("[data-pool-id]");
    for (let i = 0; i < existing.length; i++) {
      seen[existing[i].dataset.poolId] = true;
    }
  }
  for (const pool of pools) {
    if (!pool || pool.id == null) continue;
    if (append && seen[String(pool.id)]) continue;
    seen[String(pool.id)] = true;
    cachePool(pool);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pool-item";
    button.dataset.poolId = String(pool.id);
    const cover = document.createElement("img");
    cover.className = "pool-cover";
    cover.alt = "";
    cover.width = 64;
    cover.height = 64;
    cover.dataset.poolCover = String(pool.id);
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = String(pool.name || "").replace(/_/g, " ");
    const meta = document.createElement("span");
    meta.className = "pool-meta";
    meta.textContent = `${pool.post_count || (pool.post_ids || []).length} posts`;
    text.append(title, document.createElement("br"), meta);
    button.append(cover, text);
    button.addEventListener("click", () => openPool(pool));
    els.poolList.append(button);
  }
}

async function loadPools({ page, append } = {}) {
  const abort = abortSearch();
  beginLoad(append ? "Loading more pools…" : "Loading pools…");
  try {
    const name = (els.poolSearch && els.poolSearch.value.trim()) || "";
    const order = (els.poolOrder && els.poolOrder.value) || "updated_at";
    const startPage = append ? state.page + 1 : page || 1;
    let apiPage = startPage;
    let visible = [];
    let lastRaw = 0;
    let extra = 0;
    while (apiPage <= MAX_PAGE) {
      const raw = await fetchPools({
        name: name,
        order: order,
        page: apiPage,
        limit: POOL_PAGE_LIMIT,
        signal: abort.signal,
      });
      lastRaw = (raw && raw.length) || 0;
      visible = visible.concat(filterPools(raw));
      if (!shouldFetchMorePools(lastRaw, POOL_PAGE_LIMIT, visible.length, extra, POOL_FILL_MAX_EXTRA)) break;
      extra += 1;
      apiPage += 1;
    }
    state.activePool = null;
    state.poolIds = [];
    state.posts = [];
    state.hasMore = poolResponseHasMore(lastRaw, POOL_PAGE_LIMIT, apiPage, MAX_PAGE);
    if (append) {
      state.pools = (state.pools || []).concat(visible);
      state.appended += 1;
      state.page = apiPage;
    } else {
      state.pools = visible;
      state.appended = 0;
      state.pageStart = startPage;
      state.page = apiPage;
    }
    if (els.poolNav) els.poolNav.hidden = true;
    renderPoolList(visible, !!append);
    const count = (state.pools && state.pools.length) || 0;
    const range =
      state.pageStart && state.pageStart !== state.page
        ? "Pages " + state.pageStart + "–" + state.page
        : "Page " + (state.page || 1);
    if (!count) setStatus("No pools found.", "warn");
    else if (!state.hasMore) setStatus(count + " pools loaded. " + range + ". End of list.");
    else setStatus(count + " pools loaded. " + range + ". More available.");
    finishLoad();
    fillPoolCovers(visible).catch(function () {});
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus((error && error.message) || "Could not load pools.", "error", { retry: true });
    finishLoad();
  }
}

async function loadPoolPosts({ page, append }) {
  const ids = state.poolIds || [];
  const start = (page - 1) * PAGE_LIMIT;
  const slice = ids.slice(start, start + PAGE_LIMIT);
  const abort = abortSearch();
  beginLoad(append ? "Loading more pool posts…" : "Loading pool…");
  try {
    const extra = exclusionTagString();
    const posts = clientFilter(await fetchPostsByIds(slice, { extraTags: extra, signal: abort.signal }));
    state.hasMore = start + PAGE_LIMIT < ids.length;
    state.page = page;
    if (append) {
      state.posts = state.posts.concat(posts);
      state.appended += 1;
    } else {
      state.posts = posts;
      state.appended = 0;
      state.activeIndex = -1;
    }
    showPostGrid();
    renderGrid(!append);
    const name = state.activePool ? String(state.activePool.name || "").replace(/_/g, " ") : "Pool";
    if (els.poolTitle) els.poolTitle.textContent = name;
    if (els.poolNav) els.poolNav.hidden = false;
    if (!state.posts.length) setStatus(`No viewable posts in ${name}.`, "warn");
    else setStatus(`${state.posts.length} posts from ${name}.`);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus(error.message || "Could not load this pool.", "error", { retry: true });
  } finally {
    finishLoad();
  }
}

function openPool(pool) {
  state.activePool = pool;
  state.poolIds = Array.isArray(pool.post_ids) ? pool.post_ids.slice() : [];
  if (els.poolList) els.poolList.hidden = true;
  loadPoolPosts({ page: 1, append: false });
}

function popularPageSlice(page, append) {
  const start = append ? state.posts.length : (page - 1) * PAGE_LIMIT;
  const slice = state.popularAll.slice(start, start + PAGE_LIMIT);
  state.page = page;
  state.hasMore = start + PAGE_LIMIT < state.popularAll.length;
  if (append) {
    state.posts = state.posts.concat(slice);
    state.appended += 1;
  } else {
    state.posts = slice;
    state.appended = 0;
    state.activeIndex = -1;
  }
  showPostGrid();
  renderGrid(!append);
}

async function loadPopular({ page = 1, append = false } = {}) {
  if (append && state.popularAll.length) {
    popularPageSlice(page, true);
    setStatus(`${state.posts.length} popular posts loaded.`);
    finishLoad();
    return;
  }
  const scale = state.popularScale || "day";
  const date = clampDate(popularDate(scale));
  setPopularDate(scale, date);
  updatePopularRange();
  syncPopularButtons();
  const abort = abortSearch();
  beginLoad("Loading popular posts…");
  try {
    const posts = clientFilter(
      await fetchPopular({ scale, date, signal: abort.signal })
    );
    state.popularAll = posts;
    popularPageSlice(1, false);
    if (!posts.length) setStatus("No viewable popular posts for this date.", "warn");
    else setStatus(`${posts.length} popular posts for ${scale} starting ${date}.`);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus(error.message || "Could not load popular posts.", "error", { retry: true });
  } finally {
    finishLoad();
  }
}

function reloadCurrent({ page = 1, append = false } = {}) {
  if (state.view === "pools") {
    if (state.activePool) return loadPoolPosts({ page, append });
    return loadPools({ page, append });
  }
  if (state.sub === "favorites") return loadFavorites({ page, append });
  if (state.sub === "popular") return loadPopular({ page, append });
  if (state.sub === "blacklist" || state.sub === "saved") return;
  return loadPage({ page, append });
}

function bindEvents() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.suggestIndex >= 0 && state.suggestItems[state.suggestIndex]) {
      applySuggestion(state.suggestItems[state.suggestIndex].name);
      return;
    }
    searchFromStart();
  });
  els.search.addEventListener("input", scheduleSuggestions);
  els.search.addEventListener("keydown", (event) => {
    if (els.suggest.hidden || !state.suggestItems.length) {
      if (event.key === "Escape") hideSuggestions();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightSuggestion(
        Math.min(state.suggestItems.length - 1, state.suggestIndex + 1)
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightSuggestion(Math.max(0, state.suggestIndex - 1));
    } else if (event.key === "Enter" && state.suggestIndex >= 0) {
      event.preventDefault();
      applySuggestion(state.suggestItems[state.suggestIndex].name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideSuggestions();
    }
  });
  els.search.addEventListener("blur", () => {
    window.setTimeout(hideSuggestions, 150);
  });

  els.rating.addEventListener("change", () => {
    if (els.app.hidden) return;
    if (state.sub === "blacklist" || state.sub === "saved") return;
    reloadCurrent({ page: 1, append: false });
  });
  els.sort.addEventListener("change", () => {
    const tokens = tokenize(els.search.value).filter((item) => !/^[-]?order:/i.test(item));
    els.search.value = tokens.join(" ");
    if (els.app.hidden) return;
    if (state.sub === "hot") setSub("");
    if (state.sub === "blacklist" || state.sub === "saved") return;
    if (state.view === "posts" || state.view === "pools") {
      reloadCurrent({ page: 1, append: false });
    }
  });
  els.preferSample.addEventListener("change", () => {
    setItem(SAMPLE_KEY, els.preferSample.checked ? "1" : "0");
    if (els.viewer.open && state.activeIndex >= 0) renderViewer();
  });

  if (els.blacklistForm) {
    els.blacklistForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addBlacklistTag(els.blacklistAdd && els.blacklistAdd.value);
    });
  }
  if (els.savedAdd) els.savedAdd.addEventListener("click", saveCurrentSearch);

  if (els.retry) {
    els.retry.addEventListener("click", () => {
      reloadCurrent({ page: Math.max(1, state.page), append: false });
    });
  }

  function bindHomeButton(button) {
    if (!button) return;
    button.addEventListener("click", function () {
      goHomeToPosts();
    });
  }
  bindHomeButton(els.brandHome);
  bindHomeButton(els.viewerBrandHome);

  if (els.viewNav) {
    els.viewNav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      if (button.dataset.view === "posts") goPostsRecent();
      else {
        setView("pools");
        loadPools({ page: 1 });
      }
    });
  }
  if (els.subNav) {
    els.subNav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sub]");
      if (!button) return;
      activateSub(button.dataset.sub);
    });
  }

  if (els.favoritesPanel) {
    els.favoritesPanel.addEventListener("submit", (event) => {
      event.preventDefault();
      loadFavorites({ page: 1, append: false });
    });
  }
  if (els.authSave) els.authSave.addEventListener("click", signIn);
  if (els.authClear) els.authClear.addEventListener("click", signOut);
  if (els.accountBtn) els.accountBtn.addEventListener("click", openAccountDialog);
  if (els.favOpenAccount) els.favOpenAccount.addEventListener("click", openAccountDialog);
  if (els.accountClose) els.accountClose.addEventListener("click", closeAccountDialog);
  if (els.accountDialog) {
    els.accountDialog.addEventListener("click", function (event) {
      if (event.target === els.accountDialog) closeAccountDialog();
    });
  }
  if (els.authRemember) {
    els.authRemember.addEventListener("change", () => {
      persistAccountIfNeeded();
      updateAuthStatus();
      if (els.authRemember.checked) {
        setStatus(
          isStoragePersistent()
            ? "This device will remember your account." + (hasBasicAuth() ? " The API key is saved on this device." : "")
            : "Your account will be remembered until this tab closes. Storage is blocked."
        );
      } else {
        setStatus("This device will not remember your account.");
      }
    });
  }

  if (els.poolsPanel) {
    els.poolsPanel.addEventListener("submit", (event) => {
      event.preventDefault();
      loadPools({ page: 1 });
    });
  }
  if (els.poolBack) {
    els.poolBack.addEventListener("click", () => {
      state.activePool = null;
      state.poolIds = [];
      state.posts = [];
      loadPools({ page: 1 });
    });
  }

  if (els.popularPanel) {
    els.popularPanel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-pop]");
      if (!button) return;
      const scale = button.dataset.scale;
      const action = button.dataset.pop;
      if (action === "prev") {
        state.popularScale = scale;
        setPopularDate(scale, shiftDate(popularDate(scale), scale, -1));
      } else if (action === "next") {
        state.popularScale = scale;
        setPopularDate(scale, shiftDate(popularDate(scale), scale, 1));
      } else {
        state.popularScale = scale;
      }
      syncPopularButtons();
      updatePopularRange();
      loadPopular({ page: 1, append: false });
    });
  }

  els.prev.addEventListener("click", () => {
    const start = pagerStartPage();
    if (start > 1) reloadCurrent({ page: start - 1, append: false });
  });
  els.next.addEventListener("click", () => {
    if (state.hasMore) reloadCurrent({ page: state.page + 1, append: false });
  });
  els.more.addEventListener("click", () => {
    if (state.hasMore && !appendLimitReached()) {
      reloadCurrent({ page: state.page + 1, append: true });
    }
  });

  if (els.viewerClose) els.viewerClose.addEventListener("click", closeViewer);
  if (els.viewerPrev) els.viewerPrev.addEventListener("click", function () { stepViewer(-1); });
  if (els.viewerNext) els.viewerNext.addEventListener("click", function () { stepViewer(1); });
  if (els.viewerContextBtn) {
    els.viewerContextBtn.addEventListener("click", activateViewerContext);
  }
  if (els.viewerPoolPrev) els.viewerPoolPrev.addEventListener("click", function () { stepPool(-1); });
  if (els.viewerPoolNext) els.viewerPoolNext.addEventListener("click", function () { stepPool(1); });
  if (els.viewerPoolName) els.viewerPoolName.addEventListener("click", activateViewerPool);
  els.viewerQuality.addEventListener("click", () => {
    els.preferSample.checked = !els.preferSample.checked;
    els.preferSample.dispatchEvent(new Event("change"));
  });
  els.viewer.addEventListener("close", clearViewerMedia);
  els.viewer.addEventListener("click", (event) => {
    if (event.target === els.viewer) closeViewer();
  });
  document.addEventListener("keydown", (event) => {
    if (!els.viewer.open) return;
    if (event.key === "Escape") closeViewer();
    if (event.key === "ArrowLeft") stepActiveViewer(-1);
    if (event.key === "ArrowRight") stepActiveViewer(1);
  });
  bindViewerSwipe();
  bindInfiniteScroll();
}

function restorePrefs() {
  const sample = getItem(SAMPLE_KEY);
  if (els.preferSample) els.preferSample.checked = sample !== "0";
  state.blacklist = normalizeBlacklist(parseStoredList(getItem(BLACKLIST_KEY) || "", true));
  state.saved = parseStoredList(getItem(SAVED_KEY) || "");
  const today = todayISO();
  state.popularDates = { day: today, week: today, month: today };
  state.popularScale = "day";
  if (els.favUser) els.favUser.value = getItem(FAV_USER_KEY) || "";
  if (els.authUser) els.authUser.value = getItem(AUTH_USER_KEY) || "";
  const rememberedKey = getItem(AUTH_KEY_KEY);
  const rememberedUser = getItem(AUTH_USER_KEY) || getItem(FAV_USER_KEY);
  if (els.authRemember && (rememberedUser || rememberedKey)) els.authRemember.checked = true;
  if (rememberedKey && rememberedUser) {
    if (els.authRemember) els.authRemember.checked = true;
    if (els.authKey && !els.authKey.value) els.authKey.value = rememberedKey;
    state.pendingAuth = { username: rememberedUser, apiKey: rememberedKey };
  }
  updateAuthStatus();
  renderBlacklist();
  renderSaved();
  syncPopularButtons();
  updatePopularRange();
}

function startApp() {
  try {
    restorePrefs();
  } catch (error) {
    console.error(error);
  }
  try {
    bindEvents();
  } catch (error) {
    console.error(error);
  }
  try {
    setupGate();
  } catch (error) {
    console.error(error);
    setStatus((error && error.message) || "Could not start the app.", "error", { retry: true });
  }
}

startApp();
