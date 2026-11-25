import {
  buildSearchQuery,
  applyClientFilters,
  blacklistForQuery,
  filterPools,
  filterPosts,
  filterSuggestions,
  collectTagsByCategory,
  formatPoolName,
  formatPostStats,
  formatTagCategoryLabel,
  isValidUsername,
  poolResponseHasMore,
  poolDirectionOpen,
  shouldFetchMorePools,
  postChildIds,
  postHasActiveChildren,
  postParentId,
  postPoolIds,
  stepPoolIds,
  sanitizeUsername,
  queryHasMetatag,
  tagName,
  tokenMetatag,
  tokenize,
  fitTagLimit,
} from "./filter.js?v=20261125c";
import {
  getItem,
  setItem,
  removeItem,
  isStoragePersistent,
} from "./storage.js?v=20261125c";
import {
  PAGE_LIMIT,
  POOL_PAGE_LIMIT,
  basicAuthUsername,
  clearBasicAuth,
  favoritePost,
  fetchAutocomplete,
  fetchComments,
  fetchUser,
  postComment,
  updateAccountBlacklist,
  fetchNotes,
  fetchTagsByNames,
  fetchTagAliases,
  fetchTagImplications,
  fetchWikiPage,
  COMMENT_PAGE_LIMIT,
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
  unfavoritePost,
  verifyBasicAuth,
  videoSources,
  votePost,
} from "./api.js?v=20261125c";
import { dtextExcerpt, dtextWikiTitles, parseDText } from "./dtext.js?v=20261125c";
import {
  METATAGS,
  SEARCH_SYNTAX_HELP,
  metatagSuggestions,
  singleSearchTag,
  splitTermPrefix,
} from "./search.js?v=20261125c";
import { tagCategoryColor, tagCategoryName } from "./tagcolors.js?v=20261125c";
import {
  RATINGS,
  RATING_NAMES,
  downloadFilename,
  normalizeRatings,
  profileSearches,
  profileStats,
} from "./account.js?v=20261125c";
import {
  mergeBlacklists,
  normalizeBlacklistLine,
  normalizeBlacklistLines,
  parseBlacklistText,
  sameBlacklist,
  serializeBlacklist,
  singleTagLines,
} from "./blacklist.js?v=20261125c";
import {
  activeNotes,
  aggregatePageTags,
  applyFavoriteChange,
  applyVoteResult,
  formatPostDate,
  mergeRelatedTags,
  noteBoxPercent,
  postDetails,
  postFileInfo,
  postHasNotes,
  postIsFavorited,
  postUserVote,
  searchTagNames,
  tagNameBatches,
  tagRelations,
  voteRequestParams,
} from "./postinfo.js?v=20261125c";

const AGE_KEY = "e621-browser:age-ok";
const SAMPLE_KEY = "e621-browser:prefer-sample";
const BLACKLIST_KEY = "e621-browser:blacklist";
const FAV_USER_KEY = "e621-browser:fav-user";
const AUTH_USER_KEY = "e621-browser:auth-user";
const AUTH_KEY_KEY = "e621-browser:auth-key";
const SAVED_KEY = "e621-browser:saved-searches";
const COMMENTS_HIDDEN_KEY = "e621-browser:comments-hidden";
const DISPLAY_KEY = "e621-browser:display";
// Last blacklist both sides agreed on, per account, for the three-way merge.
const BLACKLIST_BASE_KEY = "e621-browser:blacklist-synced";
const BLACKLIST_SYNC_DEBOUNCE_MS = 700;
// Posts with this many comments or fewer load in one request.
const COMMENTS_ONE_PAGE = 75;
const LONG_PRESS_MS = 500;
const AUTOCOMPLETE_MIN = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 350;
const MAX_APPENDED_PAGES = 5;
// Pool pages: when a 24-post chunk has fewer than POOL_FILL_MIN visible posts,
// fetch up to POOL_FILL_MAX_REQUESTS more requests of POOL_FILL_CHUNKS chunks
// (72 ids; e621 allows up to 100 ids in one id: search).
const POOL_FILL_MIN = 12;
const POOL_FILL_CHUNKS = 3;
const POOL_FILL_MAX_REQUESTS = 2;
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
  ratingBoxes: RATINGS.map((r) => document.getElementById("rating-" + r)).filter(Boolean),
  displayBtn: document.getElementById("display-btn"),
  displayMenu: document.getElementById("display-menu"),
  displayClose: document.getElementById("display-close"),
  displayNote: document.getElementById("display-note"),
  sortLabel: document.getElementById("sort-label"),
  accountMenu: document.getElementById("account-menu"),
  accountMenuProfile: document.getElementById("account-menu-profile"),
  accountMenuAvatar: document.getElementById("account-menu-avatar"),
  accountMenuName: document.getElementById("account-menu-name"),
  accountMenuFavorites: document.getElementById("account-menu-favorites"),
  accountMenuLogout: document.getElementById("account-menu-logout"),
  profileDialog: document.getElementById("profile-dialog"),
  profileClose: document.getElementById("profile-close"),
  profileOpen: document.getElementById("profile-open"),
  profileAvatar: document.getElementById("profile-avatar"),
  profileName: document.getElementById("profile-name"),
  profileLevel: document.getElementById("profile-level"),
  profileJoined: document.getElementById("profile-joined"),
  profileStatus: document.getElementById("profile-status"),
  profileStats: document.getElementById("profile-stats"),
  profileSections: document.getElementById("profile-sections"),
  profileAbout: document.getElementById("profile-about"),
  profileAboutWrap: document.getElementById("profile-about-wrap"),
  profileArtinfo: document.getElementById("profile-artinfo"),
  profileArtinfoWrap: document.getElementById("profile-artinfo-wrap"),
  profileSettings: document.getElementById("profile-settings"),
  blacklistSyncStatus: document.getElementById("blacklist-sync-status"),
  blacklistSyncNow: document.getElementById("blacklist-sync-now"),
  viewerDownload: document.getElementById("viewer-download"),
  viewerFullscreen: document.getElementById("viewer-fullscreen"),
  commentAdd: document.getElementById("comment-add"),
  commentForm: document.getElementById("comment-form"),
  commentText: document.getElementById("comment-text"),
  commentPost: document.getElementById("comment-post"),
  commentPreviewBtn: document.getElementById("comment-preview-btn"),
  commentCancel: document.getElementById("comment-cancel"),
  commentPreview: document.getElementById("comment-preview"),
  commentStatus: document.getElementById("comment-status"),
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
  viewerFav: document.getElementById("viewer-fav"),
  viewerUp: document.getElementById("viewer-up"),
  viewerDown: document.getElementById("viewer-down"),
  viewerNotesToggle: document.getElementById("viewer-notes-toggle"),
  viewerActionStatus: document.getElementById("viewer-action-status"),
  viewerComments: document.getElementById("viewer-comments"),
  viewerCommentsTitle: document.getElementById("viewer-comments-title"),
  viewerCommentsList: document.getElementById("viewer-comments-list"),
  viewerCommentsStatus: document.getElementById("viewer-comments-status"),
  viewerCommentsMore: document.getElementById("viewer-comments-more"),
  viewerDetailsList: document.getElementById("viewer-details-list"),
  viewerDescription: document.getElementById("viewer-description"),
  relatedBtn: document.getElementById("related-btn"),
  relatedPanel: document.getElementById("related-panel"),
  relatedNote: document.getElementById("related-note"),
  relatedList: document.getElementById("related-list"),
  viewerCommentsToggle: document.getElementById("viewer-comments-toggle"),
  viewerCommentsBody: document.getElementById("viewer-comments-body"),
  wikiPreview: document.getElementById("wiki-preview"),
  wikiPreviewTitle: document.getElementById("wiki-preview-title"),
  wikiPreviewBody: document.getElementById("wiki-preview-body"),
  wikiPreviewMore: document.getElementById("wiki-preview-more"),
  wikiDialog: document.getElementById("wiki-dialog"),
  wikiClose: document.getElementById("wiki-close"),
  wikiOpen: document.getElementById("wiki-open"),
  wikiTitle: document.getElementById("wiki-title"),
  wikiTag: document.getElementById("wiki-tag"),
  wikiStatus: document.getElementById("wiki-status"),
  wikiRelations: document.getElementById("wiki-relations"),
  wikiBody: document.getElementById("wiki-body"),
  wikiMentions: document.getElementById("wiki-mentions"),
  wikiMentionsList: document.getElementById("wiki-mentions-list"),
  tagMenu: document.getElementById("tag-menu"),
  tagMenuTitle: document.getElementById("tag-menu-title"),
  tagMenuStatus: document.getElementById("tag-menu-status"),
  searchHelp: document.getElementById("search-help"),
  searchHelpBtn: document.getElementById("search-help-btn"),
  searchHelpClose: document.getElementById("search-help-close"),
  searchHelpSyntax: document.getElementById("search-help-syntax"),
  searchHelpMetatags: document.getElementById("search-help-metatags"),
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
  actionBusy: false,
  notesVisible: true,
  notesCache: {},
  noteSeq: 0,
  comments: { postId: null, page: 0, loading: false, done: false, seq: 0, limit: COMMENT_PAGE_LIMIT },
  commentBusy: false,
  display: { size: "normal", shape: "cropped" },
  authUser: null,
  avatarCache: new Map(),
  avatarSeq: 0,
  profileSeq: 0,
  blacklistSync: { busy: false, again: false, timer: 0, lastOk: 0 },
  downloadBusy: false,
  // Grid position memory: bumped whenever a new result list replaces the
  // current one (new search, view change), but not by Prev/Next paging
  // from inside the viewer.
  resultsEpoch: 0,
  viewerPaging: false,
  gridMemory: null,
  poolListMemory: null,
  // Browser Back closes the viewer / leaves a pool first (same-URL history entries).
  historyLayers: [],
  ignorePops: 0,
  pendingBack: 0,
  commentsObserver: null,
  tagCounts: new Map(),
  tagCategories: new Map(),
  commentsHidden: false,
  wikiCache: new Map(),
  relationCache: new Map(),
  wikiSeq: 0,
  wikiPreviewSeq: 0,
  wikiPreviewTag: "",
  tagMenuName: "",
  // The finger that long-pressed is still down when the menu opens; its
  // release "click" must not hit the backdrop or a menu item.
  tagMenuGuard: false,
  tagCountSeq: 0,
  relatedSeq: 0,
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

