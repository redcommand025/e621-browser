import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKED_TAGS,
  FORCED_EXCLUSIONS,
  MAX_SEARCH_TAGS,
  applyClientFilters,
  buildSearchQuery,
  collectTags,
  filterPools,
  filterPosts,
  filterSuggestions,
  isBlockedTag,
  collectTagsByCategory,
  formatPoolName,
  formatPostStats,
  formatTagCategoryLabel,
  isValidUsername,
  nameContainsBlockedTerm,
  poolDirectionOpen,
  poolResponseHasMore,
  postPoolIds,
  shouldFetchMorePools,
  sanitizeUsername,
  stepPoolIds,
  shouldExcludePost,
} from "../js/filter.js";

function post(overrides = {}) {
  return {
    id: 1,
    rating: "s",
    flags: { deleted: false },
    files: { original: { url: "https://example.invalid/safe.jpg" } },
    tags: ["canine", "fox"],
    ...overrides,
  };
}

test("blocked tag list is fixed and includes young, loli, shota, cub", () => {
  assert.deepEqual([...BLOCKED_TAGS], ["young", "loli", "shota", "cub"]);
  assert.deepEqual([...FORCED_EXCLUSIONS], ["-young", "-loli", "-shota", "-cub"]);
  for (const tag of BLOCKED_TAGS) assert.equal(isBlockedTag(tag), true);
  assert.equal(isBlockedTag("YOUNG"), true);
  assert.equal(isBlockedTag("-loli"), true);
  assert.equal(isBlockedTag("canine"), false);
});

test("excludes posts tagged young, loli, shota, or cub in a flat tag list", () => {
  for (const tag of BLOCKED_TAGS) {
    assert.equal(shouldExcludePost(post({ tags: ["canine", tag, "fox"] })), true);
  }
});

test("excludes blocked tags in every tag category of the legacy object format", () => {
  const categories = [
    "general",
    "artist",
    "copyright",
    "character",
    "species",
    "invalid",
    "lore",
    "meta",
  ];
  for (const category of categories) {
    for (const tag of BLOCKED_TAGS) {
      const tags = Object.fromEntries(categories.map((name) => [name, []]));
      tags[category] = [tag];
      assert.equal(
        shouldExcludePost(post({ tags })),
        true,
        `${tag} in ${category} must be excluded`
      );
    }
  }
});

test("exclusion is case-insensitive and ignores leading minuses on names", () => {
  assert.equal(shouldExcludePost(post({ tags: ["Young"] })), true);
  assert.equal(shouldExcludePost(post({ tags: { general: ["Shota"] } })), true);
});

test("drops posts with no file URL or a deleted flag", () => {
  assert.equal(shouldExcludePost(post({ files: { original: { url: null } } })), true);
  assert.equal(shouldExcludePost(post({ files: {}, file: { url: null } })), true);
  assert.equal(shouldExcludePost(post({ flags: { deleted: true } })), true);
  assert.equal(shouldExcludePost(null), true);
});

test("keeps a safe post with a file URL and no blocked tags", () => {
  const keep = post();
  assert.equal(shouldExcludePost(keep), false);
  assert.deepEqual(collectTags(keep), ["canine", "fox"]);
  assert.deepEqual(filterPosts([keep, post({ tags: ["young"] })]), [keep]);
});

test("supports the legacy file.url field", () => {
  const legacy = {
    id: 2,
    flags: { deleted: false },
    file: { url: "https://example.invalid/legacy.jpg" },
    tags: { general: ["canine"] },
  };
  assert.equal(shouldExcludePost(legacy), false);
});

test("never suggests blocked tags, including aliases", () => {
  const suggestions = filterSuggestions([
    { name: "fox", post_count: 10 },
    { name: "young", post_count: 99 },
    { name: "loli", post_count: 99 },
    { name: "something", antecedent_name: "shota", post_count: 1 },
    { name: "cub", post_count: 3 },
    { name: "canine", post_count: 5 },
  ]);
  assert.deepEqual(
    suggestions.map((item) => item.name),
    ["fox", "canine"]
  );
});

test("every search query includes forced exclusions and strips blocked terms", () => {
  const result = buildSearchQuery({
    userQuery: "canine young loli solo",
    rating: "s",
    order: "order:score",
    blacklist: ["gore"],
  });
  const tags = result.tags.split(/\s+/);
  for (const token of FORCED_EXCLUSIONS) {
    assert.equal(tags.includes(token), true, `missing ${token}`);
  }
  assert.equal(tags.includes("young"), false);
  assert.equal(tags.includes("loli"), false);
  assert.equal(tags.includes("canine"), true);
  assert.equal(tags.includes("solo"), true);
  assert.equal(tags.includes("rating:s"), true);
  assert.equal(tags.includes("order:score"), true);
  assert.equal(tags.includes("-gore"), true);
  assert.equal(tags.filter((token) => token === "-young").length, 1);
  assert.ok(result.droppedBlocked.includes("young"));
});

