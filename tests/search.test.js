import test from "node:test";
import assert from "node:assert/strict";
import { METATAGS, metatagInfo, metatagSuggestions, parseSearchToken, singleSearchTag, splitTermPrefix } from "../js/search.js";
import { TAG_CATEGORY_COLORS, TAG_CATEGORY_IDS, contrastRatio, tagCategoryColor, tagCategoryName } from "../js/tagcolors.js";

test("metatag catalog covers e621's cheatsheet", () => {
  for (const name of [
    "order", "type", "rating", "score", "favcount", "date", "user", "fav", "id", "width", "height", "filesize",
    "duration", "status", "source", "description", "pool", "set", "parent", "child", "voted", "md5", "inpool",
    "ischild", "isparent", "randseed", "tagcount", "comment_count", "ratio", "mpixels", "locked", "commenter",
  ]) {
    assert.ok(metatagInfo(name), "missing metatag " + name);
  }
  assert.equal(new Set(METATAGS.map((m) => m.name)).size, METATAGS.length, "no duplicate metatags");
});

test("metatag name suggestions keep working with - and ~ prefixes", () => {
  assert.deepEqual(metatagSuggestions("ord").map((s) => s.value), ["order:"]);
  assert.deepEqual(metatagSuggestions("-ord").map((s) => s.value), ["order:"]);
  assert.ok(metatagSuggestions("ty").some((s) => s.value === "type:"));
  assert.deepEqual(metatagSuggestions("lim"), [], "limit: is not suggested; the app sets the page size");
  assert.deepEqual(metatagSuggestions(""), []);
});

test("metatag value suggestions for enums", () => {
  assert.deepEqual(metatagSuggestions("rating:").map((s) => s.value).slice(0, 3), ["rating:s", "rating:q", "rating:e"]);
  assert.deepEqual(metatagSuggestions("type:w").map((s) => s.value), ["type:webp", "type:webm"]);
  assert.ok(metatagSuggestions("~order:sc").some((s) => s.value === "order:score"));
  assert.deepEqual(metatagSuggestions("status:p").map((s) => s.value), ["status:pending"]);
  assert.deepEqual(metatagSuggestions("score:>"), [], "free-form values get no suggestions");
  assert.deepEqual(metatagSuggestions("type:webm"), [], "a complete value is not suggested again");
});

test("splitTermPrefix and parseSearchToken", () => {
  assert.deepEqual(splitTermPrefix("~fox"), { prefix: "~", body: "fox" });
  assert.deepEqual(splitTermPrefix("-order:sc"), { prefix: "-", body: "order:sc" });
  const t = parseSearchToken("-score:>=10");
  assert.equal(t.prefix, "-");
  assert.equal(t.metatag, "score");
  assert.equal(t.value, ">=10");
  assert.equal(t.known, true);
  assert.equal(parseSearchToken("african_*").wildcard, true);
  assert.equal(parseSearchToken("~(").group, true);
  assert.equal(parseSearchToken("Red_Panda").tag, "red_panda");
});

test("singleSearchTag finds a lone plain tag, ignoring rating and order", () => {
  assert.equal(singleSearchTag("red_panda"), "red_panda");
  assert.equal(singleSearchTag("  red_panda rating:s order:score "), "red_panda");
  assert.equal(singleSearchTag("red_panda fox"), "");
  assert.equal(singleSearchTag("~red_panda"), "");
  assert.equal(singleSearchTag("-red_panda"), "");
  assert.equal(singleSearchTag("red_*"), "");
  assert.equal(singleSearchTag("red_panda type:png"), "");
  assert.equal(singleSearchTag(""), "");
  assert.equal(singleSearchTag("order:score"), "");
});

test("tag category ids and colors", () => {
  assert.equal(tagCategoryName(1), "artist");
  assert.equal(tagCategoryName("5"), "species");
  assert.equal(tagCategoryName("Lore"), "lore");
  assert.equal(tagCategoryName("nope"), "");
  assert.equal(tagCategoryName(null), "");
  assert.equal(tagCategoryColor(0), TAG_CATEGORY_COLORS.general);
  assert.deepEqual(Object.values(TAG_CATEGORY_IDS).sort(), Object.keys(TAG_CATEGORY_COLORS).sort());
  assert.equal(new Set(Object.values(TAG_CATEGORY_COLORS)).size, 9, "each category has its own color");
});

test("tag colors stay readable on the dark theme backgrounds", () => {
  for (const [name, color] of Object.entries(TAG_CATEGORY_COLORS)) {
    for (const bg of ["#1a080c", "#2a0e14", "#050204"]) {
      assert.ok(contrastRatio(color, bg) >= 4.5, `${name} ${color} on ${bg}: ${contrastRatio(color, bg).toFixed(2)}`);
    }
  }
});