function normalizeBlacklist(lines) {
  return normalizeBlacklistLines(lines);
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

/** Allowed rating letters from the display menu's checkboxes (never empty). */
function selectedRatings() {
  const picked = els.ratingBoxes.filter((box) => box.checked).map((box) => box.value);
  return normalizeRatings(picked);
}

function currentQuery() {
  return buildSearchQuery({
    userQuery: els.search.value,
    rating: selectedRatings(),
    order: els.sort.value,
    blacklist: blacklistTags(),
  });
}

// The rating checkboxes filter results unless the search sets its own rating:.
// Blacklist lines naming a tag the search asks for are not applied.
function clientFilter(posts, { query = null } = {}) {
  let rating = selectedRatings();
  let blacklist = blacklistTags();
  if (query != null) {
    if (queryHasMetatag(query, "rating")) rating = "all";
    blacklist = blacklistForQuery(blacklist, query);
  }
  return applyClientFilters(posts, { rating, blacklist });
}

// Rating + blacklist exclusions sent beside an id:1,2,3 lookup. A long
// (synced) blacklist used to push these lookups past e621's 40-tag limit,
// which failed every pool page; one slot is now kept for the id: metatag.
function exclusionTagString() {
  return fitTagLimit(
    buildSearchQuery({
      userQuery: "",
      rating: selectedRatings(),
      order: "",
      blacklist: blacklistTags(),
    }).tags,
    1
  );
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

function applySuggestion(value) {
  const input = els.search;
  const caret = input.selectionStart ?? input.value.length;
  const term = lastSearchTerm(input.value, caret);
  const prefix = input.value.slice(0, caret - term.length);
  const suffix = input.value.slice(caret);
  // Keep a -, ~, or -( style prefix the user typed.
  const { prefix: mark } = splitTermPrefix(term);
  // A metatag name ("order:") stays open so its values can be suggested next.
  const open = /:$/.test(value);
  const insert = mark + value + (open ? "" : " ");
  const rest = open ? suffix : suffix.replace(/^\s*/, "");
  input.value = (prefix + insert + rest).replace(/\s+$/, open ? "" : " ");
  const pos = (prefix + insert).length;
  input.focus();
  input.setSelectionRange(pos, pos);
  hideSuggestions();
  if (open) requestSuggestions();
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
      label.textContent = item.label || item.name;
    }
    const count = document.createElement("span");
    count.className = "suggest-count";
    if (item.kind) {
      li.classList.add("suggest-meta");
      count.textContent = item.hint || "";
      li.append(label, count);
    } else {
      const category = tagCategoryName(item.category);
      if (category) {
        li.dataset.category = category;
        li.style.setProperty("--tag-color", tagCategoryColor(category));
        rememberTagCategory(item.name, category);
      }
      count.textContent = formatCount(item.post_count);
      const wiki = document.createElement("button");
      wiki.type = "button";
      wiki.className = "secondary suggest-wiki";
      wiki.textContent = "?";
      wiki.tabIndex = -1;
      wiki.setAttribute("aria-label", "Open the wiki for " + item.name);
      wiki.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      wiki.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideSuggestions();
        openWiki(item.name);
      });
      li.append(label, count, wiki);
    }
    li.addEventListener("mousedown", (event) => {
      if (event.target.closest(".suggest-wiki")) return;
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
  const { body } = splitTermPrefix(termRaw.replace(/^-?\(/, ""));
  // Metatags: names ("ord" -> order:) and enum values ("order:sc" -> order:score).
  const metas = metatagSuggestions(body).map((m) => ({ name: m.value, label: m.label, hint: m.hint, kind: m.kind }));
  if (body.includes(":")) {
    if (metas.length) renderSuggestions(metas);
    else hideSuggestions();
    return;
  }
  if (body.length < AUTOCOMPLETE_MIN || body.includes("*")) {
    if (metas.length) renderSuggestions(metas);
    else hideSuggestions();
    return;
  }
  if (state.suggestAbort) state.suggestAbort.abort();
  const abort = new AbortController();
  state.suggestAbort = abort;
  const seq = ++state.suggestSeq;
  try {
    const results = await fetchAutocomplete(body, { signal: abort.signal });
    if (seq !== state.suggestSeq) return;
    renderSuggestions([...metas.slice(0, 3), ...results]);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (metas.length) renderSuggestions(metas);
    else hideSuggestions();
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
    // Used by the "Full" thumbnail shape to keep each picture's own shape.
    const dims = (post.files && (post.files.preview || post.files.original)) || post.preview || post.file || {};
    const w = Number(dims.width);
    const h = Number(dims.height);
    if (w > 0 && h > 0) button.style.setProperty("--thumb-ratio", String(Math.min(3, Math.max(1 / 3, w / h))));
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
  if (!append) markNewResults();
  const built = currentQuery();
  if (!append) updateWikiPreview();
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
      }),
      { query: els.search.value }
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
  closeRelatedPanel();
  return loadPage({ page: 1, append: false });
}

function preferSample() {
  return els.preferSample.checked;
}

function clearViewerMedia() {
  resetViewerZoom();
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
  video.loop = true;
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
  // The wrapper (not the image) receives the zoom transform, so the notes
  // layer inside it stays aligned with the picture while pinched or panned.
  const wrap = document.createElement("div");
  wrap.className = "media-wrap";
  wrap.append(img);
  img.addEventListener("load", layoutNotesLayer);
  els.viewerStage.append(wrap);
  loadViewerNotes(post);
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
  if (!pool || !formatPoolName(pool.name)) {
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
            if (formatPoolName(pool.name)) {
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
  if (current) {
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
      if (!pool) {
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
    const color = tagCategoryColor(group.category);
    if (color) title.style.color = color;
    wrap.append(title);
    for (const name of group.tags) {
      rememberTagCategory(name, group.category);
      wrap.append(
        createTagChip(name, {
          category: group.category,
          rowClass: "tag-row",
          onTap: () => applyTagToSearch("replace", name),
        })
      );
    }
    els.viewerTags.append(wrap);
  }
  loadViewerTagCounts(post);
}

function applyTagToSearch(mode, raw) {
  const name = tagName(raw);
  if (!name) return;
  const tokens = tokenize(els.search && els.search.value);
  const others = tokens.filter(function (token) {
    return tokenMetatag(token) || tagName(token) !== name;
  });
  let next;
  if (mode === "replace") next = [name];
  else if (mode === "add") next = [...others, name];
  else if (mode === "or") next = [...others, "~" + name];
  else next = [...others, "-" + name];
  if (els.search) els.search.value = next.join(" ");
  closeTagMenu();
  closeWiki();
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
  renderViewerActions(post);
  setActionStatus("");
  hideNotePopup();
  updateNotesToggle(post, 0);
  renderViewerComments(post);
  renderViewerTags(post);
  renderViewerDetails(post);
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

/* ---------- Grid position memory ---------- */

// A new result list (search, view change, pool) replaces the grid. Viewer
// Prev/Next paging does not count: the grid keeps its scroll and the closed
// viewer scrolls to the last-viewed thumb instead.
function markNewResults() {
  if (state.viewerPaging) return;
  state.resultsEpoch += 1;
  state.gridMemory = null;
}

function viewerPaging(load) {
  state.viewerPaging = true;
  let result;
  try {
    result = load();
  } finally {
    state.viewerPaging = false;
  }
  return Promise.resolve(result);
}

function scrollToY(y) {
  try {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
  } catch (error) {
    window.scrollTo(0, y);
  }
}

function centerElement(el) {
  const rect = el.getBoundingClientRect();
  const top = window.scrollY + rect.top - (window.innerHeight - rect.height) / 2;
  scrollToY(Math.max(0, Math.round(top)));
}

function flashElement(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  setTimeout(function () {
    el.classList.remove(className);
  }, 1600);
}

// Runs on the dialog's close event. The dialog hands focus back to the
// thumb that opened it, and iOS Safari may restore its own scroll, so the
// position is applied now, on the next frame, and once more shortly after.
function restoreGridAfterViewer() {
  const memory = state.gridMemory;
  state.gridMemory = null;
  if (!memory || memory.epoch !== state.resultsEpoch || els.grid.hidden) return;
  const post = state.viewerPost;
  const moved = !!(post && memory.postId != null && post.id !== memory.postId);
  let thumb = null;
  if (moved) {
    const index = state.posts.findIndex(function (item) {
      return item && item.id === post.id;
    });
    if (index >= 0) thumb = els.grid.querySelector('.thumb[data-index="' + index + '"]');
  }
  const apply = function () {
    if (thumb && thumb.isConnected) centerElement(thumb);
    else scrollToY(memory.scrollY);
  };
  apply();
  if (thumb) {
    try {
      thumb.focus({ preventScroll: true });
    } catch (error) {
      /* ignore */
    }
    flashElement(thumb, "thumb-recent");
  }
  const target = window.scrollY;
  requestAnimationFrame(apply);
  setTimeout(function () {
    // Re-apply only if something other than the user moved the page.
    if (Math.abs(window.scrollY - target) > 1 && !state.userScrolledAfterClose) apply();
  }, 120);
  state.userScrolledAfterClose = false;
  const onUser = function () {
    state.userScrolledAfterClose = true;
  };
  window.addEventListener("touchmove", onUser, { once: true, passive: true });
  window.addEventListener("wheel", onUser, { once: true, passive: true });
  setTimeout(function () {
    window.removeEventListener("touchmove", onUser);
    window.removeEventListener("wheel", onUser);
  }, 200);
}

// Back from a pool: show the kept pool list as it was, without refetching.
function backToPoolList() {
  const memory = state.poolListMemory;
  state.poolListMemory = null;
  if (!memory || state.view !== "pools" || !els.poolList || !els.poolList.childElementCount) {
    state.activePool = null;
    state.poolIds = [];
    state.posts = [];
    return loadPools({ page: 1 });
  }
  if (els.viewer.open) closeViewer();
  abortSearch();
  state.loading = false;
  markNewResults();
  state.activePool = null;
  state.poolIds = [];
  state.posts = [];
  state.activeIndex = -1;
  state.pools = memory.pools;
  state.page = memory.page;
  state.pageStart = memory.pageStart;
  state.hasMore = memory.hasMore;
  state.appended = memory.appended;
  if (els.poolSearch) els.poolSearch.value = memory.search;
  if (els.poolOrder && memory.order) els.poolOrder.value = memory.order;
  els.grid.innerHTML = "";
  els.grid.hidden = true;
  els.poolList.hidden = false;
  if (els.poolNav) els.poolNav.hidden = true;
  setStatus(memory.status);
  updatePager();
  scrollToY(memory.scrollY);
  requestAnimationFrame(function () {
    scrollToY(memory.scrollY);
  });
  const item = els.poolList.querySelector('[data-pool-id="' + memory.poolId + '"]');
  if (item) {
    try {
      item.focus({ preventScroll: true });
    } catch (error) {
      /* ignore */
    }
    flashElement(item, "thumb-recent");
  }
  return Promise.resolve();
}

/* ---------- Browser Back for the viewer and pools ----------
   The app has no URLs per view. Opening the viewer or a pool adds a
   same-URL history entry, so the phone/browser Back button closes the
   viewer or returns to the pool list instead of leaving the site. Closing
   them from the UI removes the entry again. */

function pushHistoryLayer(name) {
  if (!window.history || typeof history.pushState !== "function") return;
  if (state.historyLayers.indexOf(name) >= 0) return;
  try {
    if (state.pendingBack > 0) {
      // A layer was just closed and its entry is still current: reuse it.
      state.pendingBack -= 1;
      history.replaceState({ e621Layer: name }, "");
    } else {
      history.pushState({ e621Layer: name }, "");
    }
    state.historyLayers.push(name);
  } catch (error) {
    /* history unavailable (sandboxed frame); ignore */
  }
}

function dropHistoryLayer(name) {
  const index = state.historyLayers.lastIndexOf(name);
  if (index < 0) return;
  state.pendingBack += state.historyLayers.length - index;
  state.historyLayers.length = index;
  queueMicrotask(flushHistoryBack);
}

function flushHistoryBack() {
  const count = state.pendingBack;
  if (count <= 0) return;
  state.pendingBack = 0;
  state.ignorePops += 1;
  history.go(-count);
}

function onHistoryPop() {
  if (state.ignorePops > 0) {
    state.ignorePops -= 1;
    return;
  }
  const top = state.historyLayers.pop();
  if (top === "viewer") {
    if (els.viewer.open) closeViewer();
  } else if (top === "pool") {
    if (state.view === "pools" && state.activePool) backToPoolList();
  }
}

function openViewer(index) {
  if (!els.viewer.open) {
    const post = state.posts[index];
    state.gridMemory = {
      scrollY: window.scrollY,
      postId: post ? post.id : null,
      epoch: state.resultsEpoch,
    };
    pushHistoryLayer("viewer");
  }
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
  dropHistoryLayer("viewer");
  if (fullscreenElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(document)).catch(() => {});
  }
  try {
    if (els.viewerStage) clearViewerMedia();
    if (els.viewerTags) els.viewerTags.innerHTML = "";
    resetViewerComments(null);
    hideNotePopup();
    state.noteSeq += 1;
    state.tagCountSeq += 1;
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
    return viewerPaging(() => reloadCurrent({ page: state.page + 1, append: true })).then(function () {
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
    return viewerPaging(() => reloadCurrent({ page: state.page - 1, append: false })).then(function () {
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

/* ---------- DText rendering (safe: DOM nodes and textContent only) ---------- */

const DTEXT_INLINE_ELEMENTS = {
  b: "strong",
  i: "em",
  u: "u",
  s: "s",
  sup: "sup",
  sub: "sub",
  span: "span",
  small: "small",
};

function appendDTextNodes(parent, nodes) {
  for (const node of nodes || []) {
    let el = null;
    switch (node.type) {
      case "text":
        parent.append(document.createTextNode(node.text));
        continue;
      case "br":
        parent.append(document.createElement("br"));
        continue;
      case "link":
        el = document.createElement("a");
        el.href = node.href;
        el.target = "_blank";
        el.rel = "noopener noreferrer nofollow";
        if (node.wiki) el.dataset.wiki = node.wiki;
        if (node.search) el.dataset.search = node.search;
        break;
      case "spoiler":
        el = document.createElement("span");
        el.className = "dtext-spoiler";
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", "Spoiler, tap to reveal");
        el.addEventListener("click", () => el.classList.toggle("revealed"));
        break;
      case "p":
        el = document.createElement("p");
        break;
      case "heading":
        el = document.createElement("p");
        el.className = "dtext-heading";
        break;
      case "quote":
        el = document.createElement("blockquote");
        break;
      case "code": {
        const pre = document.createElement("pre");
        pre.textContent = node.text;
        parent.append(pre);
        continue;
      }
      case "section": {
        const details = document.createElement("details");
        details.open = Boolean(node.expanded);
        const summary = document.createElement("summary");
        summary.textContent = node.title || "Show";
        details.append(summary);
        appendDTextNodes(details, node.children);
        parent.append(details);
        continue;
      }
      case "list": {
        const ul = document.createElement("ul");
        for (const item of node.items) {
          const li = document.createElement("li");
          if (item.level > 1) li.style.marginLeft = (item.level - 1) * 1 + "em";
          appendDTextNodes(li, item.children);
          ul.append(li);
        }
        parent.append(ul);
        continue;
      }
      default:
        el = document.createElement(DTEXT_INLINE_ELEMENTS[node.type] || "span");
    }
    if (node.children) appendDTextNodes(el, node.children);
    parent.append(el);
  }
}

function renderDTextInto(container, source) {
  container.textContent = "";
  container.classList.add("dtext");
  appendDTextNodes(container, parseDText(source));
}

/* ---------- Favorite and vote buttons ---------- */

function setActionStatus(message, kind = "") {
  const node = els.viewerActionStatus;
  if (!node) return;
  node.textContent = message || "";
  node.hidden = !message;
  if (kind) node.dataset.kind = kind;
  else delete node.dataset.kind;
}

function renderViewerActions(post) {
  if (!els.viewerFav) return;
  const signed = hasBasicAuth();
  const faved = signed && postIsFavorited(post);
  const vote = signed ? postUserVote(post) : 0;
  const stats = post.stats || {};
  const score = (stats.score && typeof stats.score === "object" ? stats.score : post.score) || {};
  const up = Math.abs(Number(score.up) || 0);
  const down = Math.abs(Number(score.down) || 0);
  els.viewerFav.textContent = faved ? "★ Unfavorite" : "☆ Favorite";
  els.viewerFav.setAttribute("aria-pressed", faved ? "true" : "false");
  els.viewerFav.setAttribute("aria-label", faved ? "Remove from favorites" : "Add to favorites");
  els.viewerUp.textContent = "⬆ " + formatCount(up);
  els.viewerUp.setAttribute("aria-pressed", vote > 0 ? "true" : "false");
  els.viewerUp.setAttribute("aria-label", "Upvote (" + up + " up)");
  els.viewerDown.textContent = "⬇ " + formatCount(down);
  els.viewerDown.setAttribute("aria-pressed", vote < 0 ? "true" : "false");
  els.viewerDown.setAttribute("aria-label", "Downvote (" + down + " down)");
  for (const button of [els.viewerFav, els.viewerUp, els.viewerDown]) {
    button.disabled = Boolean(state.actionBusy);
    button.dataset.signed = signed ? "true" : "false";
  }
  if (els.viewerStats) fillStatsLine(els.viewerStats, post);
}

function refreshPostEverywhere(post) {
  renderViewerActions(post);
  const index = state.posts.indexOf(post);
  if (index >= 0) {
    const bar = els.grid.querySelector('.thumb[data-index="' + index + '"] .thumb-stats');
    if (bar) fillStatsLine(bar, post);
  }
}

function requireSignInForAction(what) {
  if (hasBasicAuth()) return true;
  setActionStatus("Sign in with your e621 username and API key to " + what + ".", "error");
  openAccountDialog();
  return false;
}

async function runPostAction(label, task) {
  const post = currentViewerPost();
  if (!post || state.actionBusy) return;
  state.actionBusy = true;
  renderViewerActions(post);
  setActionStatus(label + "…");
  try {
    const message = await task(post);
    setActionStatus(message || "", "ok");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (error && error.code === "auth") {
      requireSignInForAction("do that");
    } else if (error && (error.status === 401 || error.status === 403) && /rejected|denied|api access/i.test(error.message || "")) {
      setActionStatus(error.message + " Check your account in Sign in.", "error");
    } else {
      setActionStatus((error && error.message) || "That did not work. Try again.", "error");
    }
  } finally {
    state.actionBusy = false;
    if (currentViewerPost() === post) renderViewerActions(post);
  }
}

function toggleFavorite() {
  if (!requireSignInForAction("favorite posts")) return;
  runPostAction("Saving favorite", async (post) => {
    if (postIsFavorited(post)) {
      try {
        await unfavoritePost(post.id);
      } catch (error) {
        // Not favorited on e621 any more: treat as done.
        if (error.status !== 404 && error.status !== 422) throw error;
      }
      applyFavoriteChange(post, false);
      refreshPostEverywhere(post);
      return "Removed from favorites.";
    }
    let result = null;
    try {
      result = await favoritePost(post.id);
    } catch (error) {
      if (error.status === 422 && /already/i.test(error.message || "")) {
        applyFavoriteChange(post, true, null);
        refreshPostEverywhere(post);
        return "Already in your favorites.";
      }
      throw error;
    }
    const returned = result && (result.post || result);
    const count = returned && returned.fav_count != null ? returned.fav_count : null;
    applyFavoriteChange(post, true, count);
    refreshPostEverywhere(post);
    return "Added to favorites.";
  });
}

function castVote(direction) {
  if (!requireSignInForAction("vote")) return;
  runPostAction("Voting", async (post) => {
    const params = voteRequestParams(postUserVote(post), direction);
    const result = await votePost(post.id, params);
    if (result && typeof result === "object") applyVoteResult(post, result);
    refreshPostEverywhere(post);
    const ours = postUserVote(post);
    return ours > 0 ? "Upvoted." : ours < 0 ? "Downvoted." : "Vote removed.";
  });
}

/* ---------- Notes overlay ---------- */

function viewerNotesLayer() {
  return els.viewerStage ? els.viewerStage.querySelector(".notes-layer") : null;
}

function hideNotePopup() {
  const popup = document.getElementById("viewer-note-popup");
  if (popup) popup.remove();
  for (const box of els.viewerStage.querySelectorAll(".note-box.active")) box.classList.remove("active");
}

function showNotePopup(note, box) {
  hideNotePopup();
  box.classList.add("active");
  const popup = document.createElement("div");
  popup.id = "viewer-note-popup";
  popup.className = "note-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "Note");
  const body = document.createElement("div");
  renderDTextInto(body, note.body || "");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "secondary note-popup-close";
  close.textContent = "Close note";
  close.addEventListener("click", hideNotePopup);
  popup.append(body, close);
  els.viewerStage.after(popup);
}

// Size the notes layer to the image's untransformed layout box inside the
// zoom wrapper. Note boxes inside use percentages, so they scale with it.
function layoutNotesLayer() {
  const layer = viewerNotesLayer();
  const img = els.viewerStage && els.viewerStage.querySelector(".media-wrap img");
  if (!layer || !img) return;
  layer.style.left = img.offsetLeft + "px";
  layer.style.top = img.offsetTop + "px";
  layer.style.width = img.offsetWidth + "px";
  layer.style.height = img.offsetHeight + "px";
}

function updateNotesToggle(post, count) {
  const toggle = els.viewerNotesToggle;
  if (!toggle) return;
  const show = Boolean(count) && !isVideoPost(post);
  toggle.hidden = !show;
  if (!show) return;
  toggle.textContent = (state.notesVisible ? "Hide notes" : "Show notes") + " (" + count + ")";
  toggle.setAttribute("aria-pressed", state.notesVisible ? "true" : "false");
  const layer = viewerNotesLayer();
  if (layer) layer.hidden = !state.notesVisible;
}

function renderNotesLayer(post, notes) {
  const wrap = els.viewerStage.querySelector(".media-wrap");
  if (!wrap) return;
  const old = wrap.querySelector(".notes-layer");
  if (old) old.remove();
  const file = postFileInfo(post);
  const layer = document.createElement("div");
  layer.className = "notes-layer";
  layer.hidden = !state.notesVisible;
  let shown = 0;
  for (const note of notes) {
    const box = noteBoxPercent(note, file.width, file.height);
    if (!box) continue;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "note-box";
    el.dataset.noteId = String(note.id);
    el.style.left = box.left + "%";
    el.style.top = box.top + "%";
    el.style.width = box.width + "%";
    el.style.height = box.height + "%";
    el.setAttribute("aria-label", "Translation note " + (shown + 1));
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      if (el.classList.contains("active")) hideNotePopup();
      else showNotePopup(note, el);
    });
    layer.append(el);
    shown += 1;
  }
  wrap.append(layer);
  layoutNotesLayer();
  updateNotesToggle(post, shown);
}

function loadViewerNotes(post) {
  hideNotePopup();
  updateNotesToggle(post, 0);
  if (!post || !postHasNotes(post) || isVideoPost(post)) return;
  const seq = ++state.noteSeq;
  const cached = state.notesCache[post.id];
  const pending = cached ? Promise.resolve(cached) : fetchNotes(post.id);
  pending
    .then((list) => {
      const notes = activeNotes(list);
      state.notesCache[post.id] = notes;
      if (seq !== state.noteSeq || currentViewerPost() !== post) return;
      renderNotesLayer(post, notes);
    })
    .catch((error) => {
      if (error && error.name === "AbortError") return;
      if (seq !== state.noteSeq) return;
      setActionStatus("Could not load notes: " + ((error && error.message) || "error"), "error");
    });
}

function toggleNotes() {
  state.notesVisible = !state.notesVisible;
  if (!state.notesVisible) hideNotePopup();
  const post = currentViewerPost();
  const layer = viewerNotesLayer();
  updateNotesToggle(post, layer ? layer.querySelectorAll(".note-box").length : 0);
}

/* ---------- Comments ---------- */

function postCommentCount(post) {
  const stats = post && post.stats;
  const raw = stats && stats.comment_count != null ? stats.comment_count : post && post.comment_count;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resetViewerComments(post) {
  const c = state.comments;
  c.seq += 1;
  c.postId = post ? post.id : null;
  c.page = 0;
  c.loading = false;
  c.done = false;
  if (state.commentsObserver) {
    state.commentsObserver.disconnect();
    state.commentsObserver = null;
  }
  if (els.viewerCommentsList) els.viewerCommentsList.textContent = "";
  if (els.viewerCommentsMore) els.viewerCommentsMore.hidden = true;
  if (els.viewerCommentsStatus) els.viewerCommentsStatus.textContent = "";
}

function renderComment(comment) {
  const item = document.createElement("article");
  if (comment.id != null) item.dataset.id = String(Number(comment.id));
  item.className = "comment";
  const head = document.createElement("header");
  head.className = "comment-head";
  const author = document.createElement("a");
  author.className = "comment-author";
  author.textContent = String(comment.creator_name || "user #" + comment.creator_id);
  author.href = "https://e621.net/users/" + encodeURIComponent(String(Number(comment.creator_id) || ""));
  author.target = "_blank";
  author.rel = "noopener noreferrer";
  const date = document.createElement("time");
  date.className = "comment-date";
  if (comment.created_at) date.dateTime = String(comment.created_at);
  date.textContent = formatPostDate(comment.created_at);
  const score = document.createElement("span");
  const n = Number(comment.score) || 0;
  score.className = "comment-score score-" + (n > 0 ? "up" : n < 0 ? "down" : "zero");
  score.textContent = (n > 0 ? "⬆ " : n < 0 ? "⬇ " : "= ") + Math.abs(n);
  score.setAttribute("aria-label", "Score " + n);
  head.append(author, date, score);
  const body = document.createElement("div");
  body.className = "comment-body";
  renderDTextInto(body, comment.body || "");
  item.append(head, body);
  return item;
}

function loadMoreComments() {
  const c = state.comments;
  const post = currentViewerPost();
  if (!post || c.loading || c.done || c.postId !== post.id) return;
  c.loading = true;
  const seq = c.seq;
  const page = c.page + 1;
  if (els.viewerCommentsStatus) els.viewerCommentsStatus.textContent = "Loading comments…";
  if (els.viewerCommentsMore) els.viewerCommentsMore.disabled = true;
  fetchComments(post.id, { page, limit: c.limit })
    .then((list) => {
      if (seq !== c.seq) return;
      c.page = page;
      // Oldest first; later pages hold newer comments and go underneath.
      const visible = list
        .filter((comment) => comment && !comment.is_hidden)
        .filter((comment) => !els.viewerCommentsList.querySelector('.comment[data-id="' + Number(comment.id) + '"]'))
        .sort((a, b) => Number(a.id) - Number(b.id));
      for (const comment of visible) els.viewerCommentsList.append(renderComment(comment));
      c.done = list.length < c.limit;
      const total = els.viewerCommentsList.childElementCount;
      els.viewerCommentsStatus.textContent = total ? "" : "No comments yet.";
      els.viewerCommentsMore.hidden = c.done;
    })
    .catch((error) => {
      if (seq !== c.seq || (error && error.name === "AbortError")) return;
      els.viewerCommentsStatus.textContent = "Could not load comments: " + ((error && error.message) || "error");
      els.viewerCommentsMore.hidden = false;
    })
    .finally(() => {
      if (seq !== c.seq) return;
      c.loading = false;
      els.viewerCommentsMore.disabled = false;
    });
}

function syncCommentsToggle() {
  const hidden = state.commentsHidden;
  if (els.viewerCommentsBody) els.viewerCommentsBody.hidden = hidden;
  if (els.viewerCommentsToggle) {
    els.viewerCommentsToggle.textContent = hidden ? "Show comments" : "Hide comments";
    els.viewerCommentsToggle.setAttribute("aria-expanded", hidden ? "false" : "true");
  }
  if (els.viewerComments) els.viewerComments.classList.toggle("is-collapsed", hidden);
}

function toggleComments() {
  state.commentsHidden = !state.commentsHidden;
  setItem(COMMENTS_HIDDEN_KEY, state.commentsHidden ? "1" : "0");
  syncCommentsToggle();
  const post = currentViewerPost();
  // Showing again loads comments if they were never fetched for this post.
  if (!state.commentsHidden && post && state.comments.postId === post.id && state.comments.page === 0 && !state.comments.done) {
    renderViewerComments(post);
  }
}

function renderViewerComments(post) {
  if (!els.viewerComments) return;
  resetViewerComments(post);
  syncCommentsToggle();
  const count = postCommentCount(post);
  state.comments.limit = count != null && count <= COMMENTS_ONE_PAGE ? COMMENTS_ONE_PAGE : COMMENT_PAGE_LIMIT;
  resetCommentCompose();
  els.viewerCommentsTitle.textContent = count != null ? "Comments (" + count + ")" : "Comments";
  if (state.commentsHidden) {
    // Collapsed: nothing is fetched until the user shows comments again.
    return;
  }
  if (count === 0) {
    state.comments.done = true;
    els.viewerCommentsStatus.textContent = "No comments yet.";
    return;
  }
  els.viewerCommentsStatus.textContent = "Comments load when you scroll here.";
  // Lazy: fetch only when the comments section scrolls into view.
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (state.commentsObserver === observer) state.commentsObserver = null;
        loadMoreComments();
      },
      { root: els.viewer, rootMargin: "120px" }
    );
    state.commentsObserver = observer;
    observer.observe(els.viewerComments);
  } else {
    loadMoreComments();
  }
}

/* ---------- Details ---------- */

function addDetail(list, label, value) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  if (value instanceof Node) dd.append(value);
  else dd.textContent = String(value);
  list.append(dt, dd);
}

function detailLink(text, href) {
  const a = document.createElement("a");
  a.textContent = text;
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer nofollow";
  return a;
}

function renderViewerDetails(post) {
  const list = els.viewerDetailsList;
  if (!list) return;
  list.textContent = "";
  const d = postDetails(post);
  if (d.artists.length) {
    const frag = document.createElement("div");
    frag.className = "tag-chip-list";
    for (const name of d.artists) {
      frag.append(
        createTagChip(name, {
          category: "artist",
          rowClass: "tag-chip detail-tag",
          showCount: false,
          onTap: () => applyTagToSearch("replace", name),
        })
      );
    }
    addDetail(list, d.artists.length > 1 ? "Artists" : "Artist", frag);
  }
  if (d.uploaderName || d.uploaderId != null) {
    const label = d.uploaderName || "user #" + d.uploaderId;
    addDetail(list, "Uploader", d.uploaderId != null ? detailLink(label, "https://e621.net/users/" + d.uploaderId) : label);
  }
  if (d.createdAt) {
    const time = document.createElement("time");
    time.dateTime = d.createdAt;
    time.textContent = formatPostDate(d.createdAt);
    addDetail(list, "Uploaded", time);
  }
  addDetail(list, "File type", d.ext ? d.ext.toUpperCase() : "");
  if (d.width && d.height) addDetail(list, "Dimensions", d.width + " × " + d.height);
  addDetail(list, "File size", d.sizeText);
  if (d.duration) addDetail(list, "Duration", Math.round(d.duration) + " s");
  if (d.sources.length) {
    const ul = document.createElement("ul");
    ul.className = "detail-sources";
    for (const source of d.sources) {
      const li = document.createElement("li");
      if (source.href) li.append(detailLink(source.text, source.href));
      else li.textContent = source.full;
      if (source.removed) li.classList.add("removed");
      ul.append(li);
    }
    addDetail(list, d.sources.length > 1 ? "Sources" : "Source", ul);
  }
  addDetail(list, "Rating", d.ratingName);
  if (d.id != null) addDetail(list, "Post ID", detailLink(String(d.id), postPageUrl(post)));
  if (d.md5) {
    const code = document.createElement("code");
    code.textContent = d.md5;
    addDetail(list, "MD5", code);
  }
  if (els.viewerDescription) {
    if (d.description.trim()) {
      renderDTextInto(els.viewerDescription, d.description);
      const title = document.createElement("p");
      title.className = "detail-desc-title";
      title.textContent = "Description";
      els.viewerDescription.prepend(title);
      els.viewerDescription.hidden = false;
    } else {
      els.viewerDescription.textContent = "";
      els.viewerDescription.hidden = true;
    }
  }
}

/* ---------- Tag counts ---------- */

async function fetchTagCounts(names) {
  const missing = names.filter((name) => !state.tagCounts.has(name));
  for (const batch of tagNameBatches(missing, 100)) {
    const records = await fetchTagsByNames(batch);
    for (const record of records) {
      if (!record || !record.name) continue;
      const key = String(record.name).toLowerCase();
      state.tagCounts.set(key, Number(record.post_count) || 0);
      rememberTagCategory(key, record.category);
    }
    // Names e621 did not return have no posts (or were aliased away).
    for (const name of batch) if (!state.tagCounts.has(name)) state.tagCounts.set(name, 0);
  }
}

function fillTagCountNodes(root) {
  if (!root) return;
  for (const node of root.querySelectorAll(".tag-count[data-tag]:not([data-fixed])")) {
    const count = state.tagCounts.get(node.dataset.tag);
    if (count == null) continue;
    node.textContent = formatCount(count);
    node.title = count + " posts";
  }
}

function loadViewerTagCounts(post) {
  if (!els.viewerTags) return;
  const names = [...els.viewerTags.querySelectorAll(".tag-count[data-tag]")].map((node) => node.dataset.tag);
  if (!names.length) return;
  const seq = ++state.tagCountSeq;
  fetchTagCounts(names)
    .then(() => {
      if (seq !== state.tagCountSeq || currentViewerPost() !== post) return;
      fillTagCountNodes(els.viewerTags);
    })
    .catch(() => {
      /* counts are optional */
    });
}

/* ---------- Related tags ---------- */

function closeRelatedPanel() {
  if (!els.relatedPanel) return;
  els.relatedPanel.hidden = true;
  els.relatedBtn.setAttribute("aria-expanded", "false");
  state.relatedSeq += 1;
}

function renderRelatedList(items, countKind) {
  els.relatedList.textContent = "";
  for (const item of items) {
    const li = document.createElement("li");
    const chip = createTagChip(item.name, {
      category: state.tagCategories.get(item.name),
      rowClass: "tag-chip related-tag",
      countText: countKind === "page" ? item.weight + "×" : null,
      onTap: () => {
        closeRelatedPanel();
        applyTagToSearch("add", item.name);
      },
      tapLabel: "Add " + item.name + " to the search",
    });
    li.append(chip);
    els.relatedList.append(li);
  }
}

async function openRelatedPanel() {
  if (!els.relatedPanel) return;
  els.relatedPanel.hidden = false;
  els.relatedBtn.setAttribute("aria-expanded", "true");
  const seq = ++state.relatedSeq;
  const query = els.search.value;
  const searched = searchTagNames(query);
  const exclude = [...tokenize(query).map((t) => tagName(t)), ...singleTagLines(blacklistTags())];
  els.relatedList.textContent = "";
  els.relatedNote.textContent = "Loading related tags…";
  let items = [];
  let kind = "related";
  try {
    if (searched.length) {
      const records = await fetchTagsByNames(searched.slice(0, 20));
      if (seq !== state.relatedSeq) return;
      for (const record of records) {
        if (!record || !record.name) continue;
        state.tagCounts.set(String(record.name).toLowerCase(), Number(record.post_count) || 0);
        rememberTagCategory(record.name, record.category);
      }
      items = mergeRelatedTags(records, { exclude, limit: 30 });
    }
  } catch (error) {
    if (seq !== state.relatedSeq) return;
    items = [];
  }
  if (!items.length) {
    kind = "page";
    items = aggregatePageTags(clientFilter(state.posts), { exclude, limit: 30 });
  }
  if (seq !== state.relatedSeq) return;
  if (!items.length) {
    els.relatedNote.textContent = searched.length
      ? "No related tags found for this search."
      : "Search for a tag, or load some posts, to see related tags.";
    return;
  }
  els.relatedNote.textContent =
    kind === "related"
      ? "Tags often used with " + searched.join(" + ") + ". Tap one to add it to the search."
      : "Most common tags on the loaded posts. Tap one to add it to the search.";
  renderRelatedList(items, kind);
  if (kind === "related") {
    try {
      await fetchTagCounts(items.map((item) => item.name));
      if (seq !== state.relatedSeq) return;
      fillTagCountNodes(els.relatedList);
      paintTagCategories(els.relatedList);
    } catch (error) {
      /* counts are optional */
    }
  }
}

function toggleRelatedPanel() {
  if (!els.relatedPanel) return;
  if (els.relatedPanel.hidden) openRelatedPanel();
  else closeRelatedPanel();
}

function bindViewerExtras() {
  if (els.viewerFav) els.viewerFav.addEventListener("click", toggleFavorite);
  if (els.viewerUp) els.viewerUp.addEventListener("click", () => castVote(1));
  if (els.viewerDown) els.viewerDown.addEventListener("click", () => castVote(-1));
  if (els.viewerNotesToggle) els.viewerNotesToggle.addEventListener("click", toggleNotes);
  if (els.viewerCommentsMore) els.viewerCommentsMore.addEventListener("click", loadMoreComments);
  if (els.viewerCommentsToggle) els.viewerCommentsToggle.addEventListener("click", toggleComments);
  bindCommentCompose();
  if (els.viewerDownload) els.viewerDownload.addEventListener("click", downloadCurrentPost);
  if (els.viewerFullscreen) els.viewerFullscreen.addEventListener("click", toggleViewerFullscreen);
  for (const type of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(type, onFullscreenChange);
  bindTagTools();
  if (els.relatedBtn) els.relatedBtn.addEventListener("click", toggleRelatedPanel);
  window.addEventListener("resize", layoutNotesLayer);
}

/* ---------- Tag chips: + name count ? -, colors, long-press menu ---------- */

function rememberTagCategory(name, category) {
  const cat = tagCategoryName(category);
  const key = tagName(name);
  if (cat && key) state.tagCategories.set(key, cat);
}

function applyTagColor(el, category) {
  const cat = tagCategoryName(category);
  if (!cat) return;
  el.dataset.category = cat;
  el.style.setProperty("--tag-color", tagCategoryColor(cat));
}

/** Color chips whose category was unknown when they were drawn. */
function paintTagCategories(root) {
  if (!root) return;
  for (const chip of root.querySelectorAll("[data-tag]:not([data-category])")) {
    const cat = state.tagCategories.get(chip.dataset.tag);
    if (cat && chip.classList.contains("tag-chip")) applyTagColor(chip, cat);
  }
}

/**
 * Long press (touch ~500ms, or a long mouse press) and right-click call
 * onLong. A long press swallows the click that follows, so the tap action
 * does not also run.
 */
function bindLongPress(el, onLong) {
  let timer = 0;
  let start = null;
  let fired = 0;
  const clear = () => {
    window.clearTimeout(timer);
    timer = 0;
    start = null;
  };
  const fire = (event) => {
    clear();
    fired = Date.now();
    onLong(event);
  };
  el.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    start = { x: event.clientX, y: event.clientY };
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fire(event), LONG_PRESS_MS);
  });
  el.addEventListener("pointermove", (event) => {
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clear();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(type, clear);
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    // Android Chrome fires contextmenu for the same long press; open once.
    if (Date.now() - fired < 800) return;
    fire(event);
  });
  el.addEventListener(
    "click",
    (event) => {
      if (Date.now() - fired < 800) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );
}

/**
 * One tag with its tools: [+] [name] [count] [?] [-].
 * Tapping the name runs onTap; long-press or right-click opens the tag menu.
 */
function createTagChip(raw, { category = "", rowClass = "tag-chip", onTap = null, tapLabel = "", showCount = true, countText = null } = {}) {
  const name = tagName(raw);
  const row = document.createElement("div");
  row.className = rowClass;
  row.dataset.tag = name;
  applyTagColor(row, category || state.tagCategories.get(name));

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "tag-plus";
  plus.textContent = "+";
  plus.setAttribute("aria-label", "Add " + name);
  plus.addEventListener("click", () => applyTagToSearch("add", name));

  const label = document.createElement("button");
  label.type = "button";
  label.className = "tag-name";
  label.textContent = name;
  if (tapLabel) label.setAttribute("aria-label", tapLabel);
  label.title = "Long-press for more";
  label.addEventListener("click", () => {
    if (onTap) onTap();
    else applyTagToSearch("replace", name);
  });
  bindLongPress(label, () => openTagMenu(name));

  const parts = [plus, label];
  if (showCount) {
    const count = document.createElement("span");
    count.className = "tag-count";
    count.dataset.tag = name;
    if (countText != null) {
      count.textContent = countText;
      count.dataset.fixed = "true";
    } else {
      const known = state.tagCounts.get(name);
      if (known != null) count.textContent = formatCount(known);
    }
    parts.push(count);
  }

  const wiki = document.createElement("button");
  wiki.type = "button";
  wiki.className = "tag-wiki";
  wiki.textContent = "?";
  wiki.setAttribute("aria-label", "Wiki for " + name);
  wiki.addEventListener("click", () => openWiki(name));

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "tag-minus";
  minus.textContent = "-";
  minus.setAttribute("aria-label", "Exclude " + name);
  minus.addEventListener("click", () => applyTagToSearch("exclude", name));

  row.append(...parts, wiki, minus);
  return row;
}

function showDialog(dialog) {
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

function hideDialog(dialog) {
  if (!dialog) return;
  try {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  } catch (error) {
    dialog.removeAttribute("open");
  }
}

/* ---------- Tag menu ---------- */

function syncTagMenu() {
  const name = state.tagMenuName;
  if (!els.tagMenu || !name) return;
  els.tagMenuTitle.textContent = name;
  els.tagMenuTitle.style.removeProperty("--tag-color");
  applyTagColor(els.tagMenuTitle, state.tagCategories.get(name));
  const listed = state.blacklist.includes(name);
  const black = els.tagMenu.querySelector('[data-tag-action="blacklist"]');
  if (black) black.textContent = listed ? "Remove from blacklist" : "Add to blacklist";
}

function openTagMenu(name) {
  if (!els.tagMenu) return;
  state.tagMenuName = tagName(name);
  if (els.tagMenuStatus) els.tagMenuStatus.textContent = "";
  syncTagMenu();
  state.tagMenuGuard = true;
  showDialog(els.tagMenu);
}

function closeTagMenu() {
  hideDialog(els.tagMenu);
}

async function copyText(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    /* fall back below */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  (els.tagMenu && els.tagMenu.open ? els.tagMenu : document.body).append(area);
  area.select();
  area.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  area.remove();
  return ok;
}

function toggleBlacklistTag(name) {
  if (state.blacklist.includes(name)) {
    state.blacklist = state.blacklist.filter((entry) => entry !== name);
    blacklistChanged();
    return "Removed " + name + " from your blacklist." + syncSuffix();
  }
  state.blacklist.push(name);
  blacklistChanged();
  return "Added " + name + " to your blacklist. It applies to your next search." + syncSuffix();
}

async function runTagMenuAction(action) {
  const name = state.tagMenuName;
  if (!name) return;
  const say = (text) => {
    if (els.tagMenuStatus) els.tagMenuStatus.textContent = text;
  };
  if (action === "close") return closeTagMenu();
  if (action === "copy") {
    const ok = await copyText(name);
    say(ok ? "Copied " + name + "." : "Could not copy. The tag is: " + name);
    return;
  }
  if (action === "blacklist") {
    say(toggleBlacklistTag(name));
    syncTagMenu();
    return;
  }
  if (action === "or") return applyTagToSearch("or", name);
  if (action === "only") return applyTagToSearch("replace", name);
  if (action === "wiki") {
    closeTagMenu();
    openWiki(name);
  }
}

/* ---------- Wiki (preview above the grid, and the full in-app page) ---------- */

function loadWiki(name) {
  const key = tagName(name);
  if (state.wikiCache.has(key)) return state.wikiCache.get(key);
  const pending = fetchWikiPage(key).catch((error) => {
    state.wikiCache.delete(key);
    throw error;
  });
  state.wikiCache.set(key, pending);
  return pending;
}

function loadRelations(name) {
  const key = tagName(name);
  if (state.relationCache.has(key)) return state.relationCache.get(key);
  const pending = Promise.all([fetchTagAliases(key), fetchTagImplications(key)])
    .then(([aliases, implications]) => tagRelations(key, aliases, implications))
    .catch((error) => {
      state.relationCache.delete(key);
      throw error;
    });
  state.relationCache.set(key, pending);
  return pending;
}

function hideWikiPreview() {
  state.wikiPreviewSeq += 1;
  state.wikiPreviewTag = "";
  if (els.wikiPreview) els.wikiPreview.hidden = true;
}

function updateWikiPreview() {
  if (!els.wikiPreview) return;
  const tag = state.view === "posts" && (!state.sub || state.sub === "hot") ? singleSearchTag(els.search.value) : "";
  if (!tag) {
    hideWikiPreview();
    return;
  }
  if (tag === state.wikiPreviewTag && !els.wikiPreview.hidden) return;
  const seq = ++state.wikiPreviewSeq;
  state.wikiPreviewTag = tag;
  els.wikiPreview.hidden = true;
  loadWiki(tag)
    .then((page) => {
      if (seq !== state.wikiPreviewSeq) return;
      const body = page && !page.is_deleted ? String(page.body || "").trim() : "";
      if (!body) {
        els.wikiPreview.hidden = true;
        return;
      }
      els.wikiPreviewTitle.textContent = "";
      els.wikiPreviewTitle.append(
        createTagChip(tag, { rowClass: "tag-chip wiki-preview-tag", onTap: () => openWiki(tag), tapLabel: "Open the wiki for " + tag })
      );
      fetchTagCounts([tag])
        .then(() => {
          fillTagCountNodes(els.wikiPreviewTitle);
          paintTagCategories(els.wikiPreviewTitle);
        })
        .catch(() => {});
      const excerpt = dtextExcerpt(body, { maxBlocks: 3, maxChars: 280 });
      els.wikiPreviewBody.textContent = "";
      appendDTextNodes(els.wikiPreviewBody, excerpt.nodes);
      els.wikiPreviewMore.textContent = "Show more";
      els.wikiPreview.hidden = false;
    })
    .catch(() => {
      if (seq === state.wikiPreviewSeq) els.wikiPreview.hidden = true;
    });
}

function closeWiki() {
  state.wikiSeq += 1;
  hideDialog(els.wikiDialog);
}

function relationGroup(label, names, { showCount = true } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "relation-group";
  const title = document.createElement("p");
  title.className = "relation-title";
  title.textContent = label;
  const list = document.createElement("div");
  list.className = "tag-chip-list";
  for (const name of names) {
    list.append(createTagChip(name, { rowClass: "tag-chip", showCount, onTap: () => openWiki(name), tapLabel: "Open the wiki for " + name }));
  }
  wrap.append(title, list);
  return wrap;
}

function renderRelations(name, rel) {
  const box = els.wikiRelations;
  box.textContent = "";
  const groups = [];
  if (rel.aliasOf) groups.push(relationGroup(name + " is an alias of", [rel.aliasOf]));
  if (rel.aliases.length) groups.push(relationGroup("Aliased from (other names)", rel.aliases, { showCount: false }));
  if (rel.implies.length) groups.push(relationGroup("Implies", rel.implies));
  if (rel.impliedBy.length) groups.push(relationGroup("Implied by", rel.impliedBy));
  if (!groups.length) {
    const none = document.createElement("p");
    none.className = "muted tight";
    none.textContent = "No active aliases or implications.";
    groups.push(none);
  }
  const head = document.createElement("h3");
  head.className = "viewer-section-title";
  head.textContent = "Aliases and implications";
  box.append(head, ...groups);
  box.hidden = false;
  const names = [rel.aliasOf, ...rel.aliases, ...rel.implies, ...rel.impliedBy].filter(Boolean);
  fetchTagCounts(names)
    .then(() => {
      fillTagCountNodes(box);
      paintTagCategories(box);
    })
    .catch(() => {});
}

function openWiki(raw) {
  const name = tagName(raw);
  if (!name || !els.wikiDialog) return;
  closeTagMenu();
  hideSuggestions();
  const seq = ++state.wikiSeq;
  els.wikiTitle.textContent = name.replace(/_/g, " ");
  els.wikiOpen.href = "https://e621.net/wiki_pages/show_or_new?title=" + encodeURIComponent(name);
  els.wikiTag.textContent = "";
  els.wikiTag.append(createTagChip(name, { rowClass: "tag-chip wiki-own-tag", onTap: () => applyTagToSearch("replace", name), tapLabel: "Search " + name }));
  els.wikiStatus.textContent = "Loading the wiki…";
  els.wikiBody.textContent = "";
  els.wikiRelations.hidden = true;
  els.wikiRelations.textContent = "";
  els.wikiMentions.hidden = true;
  els.wikiMentionsList.textContent = "";
  showDialog(els.wikiDialog);
  els.wikiDialog.scrollTop = 0;
  fetchTagCounts([name])
    .then(() => {
      if (seq !== state.wikiSeq) return;
      fillTagCountNodes(els.wikiTag);
      paintTagCategories(els.wikiTag);
      const cat = state.tagCategories.get(name);
      if (cat) applyTagColor(els.wikiTitle, cat);
    })
    .catch(() => {});
  loadWiki(name)
    .then((page) => {
      if (seq !== state.wikiSeq) return;
      const body = page && !page.is_deleted ? String(page.body || "") : "";
      if (!body.trim()) {
        els.wikiStatus.textContent = "There is no wiki page for this tag yet.";
        return;
      }
      els.wikiStatus.textContent = "";
      const tree = parseDText(body);
      appendDTextNodes(els.wikiBody, tree);
      const titles = dtextWikiTitles(tree).filter((title) => title !== name && !title.includes(":")).slice(0, 60);
      if (titles.length) {
        for (const title of titles) {
          els.wikiMentionsList.append(createTagChip(title, { rowClass: "tag-chip", onTap: () => openWiki(title), tapLabel: "Open the wiki for " + title }));
        }
        els.wikiMentions.hidden = false;
        fetchTagCounts(titles)
          .then(() => {
            if (seq !== state.wikiSeq) return;
            fillTagCountNodes(els.wikiMentionsList);
            paintTagCategories(els.wikiMentionsList);
          })
          .catch(() => {});
      }
    })
    .catch((error) => {
      if (seq !== state.wikiSeq) return;
      els.wikiStatus.textContent = "Could not load the wiki: " + ((error && error.message) || "error");
    });
  loadRelations(name)
    .then((rel) => {
      if (seq !== state.wikiSeq) return;
      renderRelations(name, rel);
    })
    .catch(() => {
      if (seq !== state.wikiSeq) return;
      els.wikiRelations.textContent = "";
      const note = document.createElement("p");
      note.className = "muted tight";
      note.textContent = "Could not load aliases and implications.";
      els.wikiRelations.append(note);
      els.wikiRelations.hidden = false;
    });
}

// Inside wiki text, [[wiki]] links open the in-app wiki and {{search}} links
// run the search here instead of leaving for e621.
function handleDTextLink(event) {
  const link = event.target.closest && event.target.closest("a[data-wiki], a[data-search]");
  if (!link) return;
  event.preventDefault();
  if (link.dataset.wiki) openWiki(link.dataset.wiki);
  else if (link.dataset.search) {
    if (els.search) els.search.value = link.dataset.search;
    closeWiki();
    closeViewer();
    setView("posts");
    setSub("");
    searchFromStart();
  }
}

/* ---------- Search help ---------- */

function renderSearchHelp() {
  if (!els.searchHelpSyntax || els.searchHelpSyntax.childElementCount) return;
  for (const row of SEARCH_SYNTAX_HELP) {
    const tr = document.createElement("tr");
    const code = document.createElement("td");
    const c = document.createElement("code");
    c.textContent = row.example;
    code.append(c);
    const text = document.createElement("td");
    text.textContent = row.text;
    tr.append(code, text);
    els.searchHelpSyntax.append(tr);
  }
  const groups = new Map();
  for (const meta of METATAGS) {
    if (!groups.has(meta.group)) groups.set(meta.group, []);
    groups.get(meta.group).push(meta);
  }
  for (const [group, metas] of groups) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = group;
    const list = document.createElement("dl");
    for (const meta of metas) {
      const dt = document.createElement("dt");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary help-insert";
      button.textContent = meta.example;
      button.setAttribute("aria-label", "Add " + meta.name + ": to the search");
      button.addEventListener("click", () => {
        const value = els.search.value.replace(/\s+$/, "");
        els.search.value = (value ? value + " " : "") + meta.name + ":";
        hideDialog(els.searchHelp);
        els.search.focus();
        const end = els.search.value.length;
        els.search.setSelectionRange(end, end);
        requestSuggestions();
      });
      dt.append(button);
      const dd = document.createElement("dd");
      dd.textContent = meta.hint + (meta.values ? " (" + meta.values.slice(0, 8).join(", ") + (meta.values.length > 8 ? ", …" : "") + ")" : "");
      list.append(dt, dd);
    }
    details.append(summary, list);
    els.searchHelpMetatags.append(details);
  }
}

function bindTagTools() {
  if (els.tagMenu) {
    // A fresh press inside the menu ends the guard for the long-press release.
    els.tagMenu.addEventListener("pointerdown", () => {
      state.tagMenuGuard = false;
    });
    els.tagMenu.addEventListener(
      "click",
      (event) => {
        if (!state.tagMenuGuard) return;
        state.tagMenuGuard = false;
        // Programmatic clicks (keyboard, tests) have no pointer position.
        if (event.detail === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true
    );
    els.tagMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tag-action]");
      if (button) {
        runTagMenuAction(button.dataset.tagAction);
        return;
      }
      // Tap on the backdrop closes the menu.
      if (event.target === els.tagMenu) closeTagMenu();
    });
  }
  if (els.wikiClose) els.wikiClose.addEventListener("click", closeWiki);
  if (els.wikiBody) els.wikiBody.addEventListener("click", handleDTextLink);
  if (els.wikiPreviewBody) els.wikiPreviewBody.addEventListener("click", handleDTextLink);
  if (els.wikiPreviewMore) {
    els.wikiPreviewMore.addEventListener("click", () => {
      if (state.wikiPreviewTag) openWiki(state.wikiPreviewTag);
    });
  }
  if (els.searchHelpBtn) {
    els.searchHelpBtn.addEventListener("click", () => {
      hideSuggestions();
      renderSearchHelp();
      showDialog(els.searchHelp);
    });
  }
  if (els.searchHelpClose) els.searchHelpClose.addEventListener("click", () => hideDialog(els.searchHelp));
}

const VIEWER_MAX_ZOOM = 5;
const VIEWER_DOUBLE_TAP_ZOOM = 2.5;
const viewerZoom = {
  scale: 1,
  x: 0,
  y: 0,
  usedMultiTouch: false,
  pinch: null,
  pan: null,
  lastTap: 0,
};

function viewerMedia() {
  return els.viewerStage ? els.viewerStage.querySelector("img, video") : null;
}

// What the zoom transform is applied to: the image wrapper (which also holds
// the notes layer) when there is one, otherwise the media element itself.
function viewerZoomTarget() {
  if (!els.viewerStage) return null;
  return els.viewerStage.querySelector(".media-wrap") || viewerMedia();
}

function applyViewerZoom() {
  const media = viewerZoomTarget();
  if (!media) return;
  if (viewerZoom.scale <= 1) {
    media.style.transform = "";
    media.style.transformOrigin = "";
    els.viewerStage.classList.remove("is-zoomed");
    return;
  }
  media.style.transformOrigin = "0 0";
  media.style.transform = `translate(${viewerZoom.x}px, ${viewerZoom.y}px) scale(${viewerZoom.scale})`;
  els.viewerStage.classList.add("is-zoomed");
}

function resetViewerZoom() {
  viewerZoom.scale = 1;
  viewerZoom.x = 0;
  viewerZoom.y = 0;
  viewerZoom.pinch = null;
  viewerZoom.pan = null;
  applyViewerZoom();
}

function clampViewerZoom(media) {
  const w = media.offsetWidth;
  const h = media.offsetHeight;
  const s = viewerZoom.scale;
  viewerZoom.x = Math.min(0, Math.max(w - w * s, viewerZoom.x));
  viewerZoom.y = Math.min(0, Math.max(h - h * s, viewerZoom.y));
}

// Zoom so the media point under screen point (cx, cy) stays under it.
function zoomViewerAt(media, cx, cy, fromScale, fromX, fromY, originLeft, originTop, toScale) {
  const px = (cx - originLeft - fromX) / fromScale;
  const py = (cy - originTop - fromY) / fromScale;
  viewerZoom.scale = Math.min(VIEWER_MAX_ZOOM, Math.max(1, toScale));
  viewerZoom.x = cx - originLeft - viewerZoom.scale * px;
  viewerZoom.y = cy - originTop - viewerZoom.scale * py;
  clampViewerZoom(media);
}

function touchDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function bindViewerZoom() {
  const stage = els.viewerStage;
  if (!stage) return;
  stage.addEventListener(
    "touchstart",
    (event) => {
      const media = viewerZoomTarget();
      if (!media) return;
      if (event.touches.length === 1) viewerZoom.usedMultiTouch = false;
      const rect = media.getBoundingClientRect();
      const originLeft = rect.left - viewerZoom.x;
      const originTop = rect.top - viewerZoom.y;
      if (event.touches.length === 2) {
        viewerZoom.usedMultiTouch = true;
        const [a, b] = event.touches;
        viewerZoom.pan = null;
        viewerZoom.pinch = {
          distance: touchDistance(a, b) || 1,
          cx: (a.clientX + b.clientX) / 2,
          cy: (a.clientY + b.clientY) / 2,
          scale: viewerZoom.scale,
          x: viewerZoom.x,
          y: viewerZoom.y,
          originLeft,
          originTop,
        };
        event.preventDefault();
      } else if (event.touches.length === 1 && viewerZoom.scale > 1) {
        const t = event.touches[0];
        viewerZoom.pan = { sx: t.clientX, sy: t.clientY, x: viewerZoom.x, y: viewerZoom.y };
      }
    },
    { passive: false }
  );
  stage.addEventListener(
    "touchmove",
    (event) => {
      const media = viewerZoomTarget();
      if (!media) return;
      if (viewerZoom.pinch && event.touches.length >= 2) {
        const [a, b] = event.touches;
        const p = viewerZoom.pinch;
        const ratio = touchDistance(a, b) / p.distance;
        const cx = (a.clientX + b.clientX) / 2;
        const cy = (a.clientY + b.clientY) / 2;
        zoomViewerAt(media, p.cx, p.cy, p.scale, p.x, p.y, p.originLeft, p.originTop, p.scale * ratio);
        viewerZoom.x += cx - p.cx;
        viewerZoom.y += cy - p.cy;
        clampViewerZoom(media);
        applyViewerZoom();
        event.preventDefault();
      } else if (viewerZoom.pan && event.touches.length === 1 && viewerZoom.scale > 1) {
        const t = event.touches[0];
        viewerZoom.x = viewerZoom.pan.x + (t.clientX - viewerZoom.pan.sx);
        viewerZoom.y = viewerZoom.pan.y + (t.clientY - viewerZoom.pan.sy);
        clampViewerZoom(media);
        applyViewerZoom();
        event.preventDefault();
      }
    },
    { passive: false }
  );
  stage.addEventListener(
    "touchend",
    (event) => {
      const media = viewerZoomTarget();
      if (event.touches.length < 2) viewerZoom.pinch = null;
      if (event.touches.length === 1 && viewerZoom.scale > 1) {
        const t = event.touches[0];
        viewerZoom.pan = { sx: t.clientX, sy: t.clientY, x: viewerZoom.x, y: viewerZoom.y };
      }
      if (event.touches.length === 0) viewerZoom.pan = null;
      if (viewerZoom.scale < 1.05 && viewerZoom.scale !== 1) resetViewerZoom();
      // Double-tap an image to zoom in, or back out when zoomed.
      const shown = viewerMedia();
      if (!media || !shown || shown.tagName !== "IMG") return;
      if (event.target && event.target.closest && event.target.closest(".note-box")) return;
      if (event.touches.length || event.changedTouches.length !== 1 || viewerZoom.usedMultiTouch) return;
      const now = Date.now();
      const t = event.changedTouches[0];
      if (now - viewerZoom.lastTap < 300) {
        viewerZoom.lastTap = 0;
        if (viewerZoom.scale > 1) {
          resetViewerZoom();
        } else {
          const rect = media.getBoundingClientRect();
          zoomViewerAt(media, t.clientX, t.clientY, 1, 0, 0, rect.left, rect.top, VIEWER_DOUBLE_TAP_ZOOM);
          applyViewerZoom();
        }
        event.preventDefault();
      } else {
        viewerZoom.lastTap = now;
      }
    },
    { passive: false }
  );
}

function bindViewerSwipe() {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  els.viewerStage.addEventListener(
    "touchstart",
    (event) => {
      if (!event.changedTouches.length) return;
      if (event.touches.length > 1) {
        tracking = false;
        return;
      }
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
      if (viewerZoom.scale > 1 || viewerZoom.usedMultiTouch) return;
      const dx = event.changedTouches[0].clientX - startX;
      const dy = event.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
      stepActiveViewer(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}

function infiniteScrollReady() {
  if (state.loading || !state.hasMore || appendLimitReached()) return false;
  if (els.viewer && els.viewer.open) return false;
  if (poolCatalogView()) return !!(state.pools && state.pools.length);
  // An open pool may have a first page with nothing visible yet.
  if (state.view === "pools" && state.activePool) return true;
  return state.posts.length > 0;
}

function sentinelInView() {
  if (!els.sentinel || els.sentinel.hidden) return false;
  const rect = els.sentinel.getBoundingClientRect();
  if (!rect.width && !rect.height && !els.sentinel.offsetParent) return false;
  return rect.top < window.innerHeight + 200 && rect.bottom > -200;
}

// IntersectionObserver only fires when the sentinel crosses into view. If a
// load adds few or no visible posts, it never leaves the view and nothing
// fired again, so loading stopped. Re-check after each load.
function recheckInfiniteScroll() {
  if (!state.infiniteScrollBound) return;
  requestAnimationFrame(function () {
    // Never retry in a loop after a failed load; the Retry button handles that.
    if (els.status && els.status.dataset.kind === "error") return;
    if (infiniteScrollReady() && sentinelInView()) reloadCurrent({ page: state.page + 1, append: true });
  });
}

function bindInfiniteScroll() {
  if (!("IntersectionObserver" in window) || !els.sentinel) return;
  state.infiniteScrollBound = true;
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    if (!infiniteScrollReady()) return;
    reloadCurrent({ page: state.page + 1, append: true });
  });
  observer.observe(els.sentinel);
  // Backup for missed observer callbacks (it fires only on a crossing, so
  // one that came while another load was running was lost): check on scroll.
  let queued = false;
  window.addEventListener(
    "scroll",
    function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        if (infiniteScrollReady() && sentinelInView()) reloadCurrent({ page: state.page + 1, append: true });
      }, 150);
    },
    { passive: true }
  );
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
  // A pool is a finite list (and the pool catalog loads in its own pages),
  // so pools keep loading until the end instead of stopping after 5 loads.
  if (state.view === "pools") return false;
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
  recheckInfiniteScroll();
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
  markNewResults();
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
  const sortLabel = els.sortLabel || (els.sort && els.sort.closest("label"));
  if (sortLabel) sortLabel.hidden = state.view === "pools" || state.sub === "popular";
}

function setView(view) {
  markNewResults();
  state.poolListMemory = null;
  dropHistoryLayer("pool");
  state.view = view;
  if (view !== "posts") hideWikiPreview();
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
  if (state.sub && state.sub !== "hot") hideWikiPreview();
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
    remove.setAttribute("aria-label", "Remove " + tag);
    remove.addEventListener("click", () => {
      state.blacklist = state.blacklist.filter((entry) => entry !== tag);
      blacklistChanged();
      setStatus("Removed " + tag + " from your blacklist." + syncSuffix());
    });
    item.append(name, remove);
    els.blacklistList.append(item);
  }
  if (els.blacklistEmpty) els.blacklistEmpty.hidden = state.blacklist.length > 0;
  renderBlacklistSync();
}

