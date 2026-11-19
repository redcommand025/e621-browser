import { normalizePostsResponse } from "./filter.js";

export const CLIENT_ID = "e621-browser/1.0 (by redcommand025 on github)";
export const API_ORIGIN = "https://e621.net";
export const PAGE_LIMIT = 24;
export const MIN_REQUEST_INTERVAL_MS = 800;

let chain = Promise.resolve();
let lastRequestAt = 0;

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

async function readJson(response) {
  const data = await response.json();
  return data;
}

export function fetchJson(path, params = {}, { signal } = {}) {
  return enqueueRequest(async () => {
    const url = buildApiUrl(path, params);
    let response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (response.status === 503) {
      await wait(1500);
      lastRequestAt = Date.now();
      response = await fetch(url, {
        signal,
        headers: { Accept: "application/json" },
      });
    }
    if (!response.ok) {
      let message = `e621 request failed (${response.status})`;
      try {
        const body = await response.json();
        message = body.message || body.reason || message;
      } catch {
        /* ignore parse errors */
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return readJson(response);
  });
}

export async function fetchPosts({ tags, page = 1, limit = PAGE_LIMIT, signal } = {}) {
  const data = await fetchJson(
    "/posts.json",
    { tags, page: String(page), limit: String(limit) },
    { signal }
  );
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
