/**
 * Search-query and post helpers.
 * Queries are passed to e621 as typed: ~or tags, -negation, wildcards,
 * ( groups ), and every metatag. The only things this adds are the user's
 * blacklist (as -tag), and the Rating and Sort selects when the query does not
 * already set rating: or order: itself.
 */
import { normalizeRatings, ratingQueryToken } from "./account.js";
import { blacklistLineMatches, blacklistLineTags, normalizeBlacklistLines, singleTagLines } from "./blacklist.js";

export const MAX_SEARCH_TAGS = 40;

export function normalizeTag(value) {
  return String(value ?? "").trim().toLowerCase();
}

/** Lowercased tag without a leading - or ~ prefix. */
export function tagName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[-~]+/, "");
}

/**
 * Split a search on whitespace, keeping double-quoted metatag values
 * together (for example description:"hello there").
 */
export function tokenize(query) {
  if (!query) return [];
  return String(query).match(/(?:[^\s"]+|"[^"]*"?)+/g) || [];
}

export function collectTags(post) {
  const tags = post && post.tags;
  const out = [];
  if (!tags) return out;
  if (Array.isArray(tags)) {
    for (const tag of tags) out.push(tagName(tag));
    return out;
  }
  if (typeof tags === "object") {
    for (const value of Object.values(tags)) {
      if (Array.isArray(value)) {
        for (const tag of value) out.push(tagName(tag));
      } else if (typeof value === "string") {
        for (const tag of tokenize(value)) out.push(tagName(tag));
      }
    }
  }
  return out;
}

export function postFileUrl(post) {
  if (!post) return null;
  if (post.flags && post.flags.deleted) return null;
  const files = post.files || {};
  const url =
    (files.original && files.original.url) ||
    (post.file && post.file.url) ||
    null;
  return url || null;
}

/** Posts without a viewable file (deleted, or hidden by e621) are skipped. */
export function shouldExcludePost(post) {
  return !post || !postFileUrl(post);
}

export function filterPosts(posts) {
  if (!Array.isArray(posts)) return [];
  return posts.filter((post) => !shouldExcludePost(post));
}

export function filterSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((item) => item != null && (typeof item === "string" || item.name || item.tag));
}

export function normalizePostsResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.posts)) return data.posts;
  return [];
}

/** The metatag name of a token ("-order:score" -> "order"), or "". */
export function tokenMetatag(token) {
  const m = /^[-~]?([a-z_]+):/i.exec(String(token || ""));
  return m ? m[1].toLowerCase() : "";
}

export function queryHasMetatag(query, names) {
  const want = new Set((Array.isArray(names) ? names : [names]).map((n) => String(n).toLowerCase()));
  return tokenize(query).some((token) => want.has(tokenMetatag(token)));
}

const ORDER_METATAGS = ["order", "randseed"];