// One entry is one e621 blacklist line: "canine rating:e" hides posts with both.
function addBlacklistTag(raw) {
  const line = normalizeBlacklistLine(raw);
  if (!line) {
    setStatus("Enter a tag to blacklist.", "error");
    return;
  }
  if (els.blacklistAdd) els.blacklistAdd.value = "";
  if (state.blacklist.includes(line)) {
    setStatus("That tag is already on your blacklist.");
    return;
  }
  state.blacklist.push(line);
  blacklistChanged();
  setStatus("Blacklist updated" + (isStoragePersistent() ? "." : ". Storage is blocked, so this lasts only until this tab closes.") + syncSuffix());
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
    els.accountBtn.setAttribute("aria-label", signed ? "Account menu, signed in as " + name : "Sign in");
    if (signed) {
      els.accountBtn.setAttribute("aria-haspopup", "menu");
      els.accountBtn.setAttribute("aria-controls", "account-menu");
      els.accountBtn.setAttribute("aria-expanded", els.accountMenu && !els.accountMenu.hidden ? "true" : "false");
    } else {
      els.accountBtn.setAttribute("aria-haspopup", "dialog");
      els.accountBtn.setAttribute("aria-controls", "account-dialog");
      els.accountBtn.removeAttribute("aria-expanded");
      closeAccountMenu({ focus: false });
    }
  }
  if (els.accountMenuName) els.accountMenuName.textContent = signed ? name : "";
  renderBlacklistSync();
  if (els.accountTitle) els.accountTitle.textContent = signed ? "Account" : "Sign in";
  if (els.favOpenAccount) els.favOpenAccount.hidden = signed;
  if (els.favAccountNote) {
    els.favAccountNote.textContent = signed
      ? "Signed in as " + name + ". Private favorites use this account, and your Blacklist syncs with your e621 account."
      : "Use Sign in next to Posts and Pools for private favorites and full API access. Public favorites still work with just a username.";
  }
  if (els.authClear) els.authClear.disabled = !signed;
  if (els.authSave) els.authSave.disabled = Boolean(state.authBusy);
  if (els.authRememberNote) {
    els.authRememberNote.hidden = isStoragePersistent();
  }
  if (els.viewer && els.viewer.open && state.viewerPost) renderViewerActions(state.viewerPost);
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
      state.authUser = user && typeof user === "object" ? user : null;
      updateAuthStatus(signedInNote(), "ok");
      setStatus(signedInNote());
      loadAccountAvatar();
      syncBlacklist({ user: state.authUser });
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
  window.clearTimeout(state.blacklistSync.timer);
  state.authUser = null;
  state.avatarSeq += 1;
  if (els.accountMenuAvatar) setAvatar(els.accountMenuAvatar, null, "");
  closeAccountMenu({ focus: false });
  clearBasicAuth();
  removeAuthKey();
  if (els.authKey) els.authKey.value = "";
  updateAuthStatus();
  setStatus("Signed out. The API key was cleared from memory.");
}

