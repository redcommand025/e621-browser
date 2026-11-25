/**
 * e621 search syntax helpers: the metatag catalog (from e621's cheatsheet),
 * autocomplete for metatag names and values, and query inspection.
 * Pure functions only; no DOM or network.
 */
import { tagName, tokenize, tokenMetatag } from "./filter.js";

const BOOL = ["true", "false"];

const ORDER_VALUES = [
  "id", "id_asc", "score", "score_asc", "favcount", "favcount_asc", "random", "hot",
  "created", "created_asc", "updated", "updated_asc", "comment_count", "comment_count_asc",
  "comment_bumped", "comment_bumped_asc", "note", "note_asc", "mpixels", "mpixels_asc",
  "filesize", "filesize_asc", "duration", "duration_asc", "tagcount", "tagcount_asc",
  "ratio", "ratio_asc", "landscape", "portrait", "change", "change_asc", "md5", "md5_asc",
  "artist_tags", "character_tags", "species_tags", "general_tags", "copyright_tags",
  "contributor_tags", "meta_tags", "lore_tags", "invalid_tags",
];

/** Every metatag in e621's cheatsheet, grouped for the help popover. */
export const METATAGS = Object.freeze([
  { name: "order", group: "Sorting", hint: "Sort results", example: "order:score", values: ORDER_VALUES },
  { name: "randseed", group: "Sorting", hint: "Repeatable random order", example: "randseed:123" },
  { name: "rating", group: "Rating and type", hint: "s, q, or e", example: "rating:s", values: ["s", "q", "e", "safe", "questionable", "explicit"] },
  { name: "type", group: "Rating and type", hint: "File type", example: "type:webm", values: ["jpg", "png", "gif", "webp", "mp4", "webm", "swf"] },
  { name: "status", group: "Status", hint: "Post status", example: "status:pending", values: ["pending", "active", "deleted", "flagged", "modqueue", "any", "all"] },
  { name: "user", group: "Users", hint: "Uploaded by", example: "user:name" },
  { name: "user_id", group: "Users", hint: "Uploaded by user ID", example: "user_id:17633" },
  { name: "fav", group: "Users", hint: "Favorited by", example: "fav:name" },
  { name: "favoritedby", group: "Users", hint: "Favorited by", example: "favoritedby:name" },
  { name: "voted", group: "Users", hint: "You voted on (signed in)", example: "voted:me" },
  { name: "votedup", group: "Users", hint: "You upvoted (signed in)", example: "votedup:me" },
  { name: "voteddown", group: "Users", hint: "You downvoted (signed in)", example: "voteddown:me" },
  { name: "upvote", group: "Users", hint: "Same as votedup", example: "upvote:me" },
  { name: "downvote", group: "Users", hint: "Same as voteddown", example: "downvote:me" },
  { name: "approver", group: "Users", hint: "Approved by", example: "approver:name" },
  { name: "deletedby", group: "Users", hint: "Deleted by", example: "deletedby:name" },
  { name: "commenter", group: "Users", hint: "Commented on by", example: "commenter:name" },
  { name: "comm", group: "Users", hint: "Same as commenter", example: "comm:name" },
  { name: "noter", group: "Users", hint: "Notes written by", example: "noter:name" },
  { name: "noteupdater", group: "Users", hint: "Notes updated by", example: "noteupdater:name" },
  { name: "id", group: "Counts and ranges", hint: "Post ID, list, or range", example: "id:100..200" },
  { name: "score", group: "Counts and ranges", hint: "Score (range ok)", example: "score:>=100" },
  { name: "favcount", group: "Counts and ranges", hint: "Favorite count", example: "favcount:>50" },
  { name: "comment_count", group: "Counts and ranges", hint: "Comment count", example: "comment_count:>10" },
  { name: "tagcount", group: "Counts and ranges", hint: "Number of tags", example: "tagcount:<20" },
  { name: "gentags", group: "Counts and ranges", hint: "General tag count", example: "gentags:<10" },
  { name: "arttags", group: "Counts and ranges", hint: "Artist tag count", example: "arttags:2" },
  { name: "conttags", group: "Counts and ranges", hint: "Contributor tag count", example: "conttags:1" },
  { name: "copytags", group: "Counts and ranges", hint: "Copyright tag count", example: "copytags:1" },
  { name: "chartags", group: "Counts and ranges", hint: "Character tag count", example: "chartags:2" },
  { name: "spectags", group: "Counts and ranges", hint: "Species tag count", example: "spectags:1" },
  { name: "invtags", group: "Counts and ranges", hint: "Invalid tag count", example: "invtags:0" },
  { name: "metatags", group: "Counts and ranges", hint: "Meta tag count", example: "metatags:2" },
  { name: "lortags", group: "Counts and ranges", hint: "Lore tag count", example: "lortags:1" },
  { name: "width", group: "Size", hint: "Width in pixels", example: "width:>=1920" },
  { name: "height", group: "Size", hint: "Height in pixels", example: "height:>=1080" },
  { name: "mpixels", group: "Size", hint: "Megapixels", example: "mpixels:>4" },
  { name: "ratio", group: "Size", hint: "Aspect ratio", example: "ratio:16:9" },
  { name: "filesize", group: "Size", hint: "File size", example: "filesize:1MB..5MB" },
  { name: "duration", group: "Size", hint: "Video seconds", example: "duration:>60" },
  { name: "date", group: "Dates", hint: "Upload date or period", example: "date:week", values: ["today", "yesterday", "day", "week", "month", "year", "decade", "yesterweek", "yestermonth", "yesteryear"] },
  { name: "source", group: "Text", hint: "Source contains", example: "source:*twitter.com" },
  { name: "description", group: "Text", hint: "Description contains", example: 'description:"hello there"' },
  { name: "note", group: "Text", hint: "Note text contains", example: "note:hello" },
  { name: "delreason", group: "Text", hint: "Deletion reason", example: "delreason:*dnp" },
  { name: "md5", group: "Other", hint: "File MD5", example: "md5:02dd0178…" },
  { name: "pool", group: "Other", hint: "In pool (ID or name)", example: "pool:4" },
  { name: "set", group: "Other", hint: "In set (ID or short name)", example: "set:17" },
  { name: "inpool", group: "Other", hint: "In any pool", example: "inpool:true", values: BOOL },
  { name: "parent", group: "Parents and children", hint: "Parent ID, none, or any", example: "parent:none", values: ["none", "any"] },
  { name: "child", group: "Parents and children", hint: "none or any", example: "child:any", values: ["none", "any"] },
  { name: "ischild", group: "Parents and children", hint: "Is a child", example: "ischild:true", values: BOOL },
  { name: "isparent", group: "Parents and children", hint: "Is a parent", example: "isparent:true", values: BOOL },
  { name: "hasparent", group: "Parents and children", hint: "Same as ischild", example: "hasparent:true", values: BOOL },
  { name: "haschildren", group: "Parents and children", hint: "Same as isparent", example: "haschildren:true", values: BOOL },
  { name: "hassource", group: "Other", hint: "Has a source", example: "hassource:false", values: BOOL },
  { name: "hasdescription", group: "Other", hint: "Has a description", example: "hasdescription:true", values: BOOL },
  { name: "pending_replacements", group: "Other", hint: "Has pending replacements", example: "pending_replacements:true", values: BOOL },
  { name: "artverified", group: "Other", hint: "Uploaded by a verified artist", example: "artverified:true", values: BOOL },
  { name: "ratinglocked", group: "Locks", hint: "Rating locked", example: "ratinglocked:true", values: BOOL },
  { name: "notelocked", group: "Locks", hint: "Notes locked", example: "notelocked:true", values: BOOL },
  { name: "statuslocked", group: "Locks", hint: "Status locked", example: "statuslocked:true", values: BOOL },
  { name: "locked", group: "Locks", hint: "rating, note, or status", example: "locked:rating", values: ["rating", "note", "notes", "status"] },
  { name: "limit", group: "Sorting", hint: "Posts per page (this app sets its own)", example: "limit:50" },
]);