function isGroupToken(token) {
  return /^[-~]?\($/.test(token) || token === ")";
}

/**
 * Build a tags string for posts.json.
 * - The user's tokens are kept exactly as typed (only exact duplicates of
 *   plain tags are dropped; group parentheses are never touched).
 * - limit: is dropped because the app controls the page size.
 * - Single-tag blacklist lines become -tag unless the search already names
 *   that tag. Multi-tag lines are only checked in the browser.
 * - The rating checkboxes add rating:x (one) or -rating:x (two) only if the
 *   query has no rating: token of its own,
 *   and the Sort select adds order:X only if the query has no order:/randseed:.
 * - If the query would exceed e621's 40-tag limit, user tags are trimmed last-first.
 */
export function buildSearchQuery({
  userQuery = "",
  rating = "all",
  order = "",
  blacklist = [],
} = {}) {
  const droppedForLimit = [];
  const seen = new Set();
  const userTokens = [];
  const mentioned = new Set();

  for (const raw of tokenize(userQuery)) {
    const token = raw.trim();
    if (!token) continue;
    if (tokenMetatag(token) === "limit") continue;
    if (!isGroupToken(token)) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!tokenMetatag(token)) mentioned.add(tagName(token));
    }
    userTokens.push(token);
  }

  const extras = [];
  for (const raw of singleTagLines(blacklist || [])) {
    const name = tagName(raw);
    if (!name || mentioned.has(name)) continue;
    const token = `-${name}`;
    if (seen.has(token)) continue;
    seen.add(token);
    extras.push(token);
  }

  const ratingInQuery = queryHasMetatag(userQuery, "rating");
  const ratingToken = ratingQueryToken(rating);
  const ratingApplied = Boolean(ratingToken && !ratingInQuery);
  if (ratingApplied) extras.push(ratingToken);

  const orderInQuery = queryHasMetatag(userQuery, ORDER_METATAGS);
  if (order && !orderInQuery) {
    extras.push(order.startsWith("order:") ? order : `order:${order}`);
  }

  const groupTokens = userTokens.filter(isGroupToken).length;
  // Drop blacklist extras first, then user tags, so the user's search wins.
  // (This also runs for an empty search: a long synced blacklist alone used
  // to exceed e621's limit and fail the request.)
  while (extras.length && userTokens.length - groupTokens + extras.length > MAX_SEARCH_TAGS && extras[0].startsWith("-")) {
    extras.shift();
  }
  const allowedUser = Math.max(0, MAX_SEARCH_TAGS - extras.length);
  let keptUser = userTokens;
  if (userTokens.length - groupTokens > allowedUser) {
    const room = Math.max(0, MAX_SEARCH_TAGS - extras.length);
    if (userTokens.length - groupTokens > room) {
      keptUser = [];
      let count = 0;
      for (const token of userTokens) {
        if (isGroupToken(token)) {
          keptUser.push(token);
          continue;
        }
        if (count < room) {
          keptUser.push(token);
          count += 1;
        } else {
          droppedForLimit.push(token);
        }
      }
    }
  }

  const tags = [...keptUser, ...extras].join(" ");
  let warning = "";
  if (droppedForLimit.length) {
    warning = `Search was trimmed to ${MAX_SEARCH_TAGS} tags (e621's limit).`;
  }

  return {
    tags,
    droppedForLimit,
    ratingApplied,
    warning,
  };
}

export function filterPools(pools) {
  if (!Array.isArray(pools)) return [];
  return pools.filter((pool) => pool && pool.name);
}

export function poolResponseHasMore(rawCount, limit, page, maxPage) {
  return Number(rawCount) >= Number(limit) && Number(page) < Number(maxPage);
}

export function shouldFetchMorePools(rawCount, limit, visibleCount, extraFetches, maxExtra) {
  return (
    Number(rawCount) >= Number(limit) &&
    Number(visibleCount) < Number(limit) &&
    Number(extraFetches) < Number(maxExtra)
  );
}

/**
 * Client-side filters: the allowed ratings ("all", "s", or a list like
 * ["s","q"]) and the blacklist (e621-style lines, see blacklist.js).
 */
export function applyClientFilters(posts, { rating = "all", blacklist = [] } = {}) {
  let out = filterPosts(posts);
  const allowed = normalizeRatings(rating);
  if (allowed.length < 3) {
    out = out.filter((post) => post && allowed.includes(String(post.rating || "").charAt(0)));
  }
  const lines = normalizeBlacklistLines(blacklist);
  if (lines.length) {
    out = out.filter((post) => {
      const tags = new Set(collectTags(post));
      return !lines.some((line) => blacklistLineMatches(line, tags, post.rating));
    });
  }
  return out;
}

/** Blacklist lines that don't name any tag the search asks for. */
export function blacklistForQuery(blacklist, query) {
  const named = new Set(tokenize(query).filter((t) => !tokenMetatag(t) && !/^-/.test(t)).map((t) => tagName(t)));
  return normalizeBlacklistLines(blacklist).filter((line) => !blacklistLineTags(line).some((tag) => named.has(tag)));
}

export function sanitizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^fav:/i, "")
    .replace(/^@/, "");
}

export function isValidUsername(value) {
  const name = sanitizeUsername(value);
  return /^[A-Za-z0-9_~\-]+$/.test(name) && name.length >= 1 && name.length <= 100;
}

