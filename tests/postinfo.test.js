import test from "node:test";
import assert from "node:assert/strict";
import {
  activeNotes,
  aggregatePageTags,
  applyFavoriteChange,
  applyVoteResult,
  formatFileSize,
  mergeRelatedTags,
  noteBoxPercent,
  noteScreenRect,
  parseRelatedTagString,
  postDetails,
  postHasNotes,
  postIsFavorited,
  postSources,
  postUserVote,
  searchTagNames,
  tagNameBatches,
  voteRequestParams,
} from "../js/postinfo.js";


const modern = {
  id: 10,
  rating: "s",
  created_at: "2024-01-02T03:04:05.000-05:00",
  uploader_id: 7,
  uploader_name: "uploader_x",
  description: "hello",
  sources: ["https://x.com/a", "-https://old.example/b", "not a url"],
  files: { meta: { md5: "abc", ext: "png", size: 2048 }, original: { width: 600, height: 400 } },
  stats: { score: { up: 5, down: -1, total: 4 }, fav_count: 3, is_favorited: false, vote: 0 },
  has: { notes: true },
  tags: { artist: ["some_artist", "Second_Artist"], general: ["solo"] },
};

const classic = {
  id: 11,
  rating: "e",
  file: { width: 100, height: 50, ext: "jpg", size: 500, md5: "def" },
  score: { up: 1, down: 0, total: 1 },
  fav_count: 2,
  is_favorited: true,
  has_notes: false,
  tags: { artist: ["a"] },
};

test("postDetails reads both post shapes", () => {
  const d = postDetails(modern);
  assert.equal(d.ext, "png");
  assert.equal(d.width, 600);
  assert.equal(d.height, 400);
  assert.equal(d.sizeText, "2 KB");
  assert.equal(d.md5, "abc");
  assert.equal(d.uploaderName, "uploader_x");
  assert.deepEqual(d.artists, ["some_artist", "second_artist"]);
  assert.equal(d.ratingName, "Safe");
  const c = postDetails(classic);
  assert.equal(c.width, 100);
  assert.equal(c.md5, "def");
  assert.equal(c.ratingName, "Explicit");
});

test("sources become safe links or plain text", () => {
  const s = postSources(modern);
  assert.equal(s[0].href, "https://x.com/a");
  assert.equal(s[1].removed, true);
  assert.equal(s[1].href, "https://old.example/b");
  assert.equal(s[2].href, null);
  assert.equal(postSources({ sources: ["javascript:alert(1)"] })[0].href, null);
});

test("formatFileSize", () => {
  assert.equal(formatFileSize(10), "10 B");
  assert.equal(formatFileSize(1536), "1.5 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5 MB");
  assert.equal(formatFileSize(null), "");
});

test("notes: has_notes detection and active filtering", () => {
  assert.equal(postHasNotes(modern), true);
  assert.equal(postHasNotes(classic), false);
  assert.equal(activeNotes([{ is_active: false, width: 1, height: 1 }, { width: 2, height: 2 }, { width: 0, height: 3 }]).length, 1);
});

test("noteBoxPercent maps original pixels to percentages and clamps", () => {
  assert.deepEqual(noteBoxPercent({ x: 60, y: 100, width: 120, height: 40 }, 600, 400), {
    left: 10,
    top: 25,
    width: 20,
    height: 10,
  });
  const clamped = noteBoxPercent({ x: 550, y: -10, width: 100, height: 50 }, 600, 400);
  assert.equal(clamped.left + clamped.width <= 100.0001, true);
  assert.equal(clamped.top, 0);
  assert.equal(noteBoxPercent({ x: 0, y: 0, width: 10, height: 10 }, 0, 0), null);
});

test("noteScreenRect follows the zoom transform", () => {
  const note = { x: 60, y: 100, width: 120, height: 40 };
  const display = { left: 20, top: 50, width: 300, height: 200 };
  const flat = noteScreenRect(note, 600, 400, display);
  assert.deepEqual(flat, { left: 50, top: 100, width: 60, height: 20 });
  const zoomed = noteScreenRect(note, 600, 400, display, { x: -100, y: -40, scale: 2 });
  assert.deepEqual(zoomed, { left: -20, top: 110, width: 120, height: 40 });
});

