import test from "node:test";
import assert from "node:assert/strict";
import {
  blacklistLineMatches,
  mergeBlacklists,
  normalizeBlacklistLine,
  parseBlacklistText,
  serializeBlacklist,
  singleTagLines,
} from "../js/blacklist.js";
import { applyClientFilters, blacklistForQuery, buildSearchQuery } from "../js/filter.js";

test("e621 blacklist text parses into intact lines and serializes back", () => {
  const text = "gore\r\n  canine   rating:e \n\n# a comment\nGORE\n-solo male";
  const lines = parseBlacklistText(text);
  assert.deepEqual(lines, ["gore", "canine rating:e", "-solo male"]);
  assert.equal(serializeBlacklist(lines), "gore\ncanine rating:e\n-solo male");
  assert.equal(serializeBlacklist([]), "");
  assert.equal(normalizeBlacklistLine("  A   b "), "a b");
});

test("first sync is the union, account lines first", () => {
  assert.deepEqual(mergeBlacklists({ base: null, local: ["gore", "x y"], remote: ["scat", "gore"] }), ["scat", "gore", "x y"]);
});

test("three-way merge keeps additions and removals from both sides", () => {
  const base = ["a", "b", "c d"];
  // Local removed b and added e; the account removed "c d" and added f.
  const merged = mergeBlacklists({ base, local: ["a", "c d", "e"], remote: ["a", "b", "f"] });
  assert.deepEqual(merged, ["a", "f", "e"]);
  // Nothing changed anywhere.
  assert.deepEqual(mergeBlacklists({ base, local: base, remote: base }), base);
  // Emptied locally.
  assert.deepEqual(mergeBlacklists({ base, local: [], remote: base }), []);
});

test("blacklist lines match like e621's", () => {
  const tags = new Set(["canine", "solo", "male", "fox"]);
  assert.equal(blacklistLineMatches("canine", tags, "s"), true);
  assert.equal(blacklistLineMatches("canine rating:e", tags, "s"), false);
  assert.equal(blacklistLineMatches("canine rating:s", tags, "s"), true);
  assert.equal(blacklistLineMatches("canine -solo", tags, "s"), false);
  assert.equal(blacklistLineMatches("canine -feline", tags, "s"), true);
  assert.equal(blacklistLineMatches("~wolf ~fox", tags, "s"), true);
  assert.equal(blacklistLineMatches("~wolf ~cat", tags, "s"), false);
  assert.equal(blacklistLineMatches("can*", tags, "s"), true);
  assert.equal(blacklistLineMatches("score:<0", tags, "s"), false, "unknown metatags never hide posts");
  assert.equal(blacklistLineMatches("-feline", tags, "s"), false, "a line of only exclusions hides nothing");
});

test("only single-tag lines are sent to e621 as -tag; all lines filter in the browser", () => {
  const lines = ["gore", "canine rating:e", "-solo", "rating:e", "abc*"];
  assert.deepEqual(singleTagLines(lines), ["gore"]);
  assert.equal(buildSearchQuery({ userQuery: "fox", blacklist: lines }).tags, "fox -gore");
  const posts = [
    { id: 1, rating: "e", tags: { general: ["canine"] }, file: { url: "x" } },
    { id: 2, rating: "s", tags: { general: ["canine"] }, file: { url: "x" } },
    { id: 3, rating: "s", tags: { general: ["gore"] }, file: { url: "x" } },
  ];
  assert.deepEqual(applyClientFilters(posts, { blacklist: lines }).map((p) => p.id), [2]);
  assert.deepEqual(blacklistForQuery(lines, "canine"), ["gore", "-solo", "rating:e", "abc*"]);
});
