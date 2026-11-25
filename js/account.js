/** Pure helpers for downloads, ratings, and the account/profile page. */

export const RATINGS = Object.freeze(["s", "q", "e"]);
export const RATING_NAMES = Object.freeze({ s: "Safe", q: "Questionable", e: "Explicit" });

/** Accepts "all", "s", ["s","e"], "s,e", … and returns the allowed letters in s,q,e order. */
export function normalizeRatings(value) {
  let list;
  if (value == null || value === "" || value === "all") list = RATINGS;
  else if (Array.isArray(value)) list = value;
  else list = String(value).split(/[\s,]+/);
  const letters = new Set(list.map((item) => String(item || "").trim().toLowerCase().charAt(0)));
  const out = RATINGS.filter((r) => letters.has(r));
  return out.length ? out : RATINGS.slice();
}

/** All three (or none) → "", one → rating:x, two → -rating:<the other one>. */
export function ratingQueryToken(value) {
  const list = normalizeRatings(value);
  if (list.length === RATINGS.length) return "";
  if (list.length === 1) return "rating:" + list[0];
  const missing = RATINGS.find((r) => !list.includes(r));
  return "-rating:" + missing;
}

const SKIP_ARTISTS = new Set([
  "conditional_dnp",
  "sound_warning",
  "unknown_artist",
  "unknown_artist_signature",
  "anonymous_artist",
  "avoid_posting",
  "epilepsy_warning",
  "third-party_edit",
  "jumpscare_warning",
]);

function cleanPart(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A readable file name: "artist - 12345 - tag1 tag2 tag3.ext".
 * Uses the first real artist (or "unknown artist") and up to `tagCount`
 * character, species, or general tags. Never longer than maxLength.
 */
export function downloadFilename(post, { tagCount = 3, maxLength = 120 } = {}) {
  const tags = (post && post.tags) || {};
  const artists = (tags.artist || []).map((t) => String(t).toLowerCase()).filter((t) => !SKIP_ARTISTS.has(t));
  const artist = cleanPart(artists.slice(0, 2).join(", ")) || "unknown artist";
  const picks = [];
  for (const group of ["character", "species", "general"]) {
    for (const tag of tags[group] || []) {
      if (picks.length >= tagCount) break;
      const part = cleanPart(tag);
      if (part && !picks.includes(part)) picks.push(part);
    }
  }
  const files = (post && post.files) || {};
  const meta = files.meta || {};
  const url = (files.original && files.original.url) || (post && post.file && post.file.url) || "";
  let ext = String(meta.ext || (post && post.file && post.file.ext) || "").toLowerCase();
  if (!ext) {
    const m = url.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
    ext = m ? m[1].toLowerCase() : "bin";
  }
  const id = Number(post && post.id) || 0;
  let base = [artist, String(id), picks.join(" ")].filter(Boolean).join(" - ");
  const room = Math.max(10, maxLength - ext.length - 1);
  if (base.length > room) base = base.slice(0, room).trim();
  return base + "." + ext;
}

const STAT_FIELDS = [
  ["post_upload_count", "Uploads", (n) => "user:" + n],
  ["favorite_count", "Favorites", (n) => "fav:" + n],
  ["comment_count", "Comments", null],
  ["forum_post_count", "Forum posts", null],
  ["note_update_count", "Note edits", null],
  ["post_update_count", "Post changes", null],
  ["wiki_page_version_count", "Wiki edits", null],
  ["artist_version_count", "Artist edits", null],
  ["pool_version_count", "Pool edits", null],
  ["flag_count", "Flags", null],
  ["upload_limit", "Upload limit", null],
];

/** Stats rows for a user record: [{ key, label, value, search }]. Missing fields are skipped. */
export function profileStats(user) {
  if (!user) return [];
  const name = String(user.name || "");
  const out = [];
  for (const [key, label, search] of STAT_FIELDS) {
    if (user[key] == null || user[key] === "") continue;
    const value = Number(user[key]);
    if (!Number.isFinite(value)) continue;
    out.push({ key, label, value, search: search && name ? search(name) : "" });
  }
  const pos = Number(user.positive_feedback_count);
  const neu = Number(user.neutral_feedback_count);
  const neg = Number(user.negative_feedback_count);
  if ([pos, neu, neg].some(Number.isFinite)) {
    out.push({ key: "feedback", label: "Feedback", value: `${pos || 0} / ${neu || 0} / ${neg || 0}`, search: "" });
  }
  return out;
}

/** Searches for the profile page's sections. Votes only for your own account (e621 hides others'). */
export function profileSearches(name, { own = false } = {}) {
  const n = String(name || "").trim();
  if (!n) return [];
  const list = [
    { key: "uploads", label: "Uploads", query: "user:" + n },
    { key: "favorites", label: "Favorites", query: "fav:" + n },
  ];
  if (own) {
    list.push({ key: "upvoted", label: "Upvoted", query: "votedup:" + n });
    list.push({ key: "downvoted", label: "Downvoted", query: "voteddown:" + n });
  }
  return list;
}