test("favorite and vote state updates in place", () => {
  const post = structuredClone(modern);
  assert.equal(postIsFavorited(post), false);
  applyFavoriteChange(post, true);
  assert.equal(post.stats.fav_count, 4);
  assert.equal(postIsFavorited(post), true);
  applyFavoriteChange(post, false, 9);
  assert.equal(post.stats.fav_count, 9);
  const old = structuredClone(classic);
  applyFavoriteChange(old, false);
  assert.equal(old.fav_count, 1);
  applyVoteResult(post, { score: 6, up: 7, down: -1, our_score: 1 });
  assert.deepEqual(post.stats.score, { up: 7, down: -1, total: 6 });
  assert.equal(postUserVote(post), 1);
  applyVoteResult(old, { score: 0, up: 1, down: -1, our_score: -1 });
  assert.equal(old.score.total, 0);
  assert.equal(postUserVote(old), -1);
});

test("voting the same way again removes the vote", () => {
  assert.deepEqual(voteRequestParams(0, 1), { score: "1", no_unvote: "true" });
  assert.deepEqual(voteRequestParams(-1, 1), { score: "1", no_unvote: "true" });
  assert.deepEqual(voteRequestParams(1, 1), { score: "1" });
  assert.deepEqual(voteRequestParams(-1, -1), { score: "-1" });
});

test("searchTagNames keeps plain positive tags only", () => {
  assert.deepEqual(searchTagNames("canine -cat rating:s order:score ~fox ( solo* canine"), ["canine", "fox"]);
});

test("related tags merge, rank shared tags first, and drop excluded ones", () => {
  assert.deepEqual(parseRelatedTagString("a 300 b 20"), [
    { name: "a", weight: 300 },
    { name: "b", weight: 20 },
  ]);
  const merged = mergeRelatedTags(
    [
      { name: "canine", related_tags: `canine 300 mammal 250 fox 90 solo 50` },
      { name: "solo", related_tags: "solo 300 mammal 100 female 200" },
    ],
    { exclude: ["canine", "solo", "female"] }
  );
  assert.deepEqual(merged.map((t) => t.name), ["mammal", "fox"], "blacklisted/searched tags are dropped");
});

test("aggregatePageTags counts each post once per tag", () => {
  const out = aggregatePageTags(
    [
      { tags: { general: ["solo", "fur"], species: ["fox"] } },
      { tags: { general: ["solo", "solo"] } },
    ],
    { exclude: ["fur"] }
  );
  assert.deepEqual(out, [
    { name: "solo", weight: 2 },
    { name: "fox", weight: 1 },
  ]);
});

test("tagNameBatches dedupes and splits", () => {
  const names = Array.from({ length: 205 }, (_, i) => "t" + i);
  const batches = tagNameBatches([...names, "T0", "bad,name"], 100);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 5]);
});

import { tagRelations } from "../js/postinfo.js";

test("tagRelations sorts aliases and implications for one tag", () => {
  const rel = tagRelations(
    "red_panda",
    [
      { antecedent_name: "lesser_panda", consequent_name: "red_panda", status: "active" },
      { antecedent_name: "wah", consequent_name: "red_panda", status: "active" },
      { antecedent_name: "old", consequent_name: "red_panda", status: "deleted" },
    ],
    [
      { antecedent_name: "red_panda", consequent_name: "ailurid", status: "active" },
      { antecedent_name: "red_panda_taur", consequent_name: "red_panda", status: "active" },
    ]
  );
  assert.deepEqual(rel, { aliasOf: "", aliases: ["lesser_panda", "wah"], implies: ["ailurid"], impliedBy: ["red_panda_taur"] });
  const alias = tagRelations("kitty", [{ antecedent_name: "kitty", consequent_name: "domestic_cat", status: "active" }], []);
  assert.equal(alias.aliasOf, "domestic_cat");
});
