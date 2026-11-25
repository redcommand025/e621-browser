import { normalizePostsResponse } from "./filter.js";

export const CLIENT_ID = "e621-browser/1.0 (by redcommand025 on github)";
export const API_ORIGIN = "https://e621.net";
export const PAGE_LIMIT = 24;
export const POOL_PAGE_LIMIT = 100;
export const MIN_REQUEST_INTERVAL_MS = 800;

let chain = Promise.resolve();
let lastRequestAt = 0;
let basicAuth = null;

export function normalizeApiKey(value) {
  return String(value || "").replace(/\s+/g, "");
}

export function encodeBasicAuth(username, apiKey) {
  const user = String(username || "").trim();
  const key = normalizeApiKey(apiKey);
  if (!user || !key) {
    const error = new Error("Enter a username and API key to sign in.");
    error.code = "missing";
    throw error;
  }
  const raw = user + ":" + key;
  let binary = "";
  let latin1 = true;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) > 255) {
      latin1 = false;
      break;
    }
    binary += raw.charAt(i);
  }
  try {
    return "Basic " + btoa(latin1 ? binary : unescape(encodeURIComponent(raw)));
  } catch (error) {
    const err = new Error("Could not encode the username or API key.");
    err.code = "encode";
    throw err;
  }
}

export function setBasicAuth(username, apiKey) {
  const user = String(username || "").trim();
  const key = normalizeApiKey(apiKey);
  basicAuth = user && key ? { username: user, apiKey: key } : null;
}

export function clearBasicAuth() {
  basicAuth = null;
}

export function hasBasicAuth() {
  return Boolean(basicAuth && basicAuth.username && basicAuth.apiKey);
}

export function basicAuthUsername() {
  return basicAuth && basicAuth.username ? basicAuth.username : "";
}

function requestHeaders() {
  const headers = { Accept: "application/json" };
  if (hasBasicAuth()) {
    headers.Authorization = encodeBasicAuth(basicAuth.username, basicAuth.apiKey);
  }
  return headers;
}

function isAuthFailureMessage(msg) {
  return /AuthenticationFailure|SessionLoader::/i.test(String(msg || ""));
}

function looksLikeApiAccessDisabled(msg) {
  return /api access/i.test(String(msg || ""));
}

export function buildApiUrl(path, params = {}) {
  const url = new URL(path, API_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("_client", CLIENT_ID);
  return url.toString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function enqueueRequest(task) {
  const run = async () => {
    const delay = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (delay > 0) await wait(delay);
    lastRequestAt = Date.now();
    return task();
  };
  const result = chain.then(run, run);
  chain = result.then(
    () => {},
    () => {}
  );
  return result;
}

/**
 * Build a short, plain-text error. Never returns response HTML or markup.
 */
export function describeApiFailure(status, contentType, bodyText) {
  const type = String(contentType || "").toLowerCase();
  const raw = String(bodyText || "");
  if (type.includes("application/json") && raw) {
    try {
      const body = JSON.parse(raw);
      const msg = body && (body.message || body.reason || body.error);
      if (typeof msg === "string" && msg.trim() && !/[<>]/.test(msg)) {
        if (status === 401 || isAuthFailureMessage(msg)) {
          return "e621 rejected the username or API key.";
        }
        if (status === 403 && looksLikeApiAccessDisabled(msg)) {
          return "API access may be disabled for this account. Enable it in e621 under Account, then Manage API Access.";
        }
        return msg.trim();
      }
    } catch (error) {
      /* ignore invalid JSON */
    }
  }
  if (status === 401) {
    return "e621 rejected the username or API key.";
  }
  if (status === 403) {
    return "e621 denied the request (403). Enable API access in e621 under Account, then Manage API Access, or wait and try again.";
  }
  if (status === 429 || status === 503) {
    return "e621 is rate-limiting requests. Wait a moment and try again.";
  }
  if (status) {
    return `e621 request failed (${status}). Wait a moment and try again.`;
  }
  return "e621 returned an unexpected response. Wait a moment and try again.";
}

async function parseResponse(response) {
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!response.ok || !type.toLowerCase().includes("application/json")) {
    const error = new Error(describeApiFailure(response.status, type, text));
    error.status = response.status;
    throw error;
  }
  try {
    return text ? JSON.parse(text) : [];
  } catch {
    const error = new Error(describeApiFailure(response.status, type, text));
    error.status = response.status;
    throw error;
  }
}

async function fetchWithAuth(url, headers, signal, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  try {
    return await doFetch(url, { signal: signal, headers: headers, mode: "cors" });
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    const err = new Error("Could not reach e621. This may be a network or CORS block.");
    err.code = "network";
    throw err;
  }
}

export function fetchJson(path, params = {}, { signal } = {}) {
  return enqueueRequest(async () => {
    const url = buildApiUrl(path, params);
    const headers = requestHeaders();
    let response = await fetchWithAuth(url, headers, signal);
    if (response.status === 503) {
      await wait(1500);
      lastRequestAt = Date.now();
      response = await fetchWithAuth(url, headers, signal);
    }
    return parseResponse(response);
  });
}

export async function verifyBasicAuth(username, apiKey, { signal, fetchImpl } = {}) {
  const user = String(username || "").trim();
  const key = normalizeApiKey(apiKey);
  const header = encodeBasicAuth(user, key);
  const path = "/users/" + encodeURIComponent(user) + ".json";
  const run = async function () {
    const url = buildApiUrl(path);
    const headers = { Accept: "application/json", Authorization: header };
    const response = await fetchWithAuth(url, headers, signal, fetchImpl);
    if (response.status === 401) {
      const err = new Error("e621 rejected the username or API key.");
      err.status = 401;
      err.code = "rejected";
      throw err;
    }
    if (response.status === 403) {
      const type = response.headers && response.headers.get ? response.headers.get("content-type") : "";
      const text = await response.text();
      const err = new Error(
        looksLikeApiAccessDisabled(text)
          ? "API access may be disabled for this account. Enable it in e621 under Account, then Manage API Access."
          : describeApiFailure(403, type, text)
      );
      err.status = 403;
      err.code = "forbidden";
      throw err;
    }
    return parseResponse(response);
  };
  if (fetchImpl) return run();
  return enqueueRequest(run);
}

export async function fetchPosts({ tags, page = 1, limit = PAGE_LIMIT, signal } = {}) {
  const data = await fetchJson(
    "/posts.json",
    { tags, page: String(page), limit: String(limit), mode: "extended" },
    { signal }
  );
  return normalizePostsResponse(data);
}

export async function fetchPostsByIds(ids, { extraTags = "", signal } = {}) {
  const list = (ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id));
  if (!list.length) return [];
  const tags = [`id:${list.join(",")}`, extraTags].filter(Boolean).join(" ");
  const data = await fetchPosts({
    tags,
    page: 1,
    limit: Math.min(Math.max(list.length, 1), 320),
    signal,
  });
  const byId = new Map(data.map((post) => [post.id, post]));
  return list.map((id) => byId.get(id)).filter(Boolean);
}