async function loadFavorites({ page, append }) {
  if (!append) markNewResults();
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
    rating: selectedRatings(),
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
  if (!append) {
    markNewResults();
    state.poolListMemory = null;
  }
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
  if (!append) markNewResults();
  const ids = state.poolIds || [];
  const abort = abortSearch();
  beginLoad(append ? "Loading more pool posts…" : "Loading pool…");
  try {
    const extra = exclusionTagString();
    // Pool "pages" are 24-id chunks of the pool. With ratings or the
    // blacklist on, a chunk can hold few or no visible posts, which left the
    // grid too short to move the infinite-scroll sentinel and loading stalled.
    // Keep pulling the next chunks (several per request) until enough show.
    let chunk = page;
    let posts = [];
    let extraRequests = 0;
    while (true) {
      const count = extraRequests ? POOL_FILL_CHUNKS : 1;
      const start = (chunk - 1) * PAGE_LIMIT;
      const slice = ids.slice(start, start + PAGE_LIMIT * count);
      if (!slice.length) break;
      const found = clientFilter(await fetchPostsByIds(slice, { extraTags: extra, signal: abort.signal }));
      posts = posts.concat(found);
      chunk += Math.ceil(slice.length / PAGE_LIMIT) - 1;
      const more = chunk * PAGE_LIMIT < ids.length;
      if (!more || posts.length >= POOL_FILL_MIN || extraRequests >= POOL_FILL_MAX_REQUESTS) break;
      extraRequests += 1;
      chunk += 1;
    }
    if (append) {
      const seen = new Set(state.posts.map((post) => post && post.id));
      posts = posts.filter((post) => post && !seen.has(post.id));
    }
    state.hasMore = chunk * PAGE_LIMIT < ids.length;
    state.page = chunk;
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
    const scanned = Math.min(ids.length, state.page * PAGE_LIMIT);
    if (!state.posts.length && !state.hasMore) setStatus(`No viewable posts in ${name}.`, "warn");
    else if (!state.posts.length) setStatus(`No viewable posts in the first ${scanned} of ${ids.length} in ${name}. Load more to keep looking.`, "warn");
    else if (state.hasMore) setStatus(`${state.posts.length} posts from ${name} (${scanned} of ${ids.length} checked).`);
    else setStatus(`${state.posts.length} posts from ${name}.`);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    setStatus(error.message || "Could not load this pool.", "error", { retry: true });
  } finally {
    finishLoad();
  }
}

