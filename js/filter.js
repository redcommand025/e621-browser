/**
 * Hard exclusion and search-query helpers.
 * Blocked tags cannot be disabled by UI or URL parameters.
 */
export const BLOCKED_TAGS = Object.freeze([""]);
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