export async function fetchPools({
  name = "",
  order = "updated_at",
  page = 1,
  limit = PAGE_LIMIT,
  signal,
} = {}) {
  const params = {
    limit: String(limit),
    page: String(page),
    "search[order]": order || "updated_at",
  };
  if (name) params["search[name_matches]"] = name;
  const data = await fetchJson("/pools.json", params, { signal });
  return Array.isArray(data) ? data : [];
}

export async function fetchPoolById(id, { signal } = {}) {
  const poolId = Number(id);
  if (!Number.isFinite(poolId)) return null;
  const data = await fetchJson(
    "/pools.json",
    { "search[id]": String(poolId), limit: "1" },
    { signal }
  );
  const list = Array.isArray(data) ? data : [];
  for (const pool of list) {
    if (pool && Number(pool.id) === poolId) return pool;
  }
  return list[0] || null;
}

export async function fetchPopular({ scale = "day", date = "", signal } = {}) {
  const params = { scale: scale || "day", mode: "extended" };
  if (date) params.date = date;
  const data = await fetchJson("/popular.json", params, { signal });
  return normalizePostsResponse(data);
}

export async function fetchAutocomplete(term, { signal } = {}) {
  const trimmed = String(term || "").trim();
  // The official autocomplete endpoint rejects queries shorter than 3 characters.
  if (trimmed.length >= 3) {
    try {
      const data = await fetchJson(
        "/tags/autocomplete.json",
        { "search[name_matches]": trimmed },
        { signal }
      );
      if (Array.isArray(data)) return data;
    } catch (error) {
      if (error.status && error.status !== 400) throw error;
    }
  }
  const data = await fetchJson(
    "/tags.json",
    {
      "search[name_matches]": `${trimmed}*`,
      "search[order]": "count",
      limit: "15",
    },
    { signal }
  );
  return Array.isArray(data) ? data : [];
}

export function previewUrl(post) {
  const preview = (post.files && post.files.preview) || post.preview || {};
  return preview.webp || preview.jpg || preview.url || null;
}

export function sampleImageUrl(post) {
  const sample = (post.files && post.files.sample) || post.sample || {};
  return sample.webp || sample.jpg || sample.url || null;
}

export function originalUrl(post) {
  return (
    (post.files && post.files.original && post.files.original.url) ||
    (post.file && post.file.url) ||
    null
  );
}

export function fileExt(post) {
  return String(
    (post.files && post.files.meta && post.files.meta.ext) ||
      (post.file && post.file.ext) ||
      ""
  ).toLowerCase();
}

export function isVideoPost(post) {
  const ext = fileExt(post);
  if (ext === "webm" || ext === "mp4") return true;
  const video = post.files && post.files.video;
  return Boolean(video && (video.has || video.original || video.variants));
}

function mediaTypeForUrl(url, fallback) {
  const clean = String(url || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".mp4")) return "video/mp4";
  if (clean.endsWith(".webm")) return "video/webm";
  return fallback || "";
}

/**
 * Prefer transcoded MP4 (better on Android Chrome), then samples, then original.
 */