function openPool(pool) {
  // Keep the pool list (DOM, pages, and scroll) for Back.
  if (poolCatalogView() && els.poolList && els.poolList.childElementCount) {
    state.poolListMemory = {
      pools: state.pools,
      page: state.page,
      pageStart: state.pageStart,
      hasMore: state.hasMore,
      appended: state.appended,
      scrollY: window.scrollY,
      poolId: pool && pool.id,
      status: els.status ? els.status.textContent : "",
      search: (els.poolSearch && els.poolSearch.value) || "",
      order: (els.poolOrder && els.poolOrder.value) || "",
    };
    pushHistoryLayer("pool");
  }
  state.activePool = pool;
  state.poolIds = Array.isArray(pool.post_ids) ? pool.post_ids.slice() : [];
  if (els.poolList) els.poolList.hidden = true;
  if (state.poolListMemory) scrollToY(0);
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
  if (!append) markNewResults();
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

/* ---------- Display options (grid button) ---------- */

function applyDisplayClasses() {
  const { size, shape } = state.display;
  for (const target of [els.grid, document.body]) {
    if (!target) continue;
    target.classList.toggle("thumbs-large", size === "large");
    target.classList.toggle("thumbs-small", size === "small");
    target.classList.toggle("thumbs-full", shape === "full");
  }
  if (els.displayMenu) {
    for (const input of els.displayMenu.querySelectorAll('input[name="thumb-size"]')) input.checked = input.value === size;
    for (const input of els.displayMenu.querySelectorAll('input[name="thumb-shape"]')) input.checked = input.value === shape;
  }
}

function saveDisplayPrefs() {
  setItem(
    DISPLAY_KEY,
    JSON.stringify({
      size: state.display.size,
      shape: state.display.shape,
      ratings: selectedRatings(),
      sort: els.sort ? els.sort.value : "",
    })
  );
}

function restoreDisplayPrefs() {
  let saved = null;
  try {
    saved = JSON.parse(getItem(DISPLAY_KEY) || "null");
  } catch {
    saved = null;
  }
  if (saved && typeof saved === "object") {
    if (["large", "normal", "small"].includes(saved.size)) state.display.size = saved.size;
    if (["full", "cropped"].includes(saved.shape)) state.display.shape = saved.shape;
    if (Array.isArray(saved.ratings)) {
      const allowed = normalizeRatings(saved.ratings);
      for (const box of els.ratingBoxes) box.checked = allowed.includes(box.value);
    }
    if (els.sort && typeof saved.sort === "string" && [...els.sort.options].some((o) => o.value === saved.sort)) {
      els.sort.value = saved.sort;
    }
  }
  applyDisplayClasses();
  syncRatingNote();
}

function syncRatingNote(message) {
  if (!els.displayNote) return;
  if (message) {
    els.displayNote.textContent = message;
    return;
  }
  const allowed = selectedRatings();
  els.displayNote.textContent =
    allowed.length === RATINGS.length ? "Showing all ratings." : "Showing " + allowed.map((r) => RATING_NAMES[r]).join(" and ") + " posts.";
}

function onRatingBoxChange(box) {
  if (!els.ratingBoxes.some((item) => item.checked)) {
    box.checked = true;
    syncRatingNote("Keep at least one rating checked.");
    return;
  }
  syncRatingNote();
  saveDisplayPrefs();
  if (els.app.hidden) return;
  if (state.sub === "blacklist" || state.sub === "saved") return;
  reloadCurrent({ page: 1, append: false });
}

function openDisplayMenu() {
  if (!els.displayMenu) return;
  closeAccountMenu({ focus: false });
  els.displayMenu.hidden = false;
  els.displayBtn.setAttribute("aria-expanded", "true");
  syncRatingNote();
  const first = els.displayMenu.querySelector("input:checked, input, select");
  if (first) first.focus({ preventScroll: true });
}

function closeDisplayMenu({ focus = false } = {}) {
  if (!els.displayMenu || els.displayMenu.hidden) return;
  els.displayMenu.hidden = true;
  if (els.displayBtn) {
    els.displayBtn.setAttribute("aria-expanded", "false");
    if (focus) els.displayBtn.focus({ preventScroll: true });
  }
}

function bindDisplayMenu() {
  if (!els.displayBtn || !els.displayMenu) return;
  els.displayBtn.addEventListener("click", () => {
    if (els.displayMenu.hidden) openDisplayMenu();
    else closeDisplayMenu();
  });
  if (els.displayClose) els.displayClose.addEventListener("click", () => closeDisplayMenu({ focus: true }));
  els.displayMenu.addEventListener("change", (event) => {
    const input = event.target;
    if (input.name === "thumb-size" && input.checked) {
      state.display.size = input.value;
      applyDisplayClasses();
      saveDisplayPrefs();
    } else if (input.name === "thumb-shape" && input.checked) {
      state.display.shape = input.value;
      applyDisplayClasses();
      saveDisplayPrefs();
    }
  });
  els.displayMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeDisplayMenu({ focus: true });
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (els.displayMenu.hidden) return;
    if (els.displayMenu.contains(event.target) || els.displayBtn.contains(event.target)) return;
    closeDisplayMenu();
  });
}

