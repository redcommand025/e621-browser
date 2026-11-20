import {
  buildSearchQuery,
  applyClientFilters,
  filterPools,
  filterPosts,
  filterSuggestions,
  isBlockedTag,
  isValidUsername,
  sanitizeUsername,
  tagName,
  tokenize,
} from "./filter.js";
import {
  getItem,
  setItem,
  removeItem,
  isStoragePersistent,
} from "./storage.js";
import {
  PAGE_LIMIT,
  basicAuthUsername,
  clearBasicAuth,
  fetchAutocomplete,
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
  videoSources,
} from "./api.js";

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
  popularScale: "day",
  popularDates: {},
  popularAll: [],
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
    button.addEventListener("click", () => openViewer(i));
    els.grid.append(button);
  }
  els.pageLabel.textContent = `Page ${state.page}`;
  els.prev.disabled = state.page <= 1 || state.loading;
  els.next.disabled = !state.hasMore || state.loading;
  els.more.disabled =
    !state.hasMore || state.loading || state.appended >= MAX_APPENDED_PAGES;
  els.more.hidden = state.appended >= MAX_APPENDED_PAGES && state.hasMore === false;
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

function renderViewer() {
  const post = state.posts[state.activeIndex];
  if (!post) return;
  els.viewerOpen.href = postPageUrl(post);
  els.viewerMeta.textContent = `#${post.id} · ${String(post.rating || "").toUpperCase()}`;
  els.viewerPrev.disabled = state.activeIndex <= 0;
  els.viewerNext.disabled = state.activeIndex >= state.posts.length - 1;
  updateQualityButton(post);
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
  renderViewer();
  if (typeof els.viewer.showModal === "function") els.viewer.showModal();
  else els.viewer.setAttribute("open", "");
}

function closeViewer() {
  try {
    if (els.viewerStage) clearViewerMedia();
    if (!els.viewer) return;
    if (els.viewer.open && typeof els.viewer.close === "function") els.viewer.close();
    else els.viewer.removeAttribute("open");
  } catch (error) {
    console.error(error);
  }
}

function stepViewer(delta) {
  const next = state.activeIndex + delta;
  if (next < 0 || next >= state.posts.length) return;
  state.activeIndex = next;
  renderViewer();
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
      stepViewer(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}

function bindInfiniteScroll() {
  if (!("IntersectionObserver" in window) || !els.sentinel) return;
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (state.loading || !state.hasMore || state.appended >= MAX_APPENDED_PAGES) return;
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

function beginLoad(message) {
  state.loading = true;
  els.prev.disabled = true;
  els.next.disabled = true;
  els.more.disabled = true;
  setStatus(message || "Loading…");
}

function finishLoad() {
  state.loading = false;
  els.prev.disabled = state.page <= 1 || state.loading;
  els.next.disabled = !state.hasMore || state.loading;
  els.more.disabled =
    !state.hasMore || state.loading || state.appended >= MAX_APPENDED_PAGES;
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
    setStatus("Enter an e621 username to load favorites.");
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

function updateAuthStatus() {
  if (!els.authStatus) return;
  const remember = Boolean(els.authRemember && els.authRemember.checked);
  if (hasBasicAuth()) {
    els.authStatus.textContent = `Signed in as ${basicAuthUsername()}. The API key stays in this tab` + (remember && isStoragePersistent() ? " and on this device." : " only.");
  } else {
    els.authStatus.textContent = "Not signed in. Public favorites still work.";
  }
  if (els.authRememberNote) {
    els.authRememberNote.hidden = isStoragePersistent();
  }
}

function removeAuthKey() {
  removeItem(AUTH_KEY_KEY);
}

function signIn() {
  const username = sanitizeUsername(els.authUser.value);
  const apiKey = (els.authKey.value || "").trim();
  if (!isValidUsername(username) || !apiKey) {
    setStatus("Enter a username and API key to sign in.", "error");
    return;
  }
  const remember = Boolean(els.authRemember && els.authRemember.checked);
  setBasicAuth(username, apiKey);
  if (remember) {
    setItem(AUTH_USER_KEY, username);
    setItem(AUTH_KEY_KEY, apiKey);
    if (els.favUser && !els.favUser.value) els.favUser.value = username;
    persistAccountIfNeeded();
  } else {
    removeAuthKey();
  }
  els.authKey.value = "";
  if (els.favUser && !els.favUser.value) els.favUser.value = username;
  updateAuthStatus();
  const keyNote = remember
    ? (isStoragePersistent() ? " The API key is saved on this device." : " Storage is blocked, so the API key is remembered only until this tab closes.")
    : "";
  setStatus("Signed in. Private favorites will use this API key." + keyNote);
}

function signOut() {
  clearBasicAuth();
  removeAuthKey();
  if (els.authKey) els.authKey.value = "";
  updateAuthStatus();
  setStatus("Signed out. The API key was cleared from memory.");
}

async function loadFavorites({ page, append }) {
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

function renderPoolList(pools) {
  els.grid.hidden = true;
  els.poolList.hidden = false;
  els.poolList.innerHTML = "";
  for (const pool of pools) {
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

async function loadPools({ page }) {
  const abort = abortSearch();
  beginLoad("Loading pools…");
  try {
    const pools = filterPools(
      await fetchPools({
        name: (els.poolSearch && els.poolSearch.value.trim()) || "",
        order: (els.poolOrder && els.poolOrder.value) || "updated_at",
        page,
        limit: PAGE_LIMIT,
        signal: abort.signal,
      })
    );
    state.activePool = null;
    state.poolIds = [];
    state.posts = [];
    state.page = page;
    state.appended = 0;
    state.hasMore = pools.length >= PAGE_LIMIT && page < MAX_PAGE;
    if (els.poolNav) els.poolNav.hidden = true;
    renderPoolList(pools);
    if (!pools.length) setStatus("No pools found.", "warn");
    else setStatus(`${pools.length} pools loaded.`);
    finishLoad();
    fillPoolCovers(pools).catch(() => {});
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus(error.message || "Could not load pools.", "error", { retry: true });
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
    return loadPools({ page });
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
    if (state.page > 1) reloadCurrent({ page: state.page - 1, append: false });
  });
  els.next.addEventListener("click", () => {
    if (state.hasMore) reloadCurrent({ page: state.page + 1, append: false });
  });
  els.more.addEventListener("click", () => {
    if (state.hasMore && state.appended < MAX_APPENDED_PAGES) {
      reloadCurrent({ page: state.page + 1, append: true });
    }
  });

  els.viewerClose.addEventListener("click", closeViewer);
  els.viewerPrev.addEventListener("click", () => stepViewer(-1));
  els.viewerNext.addEventListener("click", () => stepViewer(1));
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
    if (event.key === "ArrowLeft") stepViewer(-1);
    if (event.key === "ArrowRight") stepViewer(1);
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
    setBasicAuth(rememberedUser, rememberedKey);
    if (els.authRemember) els.authRemember.checked = true;
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
