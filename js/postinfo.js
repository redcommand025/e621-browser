/**
 * Pure helpers for the post viewer extras: details, notes, votes,
 * favorites, related tags, and tag counts. No DOM access here.
 * Handles both e621 post shapes (classic `file`/`score` and the newer
 * `files`/`stats`/`has`).
 */
import { safeDTextUrl } from "./dtext.js";
import { tagName, tokenize } from "./filter.js";

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function postFileInfo(post) {
  const p = post || {};
  const files = p.files || {};
  const meta = files.meta || {};
  const original = files.original || {};
  const file = p.file || {};
  return {
    ext: String(meta.ext || file.ext || "").toLowerCase(),
    width: num(original.width ?? file.width ?? p.image_width),
    height: num(original.height ?? file.height ?? p.image_height),
    size: num(meta.size ?? file.size ?? p.file_size),
    md5: String(meta.md5 || file.md5 || p.md5 || ""),
    duration: num(meta.duration ?? p.duration),
  };
}

export function formatFileSize(bytes) {
  if (bytes == null || bytes === "") return "";
  const n = num(bytes);
  if (n == null || n < 0) return "";
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (value >= 100 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, "") + " " + units[unit];
}

export function ratingName(rating) {
  if (rating === "s") return "Safe";
  if (rating === "q") return "Questionable";
  if (rating === "e") return "Explicit";
  return "Unknown";
}

function sourceLabel(href) {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "");
    const tail = (url.pathname + url.search).replace(/\/$/, "");
    const short = tail.length > 28 ? tail.slice(0, 27) + "…" : tail;
    return host + short;
  } catch {
    return href;
  }
}

/** Source strings become safe links; anything that is not http(s) stays plain text. */
export function postSources(post) {
  const raw = (post && post.sources) || [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/\n+/);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    // e621 marks removed sources with a leading "-".
    const cleaned = value.replace(/^-/, "");
    const href = /^https?:\/\//i.test(cleaned) ? safeDTextUrl(cleaned) : null;
    out.push({ text: href ? sourceLabel(href) : value, href, full: value, removed: value.startsWith("-") });
  }
  return out;
}

export function postArtists(post) {
  const tags = post && post.tags;
  const list = tags && !Array.isArray(tags) && Array.isArray(tags.artist) ? tags.artist : [];
  return list.map(tagName).filter(Boolean);
}

export function postDetails(post) {
  const p = post || {};
  const file = postFileInfo(p);
  return {
    id: num(p.id),
    rating: p.rating || "",
    ratingName: ratingName(p.rating),
    artists: postArtists(p),
    uploaderName: String(p.uploader_name || ""),
    uploaderId: num(p.uploader_id),
    createdAt: p.created_at || "",
    ext: file.ext,
    width: file.width,
    height: file.height,
    size: file.size,
    sizeText: formatFileSize(file.size),
    md5: file.md5,
    duration: file.duration,
    sources: postSources(p),
    description: String(p.description || ""),
  };
}

