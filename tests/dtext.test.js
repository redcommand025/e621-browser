import test from "node:test";
import assert from "node:assert/strict";
import { dtextPlainText, parseDText, parseInline, safeDTextUrl } from "../js/dtext.js";

function find(nodes, type) {
  for (const node of nodes || []) {
    if (node.type === type) return node;
    const inner = find(node.children || (node.items || []).flatMap((i) => i.children), type);
    if (inner) return inner;
  }
  return null;
}

test("safeDTextUrl keeps http(s) and e621 paths, drops everything else", () => {
  assert.equal(safeDTextUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeDTextUrl("/posts/12"), "https://e621.net/posts/12");
  assert.equal(safeDTextUrl("javascript:alert(1)"), null);
  assert.equal(safeDTextUrl("data:text/html,hi"), null);
  assert.equal(safeDTextUrl("//evil.example/x"), null);
  assert.equal(safeDTextUrl(""), null);
});

test("basic inline formatting nests", () => {
  const nodes = parseInline("a [b]bold [i]both[/i][/b] [s]x[/s] [spoiler]hid[/spoiler]");
  assert.equal(nodes[1].type, "b");
  assert.equal(nodes[1].children[1].type, "i");
  assert.ok(find(nodes, "s"));
  assert.ok(find(nodes, "spoiler"));
  assert.equal(dtextPlainText(nodes), "a bold both x hid");
});

test("raw HTML stays as text and unclosed tags are literal", () => {
  const nodes = parseDText('<img src=x onerror=alert(1)> [b]open');
  assert.equal(dtextPlainText(nodes).trim(), "<img src=x onerror=alert(1)> [b]open");
  assert.equal(find(nodes, "b"), null);
});

test("links: labeled, bare, wiki, tag search, and post ids", () => {
  const nodes = parseInline('"site":https://x.com/a. see https://e621.net/posts/1, [[Some Page|wiki]] {{canine solo}} post #12');
  const links = nodes.filter((n) => n.type === "link");
  assert.deepEqual(
    links.map((l) => l.href),
    [
      "https://x.com/a",
      "https://e621.net/posts/1",
      "https://e621.net/wiki_pages/show_or_new?title=some_page",
      "https://e621.net/posts?tags=canine%20solo",
      "https://e621.net/posts/12",
    ]
  );
  assert.equal(dtextPlainText(nodes), "site. see https://e621.net/posts/1, wiki canine solo post #12");
});

test("unsafe labeled links render only their label", () => {
  const nodes = parseInline('"click":javascript:alert(1)');
  assert.equal(find(nodes, "link"), null);
});

test("blocks: quotes, code, sections, headings, lists, paragraphs", () => {
  const blocks = parseDText(
    "[quote]Someone said:\nhi[/quote]\nreply\n\nh2. Title\n* one\n* two\n[code][b]raw[/b][/code][section=More]inside[/section]"
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["quote", "p", "heading", "list", "code", "section"]
  );
  assert.equal(blocks[0].children[0].children[1].type, "br");
  assert.equal(blocks[3].items.length, 2);
  assert.equal(blocks[4].text, "[b]raw[/b]");
  assert.equal(blocks[5].title, "More");
});

test("windows line breaks and empty input are handled", () => {
  assert.deepEqual(parseDText(""), []);
  assert.deepEqual(parseDText(null), []);
  const blocks = parseDText("a\r\n\r\nb");
  assert.equal(blocks.length, 2);
});

import { dtextExcerpt, dtextWikiTitles } from "../js/dtext.js";

test("wiki excerpt keeps the first paragraphs and marks truncation", () => {
  const body = "First [b]para[/b].\n\nSecond para.\n\n[section=Hidden]x[/section]\n\nThird.\n\nFourth.";
  const one = dtextExcerpt(body, { maxBlocks: 2 });
  assert.equal(one.nodes.length, 2);
  assert.equal(one.truncated, true);
  assert.equal(dtextPlainText(one.nodes), "First para.\nSecond para.\n");
  const short = dtextExcerpt("Only one.");
  assert.equal(short.truncated, false);
  const long = dtextExcerpt("word ".repeat(200), { maxChars: 40 });
  assert.ok(dtextPlainText(long.nodes).length <= 42);
  assert.ok(dtextPlainText(long.nodes).trim().endsWith("…"));
  assert.equal(long.truncated, true);
});

test("wiki links carry their title; anchors stay text", () => {
  const tree = parseDText("[[#Top|top]] see [[Red Panda|rp]], [[mammal]] and {{fox solo}} [[mammal]]");
  assert.deepEqual(dtextWikiTitles(tree), ["red_panda", "mammal"]);
  assert.equal(dtextPlainText(tree).startsWith("top see rp"), true);
  const search = tree[0].children.find((n) => n.search);
  assert.equal(search.search, "fox solo");
});