/* ---------- Account menu ---------- */

function onAccountButton() {
  if (!hasBasicAuth()) {
    openAccountDialog();
    return;
  }
  if (els.accountMenu && els.accountMenu.hidden) openAccountMenu();
  else closeAccountMenu({ focus: true });
}

function accountMenuItems() {
  return els.accountMenu ? [...els.accountMenu.querySelectorAll('[role="menuitem"]')] : [];
}

function openAccountMenu() {
  if (!els.accountMenu) return;
  closeDisplayMenu();
  if (els.accountMenuName) els.accountMenuName.textContent = basicAuthUsername();
  els.accountMenu.hidden = false;
  els.accountBtn.setAttribute("aria-expanded", "true");
  loadAccountAvatar();
  const first = accountMenuItems()[0];
  if (first) first.focus({ preventScroll: true });
}

function closeAccountMenu({ focus = false } = {}) {
  if (!els.accountMenu || els.accountMenu.hidden) return;
  els.accountMenu.hidden = true;
  if (els.accountBtn) {
    if (hasBasicAuth()) els.accountBtn.setAttribute("aria-expanded", "false");
    if (focus) els.accountBtn.focus({ preventScroll: true });
  }
}

function bindAccountMenu() {
  if (!els.accountMenu) return;
  els.accountMenuProfile.addEventListener("click", () => {
    closeAccountMenu();
    openProfile(basicAuthUsername(), { own: true });
  });
  els.accountMenuFavorites.addEventListener("click", () => {
    closeAccountMenu();
    openOwnFavorites();
  });
  els.accountMenuLogout.addEventListener("click", () => {
    closeAccountMenu();
    signOut();
    if (els.accountBtn) els.accountBtn.focus({ preventScroll: true });
  });
  els.accountMenu.addEventListener("keydown", (event) => {
    const items = accountMenuItems();
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAccountMenu({ focus: true });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === "Tab") {
      closeAccountMenu();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (els.accountMenu.hidden) return;
    if (els.accountMenu.contains(event.target) || els.accountBtn.contains(event.target)) return;
    closeAccountMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.accountMenu.hidden) closeAccountMenu({ focus: true });
  });
}