export function formatPostDate(iso, locale) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  try {
    return date.toLocaleString(locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

/* ---------- Notes ---------- */

export function postHasNotes(post) {
  if (!post) return false;
  if (post.has && typeof post.has === "object" && "notes" in post.has) return Boolean(post.has.notes);
  if ("has_notes" in post) return Boolean(post.has_notes);
  return Boolean(post.last_noted_at);
}

export function activeNotes(notes) {
  return (Array.isArray(notes) ? notes : []).filter(
    (note) => note && note.is_active !== false && Number(note.width) > 0 && Number(note.height) > 0
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert a note's original-pixel box into percentages of the image.
 * Percentages keep the box aligned at any displayed size or zoom level,
 * because the layer that holds the boxes gets the same transform as the image.
 */
export function noteBoxPercent(note, imageWidth, imageHeight) {
  const w = Number(imageWidth);
  const h = Number(imageHeight);
  if (!(w > 0) || !(h > 0) || !note) return null;
  const x = clamp(Number(note.x) || 0, 0, w);
  const y = clamp(Number(note.y) || 0, 0, h);
  const bw = clamp(Number(note.width) || 0, 0, w - x);
  const bh = clamp(Number(note.height) || 0, 0, h - y);
  if (!(bw > 0) || !(bh > 0)) return null;
  return {
    left: (x / w) * 100,
    top: (y / h) * 100,
    width: (bw / w) * 100,
    height: (bh / h) * 100,
  };
}

/**
 * Where a note box lands on screen for a displayed image at (left, top) with
 * size (dispW, dispH) under the viewer's translate(x, y) scale(s) transform.
 * Used by the touch test to check alignment.
 */
export function noteScreenRect(note, imageWidth, imageHeight, display, zoom = { x: 0, y: 0, scale: 1 }) {
  const pct = noteBoxPercent(note, imageWidth, imageHeight);
  if (!pct) return null;
  const s = zoom.scale || 1;
  return {
    left: display.left + zoom.x + (pct.left / 100) * display.width * s,
    top: display.top + zoom.y + (pct.top / 100) * display.height * s,
    width: (pct.width / 100) * display.width * s,
    height: (pct.height / 100) * display.height * s,
  };
}

/* ---------- Favorites and votes ---------- */

export function postIsFavorited(post) {
  if (!post) return false;
  if (post.stats && "is_favorited" in post.stats) return Boolean(post.stats.is_favorited);
  return Boolean(post.is_favorited);
}

export function postUserVote(post) {
  if (!post) return 0;
  const raw = post.stats && "vote" in post.stats ? post.stats.vote : post.vote ?? post.own_vote;
  const n = Number(raw) || 0;
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Update a post object in place after a favorite change. */
export function applyFavoriteChange(post, favorited, favCount) {
  if (!post) return post;
  const current = post.stats && post.stats.fav_count != null ? Number(post.stats.fav_count) : Number(post.fav_count) || 0;
  const was = postIsFavorited(post);
  let next = favCount != null && Number.isFinite(Number(favCount)) ? Number(favCount) : current;
  if (favCount == null && was !== favorited) next = Math.max(0, current + (favorited ? 1 : -1));
  if (post.stats && typeof post.stats === "object") {
    post.stats.fav_count = next;
    post.stats.is_favorited = favorited;
  } else {
    post.fav_count = next;
    post.is_favorited = favorited;
  }
  return post;
}

/** Apply a /posts/{id}/votes.json response ({score, up, down, our_score}). */
export function applyVoteResult(post, result) {
  if (!post || !result) return post;
  const up = num(result.up, 0);
  const down = num(result.down, 0);
  const total = num(result.score, up + down);
  const ours = num(result.our_score, 0);
  const vote = ours > 0 ? 1 : ours < 0 ? -1 : 0;
  if (post.stats && typeof post.stats === "object") {
    post.stats.score = { up, down, total };
    post.stats.vote = vote;
  } else if (post.score && typeof post.score === "object") {
    post.score = { up, down, total };
    post.vote = vote;
  } else {
    post.score = total;
    post.vote = vote;
  }
  return post;
}

/** Vote request parameters: voting the same way again removes the vote. */
export function voteRequestParams(currentVote, clicked) {
  const score = clicked > 0 ? 1 : -1;
  if (currentVote === score) return { score: String(score) };
  return { score: String(score), no_unvote: "true" };
}

/* ---------- Tags ---------- */

/** Positive, plain tags from a search (no metatags, exclusions, wildcards, or groups). */
export function searchTagNames(query) {
  const out = [];
  for (const raw of tokenize(query)) {
    const token = raw.trim().toLowerCase();
    if (!token || token.startsWith("-") || token.includes(":") || token.includes("*") || /[()]/.test(token)) continue;
    const name = token.replace(/^~/, "");
    if (!name || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

/** Parse a tags.json `related_tags` string: "name weight name weight ...". */
export function parseRelatedTagString(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const weight = Number(parts[i + 1]);
    if (!Number.isFinite(weight)) continue;
    out.push({ name: tagName(parts[i]), weight });
  }
  return out;
}

/**
 * Merge related tags of several tag records. Tags related to every search tag
 * rank first; already-searched and blacklisted tags are dropped.
 */
export function mergeRelatedTags(records, { exclude = [], limit = 30 } = {}) {
  const skip = new Set(exclude.map(tagName));
  const totals = new Map();
  const list = (records || []).filter((r) => r && r.related_tags);
  for (const record of list) {
    const self = tagName(record.name);
    for (const { name, weight } of parseRelatedTagString(record.related_tags)) {
      if (!name || name === self || skip.has(name)) continue;
      const entry = totals.get(name) || { name, weight: 0, hits: 0 };
      entry.weight += weight;
      entry.hits += 1;
      totals.set(name, entry);
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.hits - a.hits || b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Count tags across loaded posts (like e621's sidebar on a search page). */
export function aggregatePageTags(posts, { exclude = [], limit = 30 } = {}) {
  const skip = new Set(exclude.map(tagName));
  const counts = new Map();
  for (const post of posts || []) {
    const tags = post && post.tags;
    if (!tags) continue;
    const names = new Set();
    const lists = Array.isArray(tags) ? [tags] : Object.values(tags);
    for (const value of lists) {
      const arr = Array.isArray(value) ? value : tokenize(value);
      for (const tag of arr) names.add(tagName(tag));
    }
    for (const name of names) {
      if (!name || skip.has(name)) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Split tag names into batches for tags.json?search[name]=a,b,c. */
export function tagNameBatches(names, size = 100) {
  const unique = [];
  const seen = new Set();
  for (const raw of names || []) {
    const name = tagName(raw);
    if (!name || name.includes(",") || seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  const batches = [];
  for (let i = 0; i < unique.length; i += size) batches.push(unique.slice(i, i + size));
  return batches;
}

/**
 * Sort alias and implication records into what matters for one tag:
 * aliasOf (this tag redirects to), aliases (other names for it),
 * implies (tags it adds), impliedBy (tags that add it).
 */
export function tagRelations(name, aliases = [], implications = []) {
  const tag = tagName(name);
  const pick = (list, side, other) =>
    [...new Set((list || [])
      .filter((r) => r && r.status !== "deleted" && r.status !== "retired" && tagName(r[side]) === tag)
      .map((r) => tagName(r[other]))
      .filter((n) => n && n !== tag))].sort();
  const aliasOf = pick(aliases, "antecedent_name", "consequent_name")[0] || "";
  return {
    aliasOf,
    aliases: pick(aliases, "consequent_name", "antecedent_name"),
    implies: pick(implications, "antecedent_name", "consequent_name"),
    impliedBy: pick(implications, "consequent_name", "antecedent_name"),
  };
}