const BY_NAME = new Map(METATAGS.map((m) => [m.name, m]));

export function metatagInfo(name) {
  return BY_NAME.get(String(name || "").toLowerCase()) || null;
}

/** Split an autocomplete term into its prefix (-, ~, or none) and body. */
export function splitTermPrefix(term) {
  const m = /^([-~]?)(.*)$/s.exec(String(term || ""));
  return { prefix: m[1], body: m[2] };
}

/**
 * Local suggestions for metatags.
 * "ord" -> [{ value: "order:", label: "order:", hint, kind: "metatag" }]
 * "order:sc" -> [{ value: "order:score", ... kind: "metavalue" }]
 */
export function metatagSuggestions(term, { limit = 8 } = {}) {
  const { body } = splitTermPrefix(term);
  const lower = body.toLowerCase();
  if (!lower) return [];
  const colon = lower.indexOf(":");
  if (colon === -1) {
    return METATAGS.filter((m) => m.name.startsWith(lower) && m.name !== "limit")
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((m) => ({ value: m.name + ":", label: m.name + ":", hint: m.hint, kind: "metatag" }));
  }
  const info = metatagInfo(lower.slice(0, colon));
  if (!info || !info.values) return [];
  const partial = lower.slice(colon + 1);
  return info.values
    .filter((v) => v.startsWith(partial) && v !== partial)
    .slice(0, limit)
    .map((v) => ({ value: info.name + ":" + v, label: info.name + ":" + v, hint: info.hint, kind: "metavalue" }));
}

