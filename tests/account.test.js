import test from "node:test";
import assert from "node:assert/strict";
import { downloadFilename, normalizeRatings, profileSearches, profileStats, ratingQueryToken } from "../js/account.js";
import { applyClientFilters, buildSearchQuery } from "../js/filter.js";

test("rating checkboxes build the rating part of the query", () => {
  assert.equal(ratingQueryToken(["s", "q", "e"]), "");
  assert.equal(ratingQueryToken("all"), "");
  assert.equal(ratingQueryToken([]), "", "nothing checked is treated as all (the UI keeps one checked)");
  assert.equal(ratingQueryToken(["s"]), "rating:s");
  assert.equal(ratingQueryToken(["e"]), "rating:e");
  assert.equal(ratingQueryToken(["s", "q"]), "-rating:e");
  assert.equal(ratingQueryToken(["q", "s"]), "-rating:e");
  assert.equal(ratingQueryToken(["s", "e"]), "-rating:q");
  assert.equal(ratingQueryToken(["q", "e"]), "-rating:s");
  assert.deepEqual(normalizeRatings("e,s"), ["s", "e"]);
  assert.deepEqual(normalizeRatings(["explicit", "safe"]), ["s", "e"]);
});

test("search query uses the rating checkboxes only when the search has no rating:", () => {
  assert.equal(buildSearchQuery({ userQuery: "fox", rating: ["s", "q"] }).tags, "fox -rating:e");
  assert.equal(buildSearchQuery({ userQuery: "fox", rating: ["s"] }).tags, "fox rating:s");
  assert.equal(buildSearchQuery({ userQuery: "fox", rating: ["s", "q", "e"] }).tags, "fox");
  assert.equal(buildSearchQuery({ userQuery: "fox rating:q", rating: ["s"] }).tags, "fox rating:q");
  assert.equal(buildSearchQuery({ userQuery: "fox", rating: "s" }).tags, "fox rating:s", "the old single value still works");
});

test("client filter keeps only checked ratings", () => {
  const posts = ["s", "q", "e"].map((rating, i) => ({ id: i + 1, rating, tags: {}, file: { url: "x" } }));
  assert.deepEqual(applyClientFilters(posts, { rating: ["s", "e"] }).map((p) => p.rating), ["s", "e"]);
  assert.deepEqual(applyClientFilters(posts, { rating: ["q"] }).map((p) => p.rating), ["q"]);
  assert.equal(applyClientFilters(posts, { rating: ["s", "q", "e"] }).length, 3);
});

test("download file name has the artist, post ID, and a few tags", () => {
  const post = {
    id: 12345,
    files: { meta: { ext: "png" }, original: { url: "https://static1.e621.net/data/ab/cd/abcd.png" } },
    tags: {
      artist: ["conditional_dnp", "some_artist"],
      character: ["maple_(character)"],
      species: ["red_panda", "mammal"],
      general: ["solo", "smile"],
    },
  };
  assert.equal(downloadFilename(post), "some_artist - 12345 - maple_(character) red_panda mammal.png");
  assert.equal(downloadFilename(post, { tagCount: 1 }), "some_artist - 12345 - maple_(character).png");
  const bare = { id: 7, file: { url: "https://x/y/file.webm" }, tags: { general: ['bad/name:"x"'] } };
  assert.equal(downloadFilename(bare), 'unknown artist - 7 - badnamex.webm');
  const long = { id: 1, files: { meta: { ext: "jpg" } }, tags: { artist: ["a".repeat(300)] } };
  const name = downloadFilename(long);
  assert.ok(name.length <= 120 && name.endsWith(".jpg"));
});

test("profile stats and searches come from the user record", () => {
  const stats = profileStats({
    name: "someone",
    post_upload_count: 12,
    favorite_count: 250,
    comment_count: 3,
    forum_post_count: 0,
    note_update_count: 5,
    positive_feedback_count: 2,
    neutral_feedback_count: 0,
    negative_feedback_count: 1,
    level_string: "Member",
  });
  assert.deepEqual(stats.map((s) => s.label), ["Uploads", "Favorites", "Comments", "Forum posts", "Note edits", "Feedback"]);
  assert.equal(stats[0].search, "user:someone");
  assert.equal(stats[1].search, "fav:someone");
  assert.equal(stats.at(-1).value, "2 / 0 / 1");
  assert.deepEqual(profileStats(null), []);
  assert.deepEqual(profileSearches("someone").map((s) => s.query), ["user:someone", "fav:someone"]);
  assert.deepEqual(profileSearches("someone", { own: true }).map((s) => s.query), ["user:someone", "fav:someone", "votedup:someone", "voteddown:someone"]);
});
