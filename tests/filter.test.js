import test from "node:test";
import assert from "node:assert/strict";
import { applyClientFilters, buildSearchQuery, fitTagLimit, MAX_SEARCH_TAGS, queryHasMetatag, tagName, tokenMetatag, tokenize } from "../js/filter.js";
import * as filter from "../js/filter.js";

test("the old hard-blocked tag list is gone", () => {
  assert.equal("BLOCKED_TAGS" in filter, false);
  assert.equal("FORCED_EXCLUSIONS" in filter, false);
  assert.equal("isBlockedTag" in filter, false);
  const built = buildSearchQuery({ userQuery: "canine fox", rating: "s" });
  assert.equal(built.tags, "canine fox rating:s");
});

test("tokenize keeps quoted metatag values and groups", () => {
  assert.deepEqual(tokenize('fox description:"hello there" ( ~a ~b ) -order:score'), [
    "fox",
    'description:"hello there"',
    "(",
    "~a",
    "~b",
    ")",
    "-order:score",
  ]);
  assert.deepEqual(tokenize(""), []);
});

test("tagName strips - and ~ prefixes; tokenMetatag reads metatag names", () => {
  assert.equal(tagName("~Fox"), "fox");
  assert.equal(tagName("-fox"), "fox");
  assert.equal(tokenMetatag("-order:score"), "order");
  assert.equal(tokenMetatag("~rating:s"), "rating");
  assert.equal(tokenMetatag("fox"), "");
  assert.equal(queryHasMetatag("fox -rating:e", "rating"), true);
});

test("full e621 syntax passes through unchanged", () => {
  const query =
    '~cat ~dog -chicken african_* ( ~fox ~wolf ) -( red blue ) type:webm score:>=100 favcount:10..50 date:week user:bob fav:bob id:1..9 width:>=1920 height:>1000 filesize:1MB..5MB duration:>30 status:any source:*twitter.com description:"two words" pool:4 set:17 parent:none child:any voted:me md5:abc inpool:true ischild:false isparent:true';
  const built = buildSearchQuery({ userQuery: query, rating: "all", order: "" });
  assert.equal(built.tags, query);
});

test("rating and order selects are only added when the query has none", () => {
  assert.equal(buildSearchQuery({ userQuery: "fox", rating: "s", order: "order:score" }).tags, "fox rating:s order:score");
  const withOwn = buildSearchQuery({ userQuery: "fox rating:e -order:score", rating: "s", order: "order:favcount" });
  assert.equal(withOwn.tags, "fox rating:e -order:score");
  assert.equal(withOwn.ratingApplied, false);
  assert.equal(buildSearchQuery({ userQuery: "fox randseed:5", order: "order:score" }).tags, "fox randseed:5");
  assert.equal(buildSearchQuery({ userQuery: "fox -rating:q", rating: "s" }).tags, "fox -rating:q");
});

test("limit: is dropped, duplicates removed, but group parentheses kept", () => {
  assert.equal(buildSearchQuery({ userQuery: "fox limit:5 fox ( ~a ~b ) ( ~c ~d )" }).tags, "fox ( ~a ~b ) ( ~c ~d )");
});

test("blacklist adds -tag unless the search names that tag", () => {
  assert.equal(buildSearchQuery({ userQuery: "fox", blacklist: ["gore", "fox"] }).tags, "fox -gore");
  assert.equal(buildSearchQuery({ userQuery: "-gore", blacklist: ["gore"] }).tags, "-gore");
});

test("40-tag limit trims blacklist extras before the user's own tags", () => {
  const user = Array.from({ length: 39 }, (_, i) => "t" + i).join(" ");
  const built = buildSearchQuery({ userQuery: user, rating: "s", blacklist: ["a", "b", "c"] });
  assert.equal(tokenize(built.tags).length, 40);
  assert.ok(built.tags.endsWith("rating:s"));
  assert.equal(built.droppedForLimit.length, 0);
});

test("client filter keeps rating and blacklist behavior", () => {
  const posts = [
    { id: 1, rating: "s", tags: { general: ["fox"] }, file: { url: "x" } },
    { id: 2, rating: "e", tags: { general: ["fox", "gore"] }, file: { url: "x" } },
    { id: 3, rating: "s", tags: {}, file: { url: null } },
  ];
  assert.deepEqual(applyClientFilters(posts, { rating: "s" }).map((p) => p.id), [1]);
  assert.deepEqual(applyClientFilters(posts, { blacklist: ["gore"] }).map((p) => p.id), [1]);
});

test("buildSearchQuery keeps an empty search within 40 tags with a long blacklist", () => {
  const blacklist = Array.from({ length: 45 }, (_, i) => `tag_${i}`);
  const { tags } = buildSearchQuery({ userQuery: "", rating: "s", blacklist });
  const tokens = tags.split(" ");
  assert.ok(tokens.length <= MAX_SEARCH_TAGS, `got ${tokens.length} tags`);
  assert.ok(tokens.includes("rating:s"), "rating stays");
});

test("fitTagLimit leaves room for an id: lookup and keeps rating tags", () => {
  const tags = Array.from({ length: 41 }, (_, i) => `-tag_${i}`).concat("-rating:e").join(" ");
  const fitted = fitTagLimit(tags, 1).split(" ");
  assert.equal(fitted.length, MAX_SEARCH_TAGS - 1);
  assert.ok(fitted.includes("-rating:e"));
  assert.equal(fitTagLimit("-a rating:s", 1), "-a rating:s");
});
