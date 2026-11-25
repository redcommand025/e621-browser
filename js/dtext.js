/**
 * A small, safe DText parser for e621 comments, notes, and descriptions.
 *
 * parseDText() returns a plain tree of nodes; it never produces HTML strings.
 * The app turns the tree into DOM nodes with textContent and vetted hrefs,
 * so user text can never inject markup.
 */

export const DTEXT_ORIGIN = "https://e621.net";

const INLINE_TAGS = new Set(["b", "i", "u", "s", "sup", "sub", "spoiler", "color", "tn"]);
const BLOCK_OPEN = /\[(quote|code|section)(?:,expanded)?(?:=([^\]\n]*))?\]/i;
const MAX_DEPTH = 12;

/** Only http(s) URLs and site-relative e621 paths become links. */
export function safeDTextUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return null;
  if (/^\/(?!\/)/.test(url)) return DTEXT_ORIGIN + url;
  if (/^#/.test(url)) return null;
  if (!/^https?:\/\/[^\s/]+/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function text(value) {
  return { type: "text", text: value };
}

function pushText(out, value) {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += value;
  else out.push(text(value));
}

// Find the matching [/tag] for an [tag] whose content starts at `from`.
function findClose(source, tag, from) {
  const open = new RegExp("\\[" + tag + "(?:[=,][^\\]]*)?\\]", "ig");
  const close = new RegExp("\\[\\/" + tag + "\\]", "ig");
  let depth = 1;
  let pos = from;
  while (pos <= source.length) {
    close.lastIndex = pos;
    const c = close.exec(source);
    if (!c) return null;
    open.lastIndex = pos;
    const o = open.exec(source);
    if (o && o.index < c.index) {
      depth += 1;
      pos = o.index + o[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return { start: c.index, end: c.index + c[0].length };
    pos = c.index + c[0].length;
  }
  return null;
}

function trimTrailingPunctuation(url) {
  let out = url;
  while (/[.,!?;:'")\]]$/.test(out)) {
    if (out.endsWith(")") && (out.match(/\(/g) || []).length >= (out.match(/\)/g) || []).length) break;
    out = out.slice(0, -1);
  }
  return out;
}

const ID_LINKS = {
  post: "/posts/",
  pool: "/pools/",
  comment: "/comments/",
  forum: "/forum_posts/",
  topic: "/forum_topics/",
  set: "/post_sets/",
  user: "/users/",
};

export function parseInline(source, depth = 0) {
  const out = [];
  const src = String(source || "");
  let i = 0;
  let buffer = "";
  const flush = () => {
    pushText(out, buffer);
    buffer = "";
  };
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];

    if (ch === "\n") {
      flush();
      out.push({ type: "br" });
      i += 1;
      continue;
    }

    if (ch === "[" && depth < MAX_DEPTH) {
      // [[wiki page|label]]
      if (rest.startsWith("[[")) {
        const end = rest.indexOf("]]");
        if (end > 2 && !rest.slice(2, end).includes("\n")) {
          const inner = rest.slice(2, end);
          const [page, label] = inner.split("|");
          const name = page.trim();
          if (name) {
            flush();
            out.push({
              type: "link",
              href: DTEXT_ORIGIN + "/wiki_pages/show_or_new?title=" + encodeURIComponent(name.toLowerCase().replace(/\s+/g, "_")),
              children: [text((label != null && label.trim()) || name)],
            });
            i += end + 2;
            continue;
          }
        }
      }
      const m = /^\[([a-z]+)(?:=([^\]\n]*))?\]/i.exec(rest);
      if (m && INLINE_TAGS.has(m[1].toLowerCase())) {
        const tag = m[1].toLowerCase();
        const close = findClose(src, tag, i + m[0].length);
        if (close) {
          flush();
          const inner = src.slice(i + m[0].length, close.start);
          const children = parseInline(inner, depth + 1);
          if (tag === "color" || tag === "tn") {
            out.push({ type: tag === "tn" ? "small" : "span", children });
          } else {
            out.push({ type: tag, children });
          }
          i = close.end;
          continue;
        }
      }
    }

    // {{tag search}}
    if (ch === "{" && rest.startsWith("{{")) {
      const end = rest.indexOf("}}");
      if (end > 2 && !rest.slice(2, end).includes("\n")) {
        const query = rest.slice(2, end).trim();
        if (query) {
          flush();
          out.push({
            type: "link",
            href: DTEXT_ORIGIN + "/posts?tags=" + encodeURIComponent(query),
            children: [text(query)],
          });
          i += end + 2;
          continue;
        }
      }
    }

    // "label":url  or  "label":[url]
    if (ch === '"') {
      const m = /^"([^"\n]+)":(?:\[([^\]\s]+)\]|(https?:\/\/[^\s<>"]+|\/[^\s<>"]*))/i.exec(rest);
      if (m) {
        const raw = m[2] || trimTrailingPunctuation(m[3]);
        const consumed = m[2] ? m[0].length : m[0].length - (m[3].length - raw.length);
        const href = safeDTextUrl(raw);
        flush();
        if (href) out.push({ type: "link", href, children: parseInline(m[1], depth + 1) });
        else pushText(out, m[1]);
        i += consumed;
        continue;
      }
    }

    // bare URLs
    if ((ch === "h" || ch === "H") && /^https?:\/\//i.test(rest)) {
      const prev = i > 0 ? src[i - 1] : "";
      if (!prev || /[\s(\[>]/.test(prev)) {
        const m = /^https?:\/\/[^\s<>"\[\]]+/i.exec(rest);
        const raw = trimTrailingPunctuation(m[0]);
        const href = safeDTextUrl(raw);
        if (href) {
          flush();
          out.push({ type: "link", href, children: [text(raw)] });
          i += raw.length;
          continue;
        }
      }
    }

    // post #123, pool #4, comment #5 ...
    if (/[a-z]/i.test(ch) && (i === 0 || /[\s(\[]/.test(src[i - 1]))) {
      const m = /^(post|pool|comment|forum|topic|set|user) #(\d+)\b/i.exec(rest);
      if (m) {
        flush();
        out.push({
          type: "link",
          href: DTEXT_ORIGIN + ID_LINKS[m[1].toLowerCase()] + m[2],
          children: [text(m[0])],
        });
        i += m[0].length;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

function parseParagraphs(chunk, depth) {
  const blocks = [];
  const paragraphs = chunk.split(/\n{2,}/);
  for (const para of paragraphs) {
    const trimmed = para.replace(/^\n+|\n+$/g, "");
    if (!trimmed.trim()) continue;
    const lines = trimmed.split("\n");
    let pending = [];
    let list = null;
    const flushPending = () => {
      if (pending.length) blocks.push({ type: "p", children: parseInline(pending.join("\n"), depth) });
      pending = [];
    };
    const flushList = () => {
      if (list) blocks.push(list);
      list = null;
    };
    for (const line of lines) {
      const heading = /^h([1-6])\.\s*(.*)$/i.exec(line);
      const item = /^(\*+)\s+(.*)$/.exec(line);
      if (heading) {
        flushPending();
        flushList();
        blocks.push({ type: "heading", level: Number(heading[1]), children: parseInline(heading[2], depth) });
      } else if (item) {
        flushPending();
        if (!list) list = { type: "list", items: [] };
        list.items.push({ level: item[1].length, children: parseInline(item[2], depth) });
      } else {
        flushList();
        pending.push(line);
      }
    }
    flushPending();
    flushList();
  }
  return blocks;
}

export function parseDText(source, depth = 0) {
  let src = String(source == null ? "" : source).replace(/\r\n?/g, "\n");
  const blocks = [];
  while (src.length) {
    const m = depth < MAX_DEPTH ? BLOCK_OPEN.exec(src) : null;
    if (!m) {
      blocks.push(...parseParagraphs(src, depth));
      break;
    }
    const tag = m[1].toLowerCase();
    const close = findClose(src, tag, m.index + m[0].length);
    if (!close) {
      // Unclosed block tag: keep it as text and continue after it.
      const before = src.slice(0, m.index + m[0].length);
      const after = src.slice(m.index + m[0].length);
      const tail = BLOCK_OPEN.exec(after);
      const cut = tail ? m.index + m[0].length + tail.index : src.length;
      blocks.push(...parseParagraphs(src.slice(0, cut), depth));
      src = src.slice(cut);
      if (before === src) break;
      continue;
    }
    if (m.index > 0) blocks.push(...parseParagraphs(src.slice(0, m.index), depth));
    const inner = src.slice(m.index + m[0].length, close.start);
    if (tag === "code") {
      blocks.push({ type: "code", text: inner.replace(/^\n+|\n+$/g, "") });
    } else if (tag === "quote") {
      blocks.push({ type: "quote", children: parseDText(inner, depth + 1) });
    } else {
      blocks.push({
        type: "section",
        title: (m[2] || "").trim(),
        expanded: /,expanded/i.test(m[0]),
        children: parseDText(inner, depth + 1),
      });
    }
    src = src.slice(close.end);
  }
  return blocks;
}

/** Plain text of a parsed tree (used for previews and tests). */
export function dtextPlainText(nodes) {
  let out = "";
  for (const node of nodes || []) {
    if (node.type === "text") out += node.text;
    else if (node.type === "br") out += "\n";
    else if (node.type === "code") out += node.text + "\n";
    else if (node.type === "list") {
      for (const item of node.items) out += dtextPlainText(item.children) + "\n";
    } else if (node.children) {
      out += dtextPlainText(node.children);
      if (["p", "heading", "quote", "section"].includes(node.type)) out += "\n";
    }
  }
  return out;
}