test("forced exclusions are kept when the 40-tag limit is exceeded", () => {
  const userTags = Array.from({ length: 45 }, (_, i) => `tag_${i}`);
  const result = buildSearchQuery({ userQuery: userTags.join(" "), rating: "all" });
  const tags = result.tags.split(/\s+/);
  assert.ok(tags.length <= MAX_SEARCH_TAGS);
  for (const token of FORCED_EXCLUSIONS) assert.equal(tags.includes(token), true);
  assert.ok(result.droppedForLimit.length > 0);
});

test("there is no query flag that disables the hard exclusion", () => {
  const sneaky = buildSearchQuery({
    userQuery: "status:any include:young young",
    rating: "all",
    order: "",
  });
  const tags = sneaky.tags.split(/\s+/);
  assert.equal(tags.includes("-young"), true);
  assert.equal(tags.includes("young"), false);
});


test("filterPools hides pools whose names contain blocked terms", () => {
  const pools = [
    { id: 1, name: "Forest_Walk", post_ids: [10] },
    { id: 2, name: "young_adventures", post_ids: [11] },
    { id: 3, name: "the_loli_collection", post_ids: [12] },
    { id: 4, name: "Shota_Sketches", post_ids: [13] },
    { id: 5, name: "winter_cub_days", post_ids: [14] },
    { id: 6, name: "Canine_Study", post_ids: [15] },
  ];
  assert.deepEqual(
    filterPools(pools).map((pool) => pool.id),
    [1, 6]
  );
  assert.equal(nameContainsBlockedTerm("young_adventures"), true);
  assert.equal(nameContainsBlockedTerm("younger_style"), false);
});

test("popular and pool posts are excluded client-side even without a tag query", () => {
  function item(id, tags, rating = "s") {
    return {
      id,
      rating,
      flags: { deleted: false },
      files: { original: { url: "https://example.invalid/file.jpg" } },
      tags,
    };
  }
  const posts = [
    item(1, ["canine", "fox"], "s"),
    item(2, ["young"], "s"),
    item(3, { general: ["canine"], character: ["loli"] }, "s"),
    item(4, ["canine"], "e"),
    {
      id: 5,
      rating: "s",
      flags: { deleted: false },
      files: { original: { url: null } },
      tags: ["canine"],
    },
  ];
  const filtered = applyClientFilters(posts, { rating: "s", blacklist: ["gore"] });
  assert.deepEqual(filtered.map((post) => post.id), [1]);
  assert.equal(applyClientFilters(posts, { rating: "all" }).some((post) => post.id === 4), true);
  assert.equal(applyClientFilters(posts, { rating: "all" }).some((post) => post.id === 2), false);
});

test("usernames are sanitized before fav: queries", () => {
  assert.equal(sanitizeUsername(" fav:BitWolfy "), "BitWolfy");
  assert.equal(isValidUsername("bitWolfy"), true);
  assert.equal(isValidUsername("bad user"), false);
  assert.equal(isValidUsername("fav:foo young"), false);
});

test("collectTagsByCategory groups tags and omits blocked terms", () => {
  const groups = collectTagsByCategory({
    tags: {
      meta: ["hi_res"],
      artist: ["example_artist"],
      general: ["canine", "young", "solo"],
      character: ["loli", "fox_mccloud"],
    },
  });
  assert.deepEqual(
    groups.map((group) => [group.category, group.tags]),
    [
      ["artist", ["example_artist"]],
      ["character", ["fox_mccloud"]],
      ["general", ["canine", "solo"]],
      ["meta", ["hi_res"]],
    ]
  );
  const flat = collectTagsByCategory({ tags: ["canine", "cub", "fox"] });
  assert.deepEqual(flat, [{ category: "general", tags: ["canine", "fox"] }]);
  const spaced = collectTagsByCategory({ tags: { general: "canine young solo" } });
  assert.deepEqual(spaced, [{ category: "general", tags: ["canine", "solo"] }]);
});

test("formatPoolName and postPoolIds skip blocked pool names only at the name check", () => {
  assert.equal(formatPoolName("Safety_Plan"), "Safety Plan");
  assert.deepEqual(postPoolIds({ pools: [12, "12", 15] }), [12, 15]);
  assert.equal(nameContainsBlockedTerm("young_fox_pool"), true);
  assert.equal(nameContainsBlockedTerm("Safety_Plan"), false);
});

