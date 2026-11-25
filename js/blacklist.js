/**
 * Blacklist lines, e621 style. Each line is one rule: a post is hidden when
 * it matches every tag on the line. Lines can mix plain tags, -tag (must not
 * have), ~tag (needs at least one of the ~ tags), and rating:x / -rating:x.
 * Lines are kept intact; only whitespace and letter case are normalized.
 */

/** One line, trimmed, single-spaced, lowercase. "" for blank or comment lines. */
export function normalizeBlacklistLine(line) {
  const text = String(line ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text || text.startsWith("#")) return "";
  return text;
}

/** Normalize and de-duplicate a list of lines, keeping the first order. */
export function normalizeBlacklistLines(lines) {
  const out = [];
  const seen = new Set();
  for (const raw of lines || []) {
    const line = normalizeBlacklistLine(raw);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/** e621's blacklisted_tags text (newline-separated) to lines. */
export function parseBlacklistText(text) {
  return normalizeBlacklistLines(String(text ?? "").split(/\r?\n/));
}

/** Lines to e621's blacklisted_tags text. */
export function serializeBlacklist(lines) {
  return normalizeBlacklistLines(lines).join("\n");
}

export function sameBlacklist(a, b) {
  const x = normalizeBlacklistLines(a);
  const y = normalizeBlacklistLines(b);
  return x.length === y.length && x.every((line, i) => line === y[i]);
}

/**
 * Three-way merge of the local list and the account list against the last
 * synced list (base). Additions on either side are kept; a line removed on
 * either side since the last sync is removed. With no base (first sync),
 * the result is the union, account lines first.
 */
export function mergeBlacklists({ base = null, local = [], remote = [] } = {}) {
  const L = normalizeBlacklistLines(local);
  const R = normalizeBlacklistLines(remote);
  if (!base) return normalizeBlacklistLines([...R, ...L]);
  const B = new Set(normalizeBlacklistLines(base));
  const localSet = new Set(L);
  const remoteSet = new Set(R);
  const removed = new Set();
  for (const line of B) {
    if (!localSet.has(line) || !remoteSet.has(line)) removed.add(line);
  }
  return normalizeBlacklistLines([...R, ...L]).filter((line) => !removed.has(line));
}

/** Plain single-tag lines, which can also be sent to e621 as -tag. */
export function singleTagLines(lines) {
  return normalizeBlacklistLines(lines).filter(
    (line) => !line.includes(" ") && !/^[-~]/.test(line) && !/^[a-z_]+:/.test(line) && !line.includes("*")
  );
}

/** Plain tags named on a line (no -, ~, or metatags). */
export function blacklistLineTags(line) {
  return normalizeBlacklistLine(line)
    .split(" ")
    .filter((token) => token && !/^[-~]/.test(token) && !/^[a-z_]+:/.test(token));
}

/**
 * Does a post (its tag set and rating letter) match one blacklist line?
 * Unknown metatags on a line make it never match, so nothing is hidden by
 * a rule this app cannot check.
 */
export function blacklistLineMatches(line, tags, rating = "") {
  const tokens = normalizeBlacklistLine(line).split(" ").filter(Boolean);
  if (!tokens.length) return false;
  const has = (tag) => tags.has(tag);
  const r = String(rating || "").toLowerCase().charAt(0);
  let anyOr = false;
  let orHit = false;
  let positives = 0;
  for (const token of tokens) {
    const neg = token.startsWith("-");
    const or = token.startsWith("~");
    const body = token.replace(/^[-~]/, "");
    if (!body) continue;
    const meta = body.match(/^([a-z_]+):(.*)$/);
    let hit;
    if (meta) {
      if (meta[1] !== "rating") return false;
      hit = Boolean(r) && meta[2].charAt(0) === r;
    } else if (body.includes("*")) {
      const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      hit = [...tags].some((tag) => re.test(tag));
    } else {
      hit = has(body);
    }
    if (neg) {
      if (hit) return false;
    } else if (or) {
      anyOr = true;
      if (hit) orHit = true;
    } else {
      positives += 1;
      if (!hit) return false;
    }
  }
  if (anyOr && !orHit) return false;
  return positives > 0 || anyOr;
}