function openOwnFavorites() {
  const name = basicAuthUsername();
  if (!name) return;
  closeProfile();
  if (els.viewer && els.viewer.open) closeViewer();
  if (els.favUser) els.favUser.value = name;
  if (state.view !== "posts") setView("posts");
  resetResults();
  setSub("favorites");
  return loadFavorites({ page: 1, append: false });
}

/** Avatar: the thumbnail of the post set as the profile picture, or the first letter. */
function setAvatar(node, post, name) {
  if (!node) return;
  node.textContent = "";
  const url = post ? previewUrl(post) || sampleImageUrl(post) : "";
  if (url) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.src = url;
    img.addEventListener("error", () => setAvatar(node, null, name));
    node.append(img);
    node.dataset.hasImage = "true";
  } else {
    node.textContent = String(name || "?").charAt(0).toUpperCase();
    node.dataset.hasImage = "false";
  }
}

/**
 * The avatar post goes through the same rating checkboxes and blacklist as
 * everything else; when it is filtered out, the letter is shown instead.
 */
async function avatarPost(avatarId) {
  const id = Number(avatarId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const key = id + "|" + selectedRatings().join("") + "|" + state.blacklist.join("\n");
  if (state.avatarCache.has(key)) return state.avatarCache.get(key);
  const posts = await fetchPostsByIds([id], { extraTags: exclusionTagString() });
  const allowed = clientFilter(posts || []);
  const post = allowed.find((item) => Number(item.id) === id) || null;
  state.avatarCache.set(key, post);
  return post;
}

function loadAccountAvatar() {
  const user = state.authUser;
  const name = basicAuthUsername();
  if (!els.accountMenuAvatar) return;
  if (!els.accountMenuAvatar.dataset.hasImage) setAvatar(els.accountMenuAvatar, null, name);
  if (!user || !user.avatar_id) {
    setAvatar(els.accountMenuAvatar, null, name);
    return;
  }
  const seq = ++state.avatarSeq;
  avatarPost(user.avatar_id)
    .then((post) => {
      if (seq === state.avatarSeq && hasBasicAuth()) setAvatar(els.accountMenuAvatar, post, name);
    })
    .catch(() => {
      if (seq === state.avatarSeq) setAvatar(els.accountMenuAvatar, null, name);
    });
}

/* ---------- Profile page ---------- */

function closeProfile() {
  state.profileSeq += 1;
  hideDialog(els.profileDialog);
}

function runProfileSearch(query) {
  closeProfile();
  if (els.viewer && els.viewer.open) closeViewer();
  if (state.view !== "posts") setView("posts");
  setSub("");
  els.search.value = query;
  return searchFromStart();
}

function profileDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

async function renderProfileStrip(section, query) {
  const strip = section.querySelector(".profile-strip");
  const note = section.querySelector(".profile-strip-note");
  try {
    const built = buildSearchQuery({ userQuery: query, rating: selectedRatings(), order: "", blacklist: blacklistTags() });
    const posts = clientFilter(await fetchPosts({ tags: built.tags, page: 1, limit: 6 }), { query });
    strip.textContent = "";
    for (const post of posts.slice(0, 6)) {
      const url = previewUrl(post) || sampleImageUrl(post);
      if (!url) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-thumb";
      button.setAttribute("aria-label", "Post " + post.id + ", open " + query);
      const img = document.createElement("img");
      img.alt = "Post " + post.id;
      img.loading = "lazy";
      img.src = url;
      button.append(img);
      button.addEventListener("click", () => runProfileSearch(query));
      strip.append(button);
    }
    note.textContent = strip.childElementCount ? "" : "Nothing to show with your current ratings and blacklist.";
  } catch (error) {
    if (error && error.name === "AbortError") return;
    note.textContent = (error && error.message) || "Could not load posts.";
  }
}

async function openProfile(name, { own = false } = {}) {
  if (!els.profileDialog || !name) return;
  const seq = ++state.profileSeq;
  els.profileName.textContent = name;
  els.profileLevel.textContent = "";
  els.profileJoined.textContent = "";
  els.profileStats.textContent = "";
  els.profileSections.textContent = "";
  els.profileAboutWrap.hidden = true;
  els.profileArtinfoWrap.hidden = true;
  els.profileSettings.hidden = !own;
  els.profileOpen.href = "https://e621.net/users/" + encodeURIComponent(name);
  setAvatar(els.profileAvatar, null, name);
  els.profileStatus.textContent = "Loading profile…";
  showDialog(els.profileDialog);
  let user = own && state.authUser && String(state.authUser.name).toLowerCase() === name.toLowerCase() ? state.authUser : null;
  try {
    user = await fetchUser(name);
    if (own) state.authUser = { ...(state.authUser || {}), ...user };
  } catch (error) {
    if (!user) {
      if (seq === state.profileSeq) els.profileStatus.textContent = "Could not load the profile: " + ((error && error.message) || "error");
      return;
    }
  }
  if (seq !== state.profileSeq) return;
  els.profileStatus.textContent = "";
  els.profileName.textContent = user.name || name;
  if (user.id) els.profileOpen.href = "https://e621.net/users/" + Number(user.id);
  els.profileLevel.textContent = [user.level_string, user.is_verified ? "Verified" : "", user.is_banned ? "Banned" : ""].filter(Boolean).join(" · ");
  const joined = profileDate(user.created_at);
  els.profileJoined.textContent = joined ? "Joined " + joined : "";
  for (const stat of profileStats(user)) {
    const wrap = document.createElement("div");
    wrap.className = "profile-stat";
    wrap.dataset.key = stat.key;
    const dt = document.createElement("dt");
    dt.textContent = stat.label;
    const dd = document.createElement("dd");
    if (stat.search) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "profile-stat-link";
      link.textContent = typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value;
      link.setAttribute("aria-label", stat.label + ": " + stat.value + ". Search " + stat.search);
      link.addEventListener("click", () => runProfileSearch(stat.search));
      dd.append(link);
    } else {
      dd.textContent = typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value;
    }
    wrap.append(dt, dd);
    els.profileStats.append(wrap);
  }
  if (user.profile_about) {
    renderDTextInto(els.profileAbout, user.profile_about);
    els.profileAboutWrap.hidden = false;
  }
  if (user.profile_artinfo) {
    renderDTextInto(els.profileArtinfo, user.profile_artinfo);
    els.profileArtinfoWrap.hidden = false;
  }
  for (const item of profileSearches(user.name || name, { own })) {
    const section = document.createElement("section");
    section.className = "profile-section";
    section.dataset.key = item.key;
    const head = document.createElement("div");
    head.className = "profile-section-head";
    const title = document.createElement("h3");
    title.className = "viewer-section-title";
    title.textContent = item.label;
    const all = document.createElement("button");
    all.type = "button";
    all.className = "secondary profile-see-all";
    all.textContent = "See all";
    all.setAttribute("aria-label", "See all: " + item.query);
    all.addEventListener("click", () => runProfileSearch(item.query));
    head.append(title, all);
    const strip = document.createElement("div");
    strip.className = "profile-strip";
    const note = document.createElement("p");
    note.className = "muted tight profile-strip-note";
    note.textContent = "Loading…";
    section.append(head, strip, note);
    els.profileSections.append(section);
  }
  if (user.avatar_id) {
    avatarPost(user.avatar_id)
      .then((post) => {
        if (seq === state.profileSeq) setAvatar(els.profileAvatar, post, user.name || name);
      })
      .catch(() => {});
  }
  // Load the strips one after another (requests are rate-limited anyway).
  for (const section of els.profileSections.querySelectorAll(".profile-section")) {
    if (seq !== state.profileSeq) return;
    const item = profileSearches(user.name || name, { own }).find((entry) => entry.key === section.dataset.key);
    if (item) await renderProfileStrip(section, item.query);
  }
}