test("stepPoolIds walks around blocked neighbors and reports unknown ids", () => {
  const ids = [10, 20, 30, 40, 50];
  const status = { 20: "blocked", 30: "ok" };
  assert.deepEqual(stepPoolIds(ids, 0, 1, status, 8), { index: 2, id: 30, need: [] });
  assert.equal(poolDirectionOpen(ids, 0, 1, status), true);
  assert.equal(poolDirectionOpen(ids, 0, -1, status), false);

  const unknown = stepPoolIds(ids, 2, 1, status, 2);
  assert.deepEqual(unknown, { index: -1, id: null, need: [40, 50] });
  assert.equal(poolDirectionOpen(ids, 2, 1, status), true);

  const allBlocked = { 10: "blocked", 20: "blocked" };
  assert.deepEqual(stepPoolIds([10, 20], 1, -1, allBlocked, 8), { index: -1, id: null, need: [] });
  assert.equal(poolDirectionOpen([10, 20], 1, -1, allBlocked), false);
  assert.equal(poolDirectionOpen([10, 20], 0, 1, { 20: "ok" }), true);
});

test("collectTagsByCategory shows every e621 tag category in the requested order", () => {
  const groups = collectTagsByCategory({
    tags: {
      invalid: ["bad_tag"],
      general: ["solo", "canine", "young"],
      lore: ["some_lore"],
      meta: ["hi_res"],
      species: ["canid"],
      character: ["fox_mccloud", "loli"],
      copyright: ["nintendo"],
      contributor: ["example_contributor"],
      artist: ["example_artist"],
      custom_bucket: ["extra_tag"],
    },
  });
  assert.deepEqual(
    groups.map((group) => [group.category, formatTagCategoryLabel(group.category), group.tags]),
    [
      ["artist", "Artists", ["example_artist"]],
      ["contributor", "Contributors", ["example_contributor"]],
      ["copyright", "Copyrights", ["nintendo"]],
      ["character", "Characters", ["fox_mccloud"]],
      ["species", "Species", ["canid"]],
      ["general", "General", ["solo", "canine"]],
      ["meta", "Meta", ["hi_res"]],
      ["lore", "Lore", ["some_lore"]],
      ["invalid", "Invalid", ["bad_tag"]],
      ["custom_bucket", "Custom Bucket", ["extra_tag"]],
    ]
  );
  assert.equal(groups.some((group) => group.tags.includes("young") || group.tags.includes("loli")), false);
  assert.equal(formatTagCategoryLabel("artist"), "Artists");
  assert.equal(formatTagCategoryLabel("contributor"), "Contributors");
  assert.equal(formatTagCategoryLabel("copyright"), "Copyrights");
  assert.equal(formatTagCategoryLabel("character"), "Characters");
  assert.equal(formatTagCategoryLabel("species"), "Species");
  assert.equal(formatTagCategoryLabel("meta"), "Meta");
  assert.equal(formatTagCategoryLabel("lore"), "Lore");
});

test("poolResponseHasMore is based on the raw API count, not the filtered count", () => {
  assert.equal(poolResponseHasMore(24, 24, 1, 750), true);
  assert.equal(poolResponseHasMore(23, 24, 1, 750), false);
  assert.equal(poolResponseHasMore(100, 100, 750, 750), false);
  assert.equal(shouldFetchMorePools(24, 24, 23, 0, 10), true);
  assert.equal(shouldFetchMorePools(100, 100, 100, 0, 10), false);
  assert.equal(shouldFetchMorePools(100, 100, 90, 10, 10), false);
  assert.equal(shouldFetchMorePools(40, 100, 39, 0, 10), false);
});

test("formatPostStats reads favs and score from both API shapes", () => {
  assert.deepEqual(formatPostStats({ stats: { fav_count: 12, score: { up: 160, down: 8, total: 152 } } }), {
    favs: 12,
    total: 152,
    direction: "up",
    mark: "⬆",
    favText: "☆12",
    scoreText: "⬆ 152",
    text: "☆12 ⬆ 152",
  });
  assert.deepEqual(formatPostStats({ fav_count: 3, score: { total: -4 } }), {
    favs: 3,
    total: -4,
    direction: "down",
    mark: "⬇",
    favText: "☆3",
    scoreText: "⬇ 4",
    text: "☆3 ⬇ 4",
  });
  assert.equal(formatPostStats({ stats: { fav_count: 0, score: { total: 0 } } }).text, "☆0 = 0");
  assert.equal(formatPostStats({}).text, "☆0 = 0");
});
