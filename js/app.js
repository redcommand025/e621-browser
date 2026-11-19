import {
  buildSearchQuery,
  applyClientFilters,
  filterPools,
  filterPosts,
  filterSuggestions,
  isBlockedTag,
  isValidUsername,
  sanitizeUsername,
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
  blacklistToggle: document.getElementById("blacklist-toggle"),
  blacklistPanel: document.getElementById("blacklist-panel"),
  blacklist: document.getElementById("blacklist"),
  blacklistSave: document.getElementById("blacklist-save"),
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
  popularDate: document.getElementById("popular-date"),
  popularPrev: document.getElementById("popular-prev"),
  popularNext: document.getElementById("popular-next"),
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
  view: "search",
  activePool: null,
  poolIds: [],
  popularScale: "day",
  popularAll: [],
};

function blacklistTags() {
  return tokenize(els.blacklist.value || getItem(BLACKLIST_KEY) || "");
}

function currentQuery() {
  return buildSearchQuery({
    userQuery: els.search.value,
    rating: els.rating.value,
    order: els.sort.value,
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
  els.status.textContent = message || "";
  els.status.dataset.kind = kind;
  if (els.retry) els.retry.hidden = !retry;
}

function showStorageBanner() {
  if (isStoragePersistent()) return;
  els.storageBanner.hidden = false;
  els.storageBanner.textContent =
    "Browser storage is blocked, so the 18+ confirmation and blacklist will reset when this tab closes.";
  setTimeout(() => {
    els.storageBanner.hidden = true;
  }, 15000);
}

function openApp() {
  els.gate.hidden = true;
  els.declined.hidden = true;
  els.app.hidden = false;
  showStorageBanner();
  els.search.focus();
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
  clearViewerMedia();
  if (els.viewer.open && typeof els.viewer.close === "function") els.viewer.close();
  else els.viewer.removeAttribute("open");
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
  if (els.form) els.form.hidden = view !== "search";
  if (els.favoritesPanel) els.favoritesPanel.hidden = view !== "favorites";
  if (els.poolsPanel) els.poolsPanel.hidden = view !== "pools";
  if (els.popularPanel) els.popularPanel.hidden = view !== "popular";
  if (els.poolList) els.poolList.hidden = view !== "pools" || Boolean(state.activePool);
  if (els.poolNav) els.poolNav.hidden = !(view === "pools" && state.activePool);
  els.grid.hidden = view === "pools" && !state.activePool;
  const sortLabel = els.sort && els.sort.closest("label");
  if (sortLabel) sortLabel.hidden = view === "pools" || view === "popular";
  if (view !== "pools") {
    if (els.poolList) els.poolList.innerHTML = "";
  }
  state.posts = [];
  state.popularAll = [];
  state.page = 1;
  state.appended = 0;
  state.hasMore = false;
  state.activeIndex = -1;
  els.grid.innerHTML = "";
  setStatus("");
}

function updateAuthStatus() {
  if (!els.authStatus) return;
  if (hasBasicAuth()) {
    els.authStatus.textContent = `Signed in as ${basicAuthUsername()}. The API key stays in this tab` + (isStoragePersistent() && els.authRemember.checked ? " and on this device." : " only.");
  } else {
    els.authStatus.textContent = "Not signed in. Public favorites still work.";
  }
  if (els.authRememberNote) {
    els.authRememberNote.hidden = isStoragePersistent();
  }
  if (els.authRemember && !isStoragePersistent()) {
    els.authRemember.checked = false;
    els.authRemember.disabled = true;
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
  const remember = Boolean(els.authRemember && els.authRemember.checked && isStoragePersistent());
  setBasicAuth(username, apiKey);
  setItem(AUTH_USER_KEY, username);
  if (remember) setItem(AUTH_KEY_KEY, apiKey);
  else removeAuthKey();
  els.authKey.value = "";
  if (els.favUser && !els.favUser.value) els.favUser.value = username;
  updateAuthStatus();
  setStatus("Signed in. Private favorites will use this API key.");
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
  setItem(FAV_USER_KEY, username);
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
  const date = clampDate((els.popularDate && els.popularDate.value) || todayISO());
  if (els.popularDate) els.popularDate.value = date;
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
  if (state.view === "favorites") return loadFavorites({ page, append });
  if (state.view === "pools") {
    if (state.activePool) return loadPoolPosts({ page, append });
    return loadPools({ page });
  }
  if (state.view === "popular") return loadPopular({ page, append });
  return loadPage({ page, append });
}

function setPopularScale(scale) {
  state.popularScale = scale;
  if (els.popularPanel) {
    for (const button of els.popularPanel.querySelectorAll("[data-scale]")) {
      button.setAttribute("aria-selected", button.dataset.scale === scale ? "true" : "false");
    }
  }
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
    if (state.view !== "search" || state.posts.length || els.search.value.trim()) {
      reloadCurrent({ page: 1, append: false });
    }
  });
  els.sort.addEventListener("change", () => {
    if (state.view === "search" || state.view === "favorites") {
      if (state.posts.length || els.search.value.trim() || (els.favUser && els.favUser.value.trim())) {
        reloadCurrent({ page: 1, append: false });
      }
    }
  });
  els.preferSample.addEventListener("change", () => {
    setItem(SAMPLE_KEY, els.preferSample.checked ? "1" : "0");
    if (els.viewer.open && state.activeIndex >= 0) renderViewer();
  });

  els.blacklistToggle.addEventListener("click", () => {
    els.blacklistPanel.hidden = !els.blacklistPanel.hidden;
  });
  els.blacklistSave.addEventListener("click", () => {
    setItem(BLACKLIST_KEY, els.blacklist.value.trim());
    setStatus("Blacklist saved for this session" + (isStoragePersistent() ? " and browser storage." : ". Storage is blocked, so it will not persist."));
    if (state.posts.length || state.view !== "search") reloadCurrent({ page: 1, append: false });
  });

  if (els.retry) {
    els.retry.addEventListener("click", () => {
      reloadCurrent({ page: Math.max(1, state.page), append: false });
    });
  }

  if (els.viewNav) {
    els.viewNav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      setView(button.dataset.view);
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
      const button = event.target.closest("[data-scale]");
      if (!button) return;
      setPopularScale(button.dataset.scale);
      loadPopular({ page: 1, append: false });
    });
  }
  if (els.popularDate) {
    els.popularDate.addEventListener("change", () => {
      loadPopular({ page: 1, append: false });
    });
  }
  if (els.popularPrev) {
    els.popularPrev.addEventListener("click", () => {
      const scale = state.popularScale || "day";
      els.popularDate.value = shiftDate(els.popularDate.value || todayISO(), scale, -1);
      loadPopular({ page: 1, append: false });
    });
  }
  if (els.popularNext) {
    els.popularNext.addEventListener("click", () => {
      const scale = state.popularScale || "day";
      els.popularDate.value = shiftDate(els.popularDate.value || todayISO(), scale, 1);
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
  els.preferSample.checked = sample !== "0";
  els.blacklist.value = getItem(BLACKLIST_KEY) || "";
  if (els.favUser) els.favUser.value = getItem(FAV_USER_KEY) || "";
  if (els.authUser) els.authUser.value = getItem(AUTH_USER_KEY) || "";
  if (els.popularDate && !els.popularDate.value) els.popularDate.value = todayISO();
  const rememberedKey = getItem(AUTH_KEY_KEY);
  const rememberedUser = getItem(AUTH_USER_KEY);
  if (rememberedKey && rememberedUser && isStoragePersistent()) {
    setBasicAuth(rememberedUser, rememberedKey);
    if (els.authRemember) els.authRemember.checked = true;
  }
  updateAuthStatus();
  setView("search");
}

setupGate();
restorePrefs();
bindEvents();
