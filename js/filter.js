/**
 * Hard exclusion and search-query helpers.
 * Blocked tags cannot be disabled by UI or URL parameters.
 */
export const BLOCKED_TAGS = Object.freeze(["young", "loli", "shota", "cub"]);
export const FORCED_EXCLUSIONS = Object.freeze(
  BLOCKED_TAGS.map((tag) => `-${tag}`)
);
export const MAX_SEARCH_TAGS = 40;

const BLOCKED_SET = new Set(BLOCKED_TAGS);

export function normalizeTag(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^-+/, (prefix) => prefix); // keep leading minuses for callers that need them
}

export function tagName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^-+/, "");
}

export function isBlockedTag(value) {
  return BLOCKED_SET.has(tagName(value));
}

export function tokenize(query) {
  if (!query) return [];
  return String(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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

export function shouldExcludePost(post) {
  if (!post || !postFileUrl(post)) return true;
  return collectTags(post).some((tag) => BLOCKED_SET.has(tag));
}

export function filterPosts(posts) {
  if (!Array.isArray(posts)) return [];
  return posts.filter((post) => !shouldExcludePost(post));
}

export function filterSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((item) => {
    if (item == null) return false;
    if (typeof item === "string") return !isBlockedTag(item);
    const name = item.name || item.tag || "";
    const antecedent = item.antecedent_name || item.antecedent || "";
    return !isBlockedTag(name) && !isBlockedTag(antecedent);
  });
}

export function normalizePostsResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.posts)) return data.posts;
  return [];
}

function isOrderToken(token) {
  return /^[-]?order:/.test(token);
}

function isRatingToken(token) {
  return /^[-]?rating:/.test(token);
}

function isLimitToken(token) {
  return /^[-]?limit:/.test(token);
}

/**
 * Build a tags string for posts.json.
 * Always appends hard exclusions. Drops blocked search terms.
 * If the query would exceed e621's 40-tag limit, user tags are trimmed first.
 */
export function buildSearchQuery({
  userQuery = "",
  rating = "all",
  order = "",
  blacklist = [],
} = {}) {
  const droppedBlocked = [];
  const droppedForLimit = [];
  const seen = new Set();
  const userTokens = [];

  for (const raw of tokenize(userQuery)) {
    const token = raw.trim();
    const name = tagName(token);
    if (!name) continue;
    if (isOrderToken(token) || isLimitToken(token)) continue;
    if (rating && rating !== "all" && isRatingToken(token)) continue;
    if (isBlockedTag(token)) {
      droppedBlocked.push(token);
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    userTokens.push(token);
  }

  const extras = [];
  for (const raw of blacklist || []) {
    const name = tagName(raw);
    if (!name || isBlockedTag(name)) continue;
    const token = `-${name}`;
    if (seen.has(token) || seen.has(name)) continue;
    seen.add(token);
    extras.push(token);
  }

  if (rating && rating !== "all") {
    const token = `rating:${rating}`;
    if (!seen.has(token)) {
      seen.add(token);
      extras.push(token);
    }
  }

  if (order) {
    const token = order.startsWith("order:") ? order : `order:${order}`;
    if (!seen.has(token)) {
      seen.add(token);
      extras.push(token);
    }
  }

  const forced = [];
  for (const token of FORCED_EXCLUSIONS) {
    if (!seen.has(token)) {
      seen.add(token);
      forced.push(token);
    }
  }

  const reserved = extras.length + forced.length;
  const allowedUser = Math.max(0, MAX_SEARCH_TAGS - reserved);
  let keptUser = userTokens;
  if (userTokens.length > allowedUser) {
    droppedForLimit.push(...userTokens.slice(allowedUser));
    keptUser = userTokens.slice(0, allowedUser);
  }

  const tags = [...keptUser, ...extras, ...forced].join(" ");
  let warning = "";
  if (droppedBlocked.length) {
    warning = "Blocked tags were removed from the search.";
  }
  if (droppedForLimit.length) {
    warning = `${warning ? `${warning} ` : ""}Search was trimmed to ${MAX_SEARCH_TAGS} tags so required exclusions still fit.`;
  }

  return {
    tags,
    droppedBlocked,
    droppedForLimit,
    warning,
  };
}


export function nameContainsBlockedTerm(name) {
  const tokens = String(name || "")
    .toLowerCase()
    .replace(/[_\-+]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return tokens.some((token) => BLOCKED_SET.has(token));
}

export function filterPools(pools) {
  if (!Array.isArray(pools)) return [];
  return pools.filter((pool) => pool && !nameContainsBlockedTerm(pool.name));
}

export function applyClientFilters(posts, { rating = "all", blacklist = [] } = {}) {
  let out = filterPosts(posts);
  if (rating && rating !== "all") {
    out = out.filter((post) => post && post.rating === rating);
  }
  const extra = new Set((blacklist || []).map(tagName).filter(Boolean));
  if (extra.size) {
    out = out.filter((post) => !collectTags(post).some((tag) => extra.has(tag)));
  }
  return out;
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
    if (!name || isBlockedTag(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Group a post's tags by category. Blocked tags are omitted.
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