export const TAG_CATEGORY_ORDER = Object.freeze([
  "artist",
  "contributor",
  "copyright",
  "character",
  "species",
  "general",
  "meta",
  "lore",
  "invalid",
]);

export const TAG_CATEGORY_LABELS = Object.freeze({
  artist: "Artists",
  contributor: "Contributors",
  copyright: "Copyrights",
  character: "Characters",
  species: "Species",
  meta: "Meta",
  lore: "Lore",
  general: "General",
  invalid: "Invalid",
});

export function formatTagCategoryLabel(category) {
  const key = String(category || "").trim();
  if (TAG_CATEGORY_LABELS[key]) return TAG_CATEGORY_LABELS[key];
  if (!key) return "Tags";
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, function (ch) {
      return ch.toUpperCase();
    });
}

function tagListFrom(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return tokenize(value);
  return [];
}

function uniqueAllowedTags(list) {
  const names = [];
  const seen = new Set();
  for (const raw of tagListFrom(list)) {
    const name = tagName(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Group a post's tags by category.
 * Accepts a category object or a flat array (listed as general).
 */
export function collectTagsByCategory(post) {
  const groups = [];
  const tags = post && post.tags;
  if (!tags) return groups;
  if (Array.isArray(tags)) {
    const names = uniqueAllowedTags(tags);
    if (names.length) groups.push({ category: "general", tags: names });
    return groups;
  }
  if (typeof tags === "object") {
    const used = new Set();
    for (const category of TAG_CATEGORY_ORDER) {
      if (!Object.prototype.hasOwnProperty.call(tags, category)) continue;
      used.add(category);
      const names = uniqueAllowedTags(tags[category]);
      if (names.length) groups.push({ category: category, tags: names });
    }
    const extras = Object.keys(tags)
      .filter((key) => !used.has(key))
      .sort();
    for (const category of extras) {
      const names = uniqueAllowedTags(tags[category]);
      if (names.length) groups.push({ category: category, tags: names });
    }
  }
  return groups;
}

export function formatPoolName(name) {
  return String(name || "").replace(/_/g, " ").trim();
}

export function postPoolIds(post) {
  const raw = (post && (post.pools || post.pool_ids)) || [];
  const out = [];
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isFinite(id) || out.indexOf(id) !== -1) continue;
    out.push(id);
  }
  return out;
}

export function poolIdStatus(statusMap, id) {
  if (!statusMap) return "";
  const value = statusMap[String(id)];
  return value ? String(value) : "";
}

export function poolDirectionOpen(ids, fromIndex, direction, statusMap) {
  const list = Array.isArray(ids) ? ids : [];
  const dir = direction < 0 ? -1 : 1;
  let i = Number(fromIndex);
  if (!Number.isFinite(i)) i = dir < 0 ? list.length : -1;
  for (i = i + dir; i >= 0 && i < list.length; i += dir) {
    const id = Number(list[i]);
    if (!Number.isFinite(id)) continue;
    if (poolIdStatus(statusMap, id) !== "blocked") return true;
  }
  return false;
}

export function stepPoolIds(ids, fromIndex, direction, statusMap, batchSize) {
  const list = Array.isArray(ids) ? ids : [];
  const dir = direction < 0 ? -1 : 1;
  const size = Math.max(1, Number(batchSize) || 8);
  const need = [];
  let i = Number(fromIndex);
  if (!Number.isFinite(i)) i = dir < 0 ? list.length : -1;
  for (i = i + dir; i >= 0 && i < list.length; i += dir) {
    const id = Number(list[i]);
    if (!Number.isFinite(id)) continue;
    const status = poolIdStatus(statusMap, id);
    if (status === "ok") return { index: i, id: id, need: [] };
    if (status === "blocked") continue;
    need.push(id);
    if (need.length >= size) break;
  }
  return { index: -1, id: null, need: need };
}

// First/Last: scan from the start or the end. Unlike stepPoolIds, a cached
// post in the middle does not win over unknown posts closer to that end.
export function stepPoolEnd(ids, towardLast, statusMap, batchSize) {
  const list = Array.isArray(ids) ? ids : [];
  const last = !!towardLast;
  const step = last ? -1 : 1;
  const size = Math.max(1, Number(batchSize) || 8);
  const need = [];
  for (let i = last ? list.length - 1 : 0; i >= 0 && i < list.length; i += step) {
    const id = Number(list[i]);
    if (!Number.isFinite(id)) continue;
    const status = poolIdStatus(statusMap, id);
    if (status === "ok") {
      // An already-cached post further inward must not hide unknown posts
      // closer to this end (Last from the first post used to no-op).
      if (need.length) break;
      return { index: i, id: id, need: [] };
    }
    if (status === "blocked") continue;
    need.push(id);
    if (need.length >= size) break;
  }
  return { index: -1, id: null, need: need };
}

function numericValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function postFavCount(post) {
  const stats = post && post.stats;
  if (stats && stats.fav_count != null) return numericValue(stats.fav_count, 0);
  if (post && post.fav_count != null) return numericValue(post.fav_count, 0);
  return 0;
}

export function postScoreTotal(post) {
  const stats = post && post.stats;
  const score = (stats && stats.score) || (post && post.score);
  if (score && typeof score === "object") return numericValue(score.total, 0);
  if (score != null && typeof score !== "object") return numericValue(score, 0);
  return 0;
}

export function formatPostStats(post) {
  const favs = postFavCount(post);
  const total = postScoreTotal(post);
  const direction = total > 0 ? "up" : total < 0 ? "down" : "zero";
  const mark = direction === "up" ? "⬆" : direction === "down" ? "⬇" : "=";
  const shown = direction === "zero" ? 0 : Math.abs(total);
  return {
    favs: favs,
    total: total,
    direction: direction,
    mark: mark,
    favText: "☆" + favs,
    scoreText: mark + " " + shown,
    text: "☆" + favs + " " + mark + " " + shown,
  };
}

export function uniquePostIds(list) {
  const raw = Array.isArray(list) ? list : String(list == null ? "" : list).split(/[,\s]+/);
  const out = [];
  const seen = {};
  for (let i = 0; i < raw.length; i++) {
    const id = Number(raw[i]);
    if (!Number.isFinite(id) || id <= 0 || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

export function postParentId(post) {
  const rel = post && post.relationships;
  if (rel && rel.parent_id != null) return uniquePostIds([rel.parent_id])[0] || null;
  if (post && post.parent_id != null) return uniquePostIds([post.parent_id])[0] || null;
  return null;
}

export function postChildIds(post) {
  const rel = post && post.relationships;
  const has = post && post.has;
  const raw =
    (rel && rel.children) ||
    (post && post.children) ||
    (post && post.children_ids) ||
    [];
  const selfId = post && post.id != null ? Number(post.id) : 0;
  return uniquePostIds(raw).filter(function (id) {
    return id !== selfId;
  });
}

export function postHasActiveChildren(post) {
  const rel = post && post.relationships;
  const has = post && post.has;
  if (rel && rel.has_active_children != null) return Boolean(rel.has_active_children);
  if (has && has.active_children != null) return Boolean(has.active_children);
  if (rel && rel.has_children != null) return Boolean(rel.has_children);
  if (has && has.children != null) return Boolean(has.children);
  return postChildIds(post).length > 0;
}

// Keep a tag string within e621's 40-tag limit while leaving `reserve` slots
// for tags added beside it (such as one id:1,2,3 metatag). Blacklist
// exclusions ("-tag") are dropped first, from the front; the rest (rating,
// order) are kept. Blacklisted posts are still hidden client side.
export function fitTagLimit(tags, reserve = 0, max = MAX_SEARCH_TAGS) {
  const tokens = String(tags || "").split(/\s+/).filter(Boolean);
  const room = Math.max(0, max - reserve);
  while (tokens.length > room) {
    const index = tokens.findIndex((token) => token.startsWith("-") && !token.includes(":"));
    if (index < 0) break;
    tokens.splice(index, 1);
  }
  return tokens.join(" ");
}