/** Describe one search token. */
export function parseSearchToken(token) {
  const raw = String(token || "");
  const { prefix, body } = splitTermPrefix(raw);
  const metatag = tokenMetatag(raw);
  const group = body === "(" || raw === ")";
  return {
    raw,
    prefix,
    body,
    group,
    metatag,
    known: Boolean(metatag && metatagInfo(metatag)),
    value: metatag ? body.slice(metatag.length + 1) : "",
    wildcard: !metatag && body.includes("*"),
    tag: !metatag && !group ? tagName(body) : "",
  };
}

/**
 * The single plain tag a search is about, or "".
 * rating: and order: (which the app's own selects also set) are ignored.
 */
export function singleSearchTag(query, { ignore = ["rating", "order"] } = {}) {
  const skip = new Set(ignore);
  let found = "";
  for (const token of tokenize(query)) {
    const info = parseSearchToken(token);
    if (info.metatag && skip.has(info.metatag)) continue;
    if (info.group || info.metatag || info.prefix || info.wildcard || !info.tag) return "";
    if (found && found !== info.tag) return "";
    found = info.tag;
  }
  return found;
}

/** Rows for the in-app search help popover. */
export const SEARCH_SYNTAX_HELP = Object.freeze([
  { example: "cat dog", text: "Posts with both tags (up to 40 tags and metatags)" },
  { example: "~cat ~dog", text: "Posts with either tag" },
  { example: "-chicken", text: "Leave out posts with a tag" },
  { example: "african_*", text: "Wildcard: any tag starting with african_ (one per search)" },
  { example: "( ~cat ~tiger ) ( ~dog ~wolf )", text: "Groups. Put spaces inside the parentheses" },
  { example: "order:score", text: "Sort; add _asc to reverse, or -order:score" },
  { example: "score:>=100 favcount:10..50", text: "Ranges: >, >=, <, <=, and a..b" },
  { example: 'description:"two words"', text: "Quote values that contain spaces" },
]);