export function videoSources(post) {
  const sources = [];
  const seen = new Set();
  const add = (url, label, type) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({
      url,
      label,
      type: type || mediaTypeForUrl(url),
    });
  };

  const video = post.files && post.files.video;
  if (video) {
    if (video.variants && video.variants.mp4 && video.variants.mp4.url) {
      add(video.variants.mp4.url, "MP4", "video/mp4");
    }
    const samples = video.samples || {};
    const sampleKeys = Object.keys(samples).sort((a, b) => {
      const na = parseInt(a, 10) || 0;
      const nb = parseInt(b, 10) || 0;
      return nb - na;
    });
    for (const key of sampleKeys) {
      const sample = samples[key];
      if (sample && sample.url) add(sample.url, key, mediaTypeForUrl(sample.url, "video/mp4"));
    }
    if (video.original && video.original.url) {
      add(
        video.original.url,
        "Original",
        mediaTypeForUrl(video.original.url)
      );
    }
  }
  add(originalUrl(post), "Original", mediaTypeForUrl(originalUrl(post)));
  return sources;
}

export function postPageUrl(post) {
  return `${API_ORIGIN}/posts/${post.id}`;
}

export function formatCount(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

/* ---------- Post viewer extras ---------- */

export const COMMENT_PAGE_LIMIT = 20;

function requireAuth() {
  if (hasBasicAuth()) return;
  const error = new Error("Sign in to do that.");
  error.code = "auth";
  throw error;
}

/**
 * Authenticated write (POST/DELETE). e621 answers CORS preflights for these
 * endpoints with Access-Control-Allow-Origin: * and allows the Authorization
 * header, so a signed-in browser can call them directly.
 */
export function sendJson(method, path, body = {}, { signal } = {}) {
  requireAuth();
  return enqueueRequest(async () => {
    const url = buildApiUrl(path);
    const headers = requestHeaders();
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body || {})) {
      if (value == null || value === "") continue;
      form.set(key, String(value));
    }
    const init = { method, headers, signal, mode: "cors" };
    if (method !== "GET" && method !== "DELETE") {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      init.body = form.toString();
    }
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      const err = new Error("Could not reach e621. This may be a network or CORS block.");
      err.code = "network";
      throw err;
    }
    if (response.status === 204) return null;
    return parseResponse(response);
  });
}

export async function favoritePost(postId) {
  return sendJson("POST", "/favorites.json", { post_id: Number(postId) });
}

export async function unfavoritePost(postId) {
  return sendJson("DELETE", "/favorites/" + Number(postId) + ".json");
}

/** params: { score: "1" | "-1", no_unvote?: "true" } */
export async function votePost(postId, params) {
  return sendJson("POST", "/posts/" + Number(postId) + "/votes.json", params);
}

export async function fetchComments(postId, { page = 1, limit = COMMENT_PAGE_LIMIT, signal } = {}) {
  const data = await fetchJson(
    "/comments.json",
    {
      group_by: "comment",
      "search[post_id]": String(Number(postId)),
      limit: String(limit),
      page: String(page),
    },
    { signal }
  );
  // e621 returns {"comments": []} instead of [] when there are none.
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.comments)) return data.comments;
  return [];
}

export async function fetchNotes(postId, { signal } = {}) {
  const data = await fetchJson(
    "/notes.json",
    { "search[post_id]": String(Number(postId)), "search[is_active]": "true", limit: "100" },
    { signal }
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.notes)) return data.notes;
  return [];
}

/**
 * Tag records (name, post_count, related_tags, category) for a batch of names.
 * search[name] accepts a comma list; search[name_comma] is ignored by e621.
 */
export async function fetchTagsByNames(names, { signal } = {}) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return [];
  const data = await fetchJson(
    "/tags.json",
    { "search[name]": list.join(","), limit: String(Math.min(320, Math.max(list.length, 1))) },
    { signal }
  );
  return Array.isArray(data) ? data : [];
}

/* ---------- Wiki, aliases, and implications ---------- */

/** The wiki page for a tag, or null if it has none. */
export async function fetchWikiPage(title, { signal } = {}) {
  const name = String(title || "").trim().toLowerCase();
  if (!name) return null;
  const data = await fetchJson("/wiki_pages.json", { "search[title]": name, limit: "1" }, { signal });
  const list = Array.isArray(data) ? data : [];
  return list.find((page) => page && String(page.title).toLowerCase() === name) || list[0] || null;
}

function relationName(name) {
  // name_matches treats * as a wildcard; escape it so a literal tag matches.
  return String(name || "").trim().toLowerCase().replace(/\*/g, "\\*");
}

/**
 * Active aliases where the tag is either side. search[name_matches] covers
 * both antecedent and consequent in one request.
 */
export async function fetchTagAliases(name, { signal } = {}) {
  const data = await fetchJson(
    "/tag_aliases.json",
    { "search[name_matches]": relationName(name), "search[status]": "active", limit: "100" },
    { signal }
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchTagImplications(name, { signal } = {}) {
  const data = await fetchJson(
    "/tag_implications.json",
    { "search[name_matches]": relationName(name), "search[status]": "active", limit: "100" },
    { signal }
  );
  return Array.isArray(data) ? data : [];
}
