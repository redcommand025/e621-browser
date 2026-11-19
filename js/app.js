import {
  buildSearchQuery,
  filterPosts,
  filterSuggestions,
  isBlockedTag,
  tokenize,
} from "./filter.js";
import {
  getItem,
  setItem,
  isStoragePersistent,
} from "./storage.js";
import {
  PAGE_LIMIT,
  fetchAutocomplete,
  fetchPosts,
  formatCount,
  isVideoPost,
  originalUrl,
  postPageUrl,
  previewUrl,
  sampleImageUrl,
  videoSources,
} from "./api.js";

const AGE_KEY = "e621-browser:age-ok";
const SAMPLE_KEY = "e621-browser:prefer-sample";
const BLACKLIST_KEY = "e621-browser:blacklist";
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

function setStatus(message, kind = "") {
  els.status.textContent = message || "";
  els.status.dataset.kind = kind;
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
    const posts = filterPosts(
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
    setStatus(error.message || "Search failed.", "error");
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
    loadPage({ page: state.page + 1, append: true });
  });
  observer.observe(els.sentinel);
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
    if (state.posts.length || els.search.value.trim()) searchFromStart();
  });
  els.sort.addEventListener("change", () => {
    if (state.posts.length || els.search.value.trim()) searchFromStart();
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
    if (state.posts.length) searchFromStart();
  });

  els.prev.addEventListener("click", () => {
    if (state.page > 1) loadPage({ page: state.page - 1, append: false });
  });
  els.next.addEventListener("click", () => {
    if (state.hasMore) loadPage({ page: state.page + 1, append: false });
  });
  els.more.addEventListener("click", () => {
    if (state.hasMore && state.appended < MAX_APPENDED_PAGES) {
      loadPage({ page: state.page + 1, append: true });
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
}

setupGate();
restorePrefs();
bindEvents();