function bindProfile() {
  if (!els.profileDialog) return;
  els.profileClose.addEventListener("click", closeProfile);
  els.profileDialog.addEventListener("cancel", () => {
    state.profileSeq += 1;
  });
  if (els.profileSettings) {
    els.profileSettings.addEventListener("click", () => {
      closeProfile();
      openAccountDialog();
    });
  }
  if (els.profileAbout) els.profileAbout.addEventListener("click", handleDTextLink);
}

/* ---------- Blacklist sync with the e621 account ---------- */

function syncBaseKey(userId) {
  return BLACKLIST_BASE_KEY + ":" + Number(userId);
}

function loadSyncBase(userId) {
  try {
    const lines = JSON.parse(getItem(syncBaseKey(userId)) || "null");
    return Array.isArray(lines) ? lines : null;
  } catch {
    return null;
  }
}

function saveSyncBase(userId, lines) {
  setItem(syncBaseKey(userId), JSON.stringify(normalizeBlacklistLines(lines)));
}

function syncSuffix() {
  return hasBasicAuth() && state.authUser && state.authUser.id ? " It syncs to your e621 account." : "";
}

function setBlacklistSyncStatus(message, kind = "") {
  if (!els.blacklistSyncStatus) return;
  els.blacklistSyncStatus.textContent = message;
  if (kind) els.blacklistSyncStatus.dataset.kind = kind;
  else delete els.blacklistSyncStatus.dataset.kind;
}

function renderBlacklistSync() {
  if (!els.blacklistSyncStatus) return;
  const signed = hasBasicAuth();
  if (els.blacklistSyncNow) {
    els.blacklistSyncNow.hidden = !signed;
    els.blacklistSyncNow.disabled = state.blacklistSync.busy;
  }
  if (!signed) setBlacklistSyncStatus("Sign in to sync this list with your e621 account blacklist.");
}

function blacklistChanged() {
  persistBlacklist();
  renderBlacklist();
  state.avatarCache.clear();
  scheduleBlacklistSync();
}

function scheduleBlacklistSync() {
  if (!hasBasicAuth() || !state.authUser || !state.authUser.id) return;
  window.clearTimeout(state.blacklistSync.timer);
  setBlacklistSyncStatus("Saving to your e621 account…");
  state.blacklistSync.timer = window.setTimeout(() => syncBlacklist(), BLACKLIST_SYNC_DEBOUNCE_MS);
}

/**
 * Two-way sync: read the account's blacklisted_tags, three-way merge with
 * the local list (base = last synced list), save locally, and PATCH the
 * account only when its list differs from the merged result.
 */
async function syncBlacklist({ user = null, manual = false } = {}) {
  const sync = state.blacklistSync;
  window.clearTimeout(sync.timer);
  if (!hasBasicAuth()) {
    renderBlacklistSync();
    return;
  }
  if (sync.busy) {
    sync.again = true;
    return;
  }
  sync.busy = true;
  renderBlacklistSync();
  setBlacklistSyncStatus(manual ? "Syncing with e621…" : "Checking your e621 blacklist…");
  try {
    let record = user;
    if (!record || typeof record.blacklisted_tags !== "string") {
      const id = state.authUser && state.authUser.id;
      record = await fetchUser(id || basicAuthUsername());
      if (record && record.id) state.authUser = { ...(state.authUser || {}), ...record };
    }
    if (!record || typeof record.blacklisted_tags !== "string") {
      const error = new Error("e621 did not include your account blacklist in the response, so it can't be synced.");
      error.code = "no-blacklist";
      throw error;
    }
    const userId = Number(record.id || (state.authUser && state.authUser.id));
    const remote = parseBlacklistText(record.blacklisted_tags);
    const base = loadSyncBase(userId);
    const merged = mergeBlacklists({ base, local: state.blacklist, remote });
    const localChanged = !sameBlacklist(merged, state.blacklist);
    const remoteChanged = !sameBlacklist(merged, remote);
    if (localChanged) {
      state.blacklist = merged;
      persistBlacklist();
      renderBlacklist();
      state.avatarCache.clear();
    }
    if (remoteChanged) {
      setBlacklistSyncStatus("Saving to your e621 account…");
      await updateAccountBlacklist(userId, serializeBlacklist(merged));
    }
    saveSyncBase(userId, merged);
    sync.lastOk = Date.now();
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const parts = [];
    if (localChanged) parts.push("updated from your account");
    if (remoteChanged) parts.push("saved to your account");
    setBlacklistSyncStatus(
      "Synced with e621 at " + time + " (" + merged.length + (merged.length === 1 ? " line" : " lines") + (parts.length ? ", " + parts.join(" and ") : "") + ").",
      "ok"
    );
  } catch (error) {
    if (error && error.name === "AbortError") return;
    const message = (error && error.message) || "Sync failed.";
    setBlacklistSyncStatus("Blacklist sync failed: " + message + " Your list is still saved on this device.", "error");
  } finally {
    sync.busy = false;
    renderBlacklistSync();
    if (sync.again) {
      sync.again = false;
      syncBlacklist();
    }
  }
}

/* ---------- Download and fullscreen ---------- */

function triggerDownload(href, name) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Saves the original file with a readable name. e621's file server only
 * allows cross-site reads from e621.net, so when the blob fetch is blocked
 * the file opens in a new tab instead (save it from there).
 */
async function downloadCurrentPost() {
  const post = currentViewerPost();
  if (!post || state.downloadBusy) return;
  const url = originalUrl(post) || sampleImageUrl(post);
  if (!url) {
    setActionStatus("This post has no file to download.", "error");
    return;
  }
  const name = downloadFilename(post);
  state.downloadBusy = true;
  els.viewerDownload.disabled = true;
  setActionStatus("Downloading " + name + "…");
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    triggerDownload(href, name);
    window.setTimeout(() => URL.revokeObjectURL(href), 60000);
    els.viewerDownload.dataset.lastName = name;
    els.viewerDownload.dataset.lastVia = "blob";
    setActionStatus("Saved " + name + ".", "ok");
  } catch (error) {
    els.viewerDownload.dataset.lastName = name;
    els.viewerDownload.dataset.lastVia = "open";
    // Without "noopener" in the features so the return value says whether a
    // pop-up blocker stopped it; the opener link is cut right after.
    const opened = window.open(url, "_blank");
    if (opened) {
      try {
        opened.opener = null;
      } catch {
        /* cross-origin */
      }
    }
    setActionStatus(
      "e621 doesn't allow direct downloads from other sites, so the original " +
        (opened === null ? "can be opened with the link below" : "opened in a new tab") +
        ". Save it from there as: " +
        name,
      "warn"
    );
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "download-fallback";
    link.textContent = " Open the file";
    if (els.viewerActionStatus) els.viewerActionStatus.append(link);
  } finally {
    state.downloadBusy = false;
    els.viewerDownload.disabled = false;
  }
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function toggleViewerFullscreen() {
  if (fullscreenElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    return;
  }
  const stage = els.viewerStage;
  const video = stage && stage.querySelector("video");
  const request = stage && (stage.requestFullscreen || stage.webkitRequestFullscreen);
  const iosVideo = () => {
    if (video && typeof video.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen();
      return true;
    }
    return false;
  };
  if (request) {
    try {
      const result = request.call(stage);
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          if (!iosVideo()) setActionStatus("Fullscreen isn't available here.", "error");
        });
      }
      return;
    } catch {
      /* fall through */
    }
  }
  // iPhone Safari only allows fullscreen on <video>.
  if (!iosVideo()) setActionStatus("Fullscreen isn't available for images in this browser. Pinch to zoom instead.", "error");
}

function onFullscreenChange() {
  const active = fullscreenElement() === els.viewerStage;
  if (els.viewerStage) els.viewerStage.classList.toggle("is-fullscreen", active);
  if (els.viewerFullscreen) {
    els.viewerFullscreen.textContent = active ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
    els.viewerFullscreen.setAttribute("aria-pressed", active ? "true" : "false");
  }
  // The media size changed: start unzoomed and realign the notes.
  resetViewerZoom();
  window.requestAnimationFrame(layoutNotesLayer);
}

/* ---------- Add comment ---------- */

function resetCommentCompose() {
  if (!els.commentForm) return;
  els.commentForm.hidden = true;
  if (els.commentAdd) {
    els.commentAdd.hidden = false;
    els.commentAdd.setAttribute("aria-expanded", "false");
  }
  if (els.commentText) els.commentText.value = "";
  if (els.commentPreview) {
    els.commentPreview.hidden = true;
    els.commentPreview.textContent = "";
  }
  if (els.commentPreviewBtn) {
    els.commentPreviewBtn.setAttribute("aria-pressed", "false");
    els.commentPreviewBtn.textContent = "Preview";
  }
  setCommentStatus("");
}

function setCommentStatus(message, kind = "") {
  if (!els.commentStatus) return;
  els.commentStatus.textContent = message || "";
  if (kind) els.commentStatus.dataset.kind = kind;
  else delete els.commentStatus.dataset.kind;
}

function openCommentForm() {
  if (!hasBasicAuth()) {
    setCommentStatus("");
    requireSignInForAction("comment");
    return;
  }
  els.commentForm.hidden = false;
  els.commentAdd.hidden = true;
  els.commentAdd.setAttribute("aria-expanded", "true");
  els.commentText.focus({ preventScroll: true });
  els.commentForm.scrollIntoView({ block: "nearest" });
}

function toggleCommentPreview() {
  const showing = !els.commentPreview.hidden;
  if (showing) {
    els.commentPreview.hidden = true;
    els.commentPreviewBtn.setAttribute("aria-pressed", "false");
    els.commentPreviewBtn.textContent = "Preview";
    return;
  }
  const text = els.commentText.value.trim();
  renderDTextInto(els.commentPreview, text || "(Nothing to preview yet.)");
  els.commentPreview.hidden = false;
  els.commentPreviewBtn.setAttribute("aria-pressed", "true");
  els.commentPreviewBtn.textContent = "Edit";
}

async function submitComment(event) {
  event.preventDefault();
  const post = currentViewerPost();
  if (!post || state.commentBusy) return;
  if (!hasBasicAuth()) {
    requireSignInForAction("comment");
    return;
  }
  const body = els.commentText.value.trim();
  if (!body) {
    setCommentStatus("Write something first.", "error");
    els.commentText.focus();
    return;
  }
  state.commentBusy = true;
  els.commentPost.disabled = true;
  setCommentStatus("Posting…");
  try {
    const result = await postComment(post.id, body);
    const created = (result && (result.comment || result)) || {};
    const comment = {
      id: created.id,
      body: created.body || body,
      created_at: created.created_at || new Date().toISOString(),
      creator_id: created.creator_id || (state.authUser && state.authUser.id),
      creator_name: created.creator_name || basicAuthUsername(),
      score: created.score || 0,
    };
    if (currentViewerPost() !== post) return;
    els.viewerCommentsList.append(renderComment(comment));
    els.viewerCommentsStatus.textContent = "";
    const stats = post.stats || (post.stats = {});
    const count = (Number(postCommentCount(post)) || 0) + 1;
    stats.comment_count = count;
    els.viewerCommentsTitle.textContent = "Comments (" + count + ")";
    resetCommentCompose();
    setCommentStatus("Comment posted.", "ok");
  } catch (error) {
    if (error && error.code === "auth") {
      requireSignInForAction("comment");
    } else {
      setCommentStatus("Could not post the comment: " + ((error && error.message) || "error"), "error");
    }
  } finally {
    state.commentBusy = false;
    els.commentPost.disabled = false;
  }
}

function bindCommentCompose() {
  if (!els.commentForm) return;
  els.commentAdd.addEventListener("click", openCommentForm);
  els.commentForm.addEventListener("submit", submitComment);
  els.commentPreviewBtn.addEventListener("click", toggleCommentPreview);
  els.commentCancel.addEventListener("click", () => {
    resetCommentCompose();
    els.commentAdd.focus({ preventScroll: true });
  });
  els.commentText.addEventListener("input", () => {
    if (!els.commentPreview.hidden) renderDTextInto(els.commentPreview, els.commentText.value.trim() || "(Nothing to preview yet.)");
  });
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

  for (const box of els.ratingBoxes) {
    box.addEventListener("change", () => onRatingBoxChange(box));
  }
  els.sort.addEventListener("change", () => {
    saveDisplayPrefs();
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
  if (els.accountBtn) els.accountBtn.addEventListener("click", onAccountButton);
  bindAccountMenu();
  bindDisplayMenu();
  bindProfile();
  if (els.blacklistSyncNow) els.blacklistSyncNow.addEventListener("click", () => syncBlacklist({ manual: true }));
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
      dropHistoryLayer("pool");
      backToPoolList();
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
  els.viewer.addEventListener("close", restoreGridAfterViewer);
  els.viewer.addEventListener("close", function () {
    dropHistoryLayer("viewer");
  });
  window.addEventListener("popstate", onHistoryPop);
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
  bindViewerZoom();
  bindViewerExtras();
  bindInfiniteScroll();
}

function restorePrefs() {
  const sample = getItem(SAMPLE_KEY);
  if (els.preferSample) els.preferSample.checked = sample !== "0";
  state.blacklist = normalizeBlacklist(parseStoredList(getItem(BLACKLIST_KEY) || "", true));
  state.commentsHidden = getItem(COMMENTS_HIDDEN_KEY) === "1";
  restoreDisplayPrefs();
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
