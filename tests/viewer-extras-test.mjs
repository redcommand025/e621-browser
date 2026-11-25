/**
 * Headless Chrome checks for the post viewer extras: notes overlay with
 * pinch zoom and pan (real CDP touch events), comments, details, tag counts,
 * related tags, the favorite and vote buttons, tag long-press menu, wiki
 * preview and in-app wiki, metatag autocomplete, the comments toggle,
 * the display menu (sizes, shapes, sort, rating checkboxes), the account
 * dropdown and profile page, two-way blacklist sync, comments oldest-first
 * with Add comment, and the Download and Fullscreen buttons.
 *
 * Every e621 request is answered with mock JSON (rating:s posts only),
 * so nothing is written to a real account and no media is downloaded or saved.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const IMG_URL = "https://static1.e621.net/data/test/mock-note-image.svg";
// A plain generated test card (no real artwork).
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
<rect width="600" height="400" fill="#335"/><rect x="60" y="100" width="120" height="40" fill="#fc0"/>
<rect x="400" y="300" width="150" height="60" fill="#0cf"/></svg>`;

const NOTES = [
  { id: 1, post_id: 500, x: 60, y: 100, width: 120, height: 40, is_active: true, body: "Hello [b]there[/b]" },
  { id: 2, post_id: 500, x: 400, y: 300, width: 150, height: 60, is_active: true, body: '<img src=x onerror="window.__xss=1"> "link":https://example.com' },
  { id: 3, post_id: 500, x: 10, y: 10, width: 10, height: 10, is_active: false, body: "inactive" },
];

const POST = {
  id: 500,
  created_at: "2024-05-01T12:00:00.000-04:00",
  rating: "s",
  uploader_id: 77,
  uploader_name: "mock_uploader",
  description: "A [i]safe[/i] test post. <script>window.__xss=1</script>",
  sources: ["https://example.com/art/1", "javascript:alert(1)"],
  files: {
    meta: { md5: "0123456789abcdef0123456789abcdef", ext: "png", size: 123456, has_sample: false },
    original: { width: 600, height: 400, url: IMG_URL },
    preview: { width: 150, height: 100, jpg: IMG_URL },
    sample: { width: 600, height: 400, jpg: IMG_URL },
  },
  stats: { score: { up: 10, down: -2, total: 8 }, fav_count: 5, is_favorited: false, vote: 0, comment_count: 2 },
  flags: {},
  has: { notes: true, parent: false, children: false, active_children: false },
  relationships: { parent_id: null, children: [] },
  pools: [],
  tags: { artist: ["mock_artist"], general: ["canine", "solo"], species: ["fox"], meta: ["hi_res"] },
};

const COMMENTS = [
  { id: 9, post_id: 500, creator_id: 5, creator_name: "commenter_a", created_at: "2024-05-02T10:00:00.000-04:00", score: 3, is_hidden: false, body: "[quote]earlier[/quote]\nNice! <b>not bold</b> post #1" },
  { id: 8, post_id: 500, creator_id: 6, creator_name: "commenter_b", created_at: "2024-05-01T10:00:00.000-04:00", score: -1, is_hidden: false, body: "second" },
];

const CATEGORIES = { mock_artist: 1, canine: 5, fox: 5, canid: 5, mammal: 5, hi_res: 7, solo: 0, canines: 5 };
const WIKI = {
  canine: "The [b]canine[/b] tag is for dogs, wolves, and foxes. See [[fox]] and [[Canid]].\n\nSecond paragraph with {{canine solo}}.\n\nThird paragraph that only shows on the full page.\n\nh4. More\nFourth part <script>window.__xss=1</script>",
  fox: "Foxes. See [[canine]].",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

// Mutable mock state (the "account" lives only in this test).
const mock = {
  fileCors: true,
  remoteBlacklist: "gore\nfeline rating:e",
  user() {
    return {
      id: 42,
      name: "mock_user",
      level_string: "Member",
      created_at: "2020-02-03T10:00:00.000-05:00",
      avatar_id: 500,
      post_upload_count: 12,
      favorite_count: 34,
      comment_count: 5,
      forum_post_count: 1,
      note_update_count: 2,
      positive_feedback_count: 0,
      neutral_feedback_count: 0,
      negative_feedback_count: 0,
      profile_about: "Hi! [b]bold[/b] <script>window.__xss=1</script>",
      blacklisted_tags: mock.remoteBlacklist,
    };
  },
};

function json(request, body, status = 200) {
  request.respond({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
}

async function setupMocks(page, calls) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url === IMG_URL) {
      const headers = mock.fileCors ? cors : { "Access-Control-Allow-Origin": "https://e621.net" };
      request.respond({ status: 200, contentType: "image/svg+xml", headers, body: SVG });
      return;
    }
    if (!url.startsWith("https://e621.net/")) {
      request.continue();
      return;
    }
    if (request.method() === "OPTIONS") {
      request.respond({ status: 204, headers: cors, body: "" });
      return;
    }
    const parsed = new URL(url);
    calls.push({ method: request.method(), path: parsed.pathname, params: Object.fromEntries(parsed.searchParams), body: request.postData() || "", auth: request.headers().authorization || "" });
    if (parsed.pathname === "/posts.json") {
      const tags = parsed.searchParams.get("tags") || "";
      // Mocked only, never live: rating:s, or -rating:e while the display test checks two ratings.
      assert.match(tags, /(^|\s)(rating:s|-rating:e)(\s|$)/, "posts query must exclude explicit: " + tags);
      return json(request, [POST]);
    }
    if (parsed.pathname === "/notes.json") return json(request, NOTES);
    if (parsed.pathname === "/comments.json" && request.method() === "POST") {
      const body = new URLSearchParams(request.postData() || "");
      const text = body.get("comment[body]") || "";
      if (text.trim().length < 2) {
        request.respond({ status: 422, contentType: "application/json", headers: cors, body: JSON.stringify({ errors: { body: ["is too short (minimum is 2 characters)"] } }) });
        return;
      }
      return json(request, { id: 10, post_id: Number(body.get("comment[post_id]")), creator_id: 42, creator_name: "mock_user", created_at: "2024-05-03T10:00:00.000-04:00", score: 0, body: text, is_hidden: false });
    }
    if (parsed.pathname === "/comments.json") {
      const list = COMMENTS.slice();
      if (parsed.searchParams.get("search[order]") === "id_asc") list.sort((a, b) => a.id - b.id);
      return json(request, list);
    }
    if (parsed.pathname === "/tags.json") {
      const names = (parsed.searchParams.get("search[name]") || "").split(",").filter(Boolean);
      return json(
        request,
        names.map((name, i) => ({
          name,
          post_count: 1000 * (i + 1) + 234,
          category: CATEGORIES[name] ?? 0,
          related_tags: name === "canine" ? "canine 300 mammal 250 fox 200 solo 150 canid 120" : "",
        }))
      );
    }
    if (parsed.pathname === "/wiki_pages.json") {
      const title = parsed.searchParams.get("search[title]");
      return json(request, WIKI[title] ? [{ id: 1, title, body: WIKI[title], is_deleted: false }] : []);
    }
    if (parsed.pathname === "/tag_aliases.json") {
      assert.equal(parsed.searchParams.get("search[status]"), "active");
      const name = parsed.searchParams.get("search[name_matches]");
      return json(request, name === "canine" ? [{ antecedent_name: "canines", consequent_name: "canine", status: "active" }] : []);
    }
    if (parsed.pathname === "/tag_implications.json") {
      const name = parsed.searchParams.get("search[name_matches]");
      return json(
        request,
        name === "canine"
          ? [
              { antecedent_name: "canine", consequent_name: "canid", status: "active" },
              { antecedent_name: "fox", consequent_name: "canine", status: "active" },
            ]
          : []
      );
    }
    if (parsed.pathname === "/users/mock_user.json" || parsed.pathname === "/users/42.json") {
      if (request.method() === "PATCH") {
        assert.match(request.headers().authorization || "", /^Basic /);
        const body = new URLSearchParams(request.postData() || "");
        assert.ok(body.has("user[blacklisted_tags]"), "PATCH must send user[blacklisted_tags]");
        mock.remoteBlacklist = body.get("user[blacklisted_tags]");
        request.respond({ status: 204, headers: cors, body: "" });
        return;
      }
      return json(request, mock.user());
    }
    if (parsed.pathname === "/favorites.json" && request.method() === "POST") return json(request, { id: 500, fav_count: 6 });
    if (/^\/favorites\/500\.json$/.test(parsed.pathname) && request.method() === "DELETE") {
      request.respond({ status: 204, headers: cors, body: "" });
      return;
    }
    if (/^\/posts\/500\/votes\.json$/.test(parsed.pathname)) {
      const body = new URLSearchParams(request.postData() || "");
      const score = Number(body.get("score"));
      const unvote = !body.get("no_unvote");
      return json(request, unvote ? { score: 8, up: 10, down: -2, our_score: 0 } : score > 0 ? { score: 9, up: 11, down: -2, our_score: 1 } : { score: 7, up: 10, down: -3, our_score: -1 });
    }
    return json(request, []);
  });
}

function log(message) {
  console.log(message);
}

async function touch(client, type, points) {
  await client.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 1, radiusY: 1, force: 1 })),
  });
}

async function noteGeometry(page) {
  return page.evaluate(() => {
    const img = document.querySelector("#viewer-stage .media-wrap img");
    const wrap = document.querySelector("#viewer-stage .media-wrap");
    const boxes = [...document.querySelectorAll("#viewer-stage .note-box")];
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    };
    return { img: r(img), wrapTransform: wrap.style.transform, boxes: boxes.map(r), natural: [img.naturalWidth, img.naturalHeight] };
  });
}

function assertAligned(geo, label) {
  const expected = [
    { x: 60, y: 100, w: 120, h: 40 },
    { x: 400, y: 300, w: 150, h: 60 },
  ];
  assert.equal(geo.boxes.length, 2, label + ": inactive notes must be skipped");
  geo.boxes.forEach((box, i) => {
    const e = expected[i];
    const want = {
      left: geo.img.left + (e.x / 600) * geo.img.width,
      top: geo.img.top + (e.y / 400) * geo.img.height,
      width: (e.w / 600) * geo.img.width,
      height: (e.h / 400) * geo.img.height,
    };
    for (const key of Object.keys(want)) {
      assert.ok(Math.abs(box[key] - want[key]) < 1.5, `${label}: note ${i + 1} ${key} ${box[key].toFixed(1)} != ${want[key].toFixed(1)}`);
    }
  });
}

/** Only Safe checked in the display menu (works before the 18+ confirmation). */
async function safeOnly(page) {
  await page.evaluate(() => {
    for (const [id, on] of [["rating-s", true], ["rating-q", false], ["rating-e", false]]) {
      const box = document.getElementById(id);
      if (box.checked !== on) {
        box.checked = on;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
}

function lastPostsTags(calls) {
  const call = calls.filter((c) => c.path === "/posts.json").at(-1);
  return call ? call.params.tags || "" : "";
}

async function waitPostsCall(page, calls, before) {
  const start = Date.now();
  while (calls.filter((c) => c.path === "/posts.json").length <= before) {
    if (Date.now() - start > 15000) throw new Error("expected a posts.json request");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.waitForFunction(() => !/Loading/i.test(document.getElementById("status").textContent), { timeout: 15000 });
}

async function displayMenuChecks(page, calls) {
  // The header stays short with the grid button in the search row.
  const chrome = await page.evaluate(() => ({
    h: document.querySelector(".chrome").getBoundingClientRect().height,
    oldControls: Boolean(document.querySelector(".controls")),
    oldRating: Boolean(document.getElementById("rating")),
    btnInForm: document.getElementById("search-form").contains(document.getElementById("display-btn")),
  }));
  assert.ok(chrome.h <= 200, "header too tall: " + chrome.h);
  assert.equal(chrome.oldControls, false, "old rating/sort row is gone");
  assert.equal(chrome.oldRating, false, "old rating select is gone");
  assert.equal(chrome.btnInForm, true);
  assert.equal(await page.$eval("#display-btn", (el) => el.querySelectorAll("svg rect").length), 4, "grid icon has 4 squares");

  await page.click("#display-btn");
  await page.waitForSelector("#display-menu:not([hidden])");
  assert.equal(await page.$eval("#display-btn", (el) => el.getAttribute("aria-expanded")), "true");
  const menu = await page.$eval("#display-menu", (el) => ({
    sizes: [...el.querySelectorAll('input[name="thumb-size"]')].map((i) => i.value + (i.checked ? "*" : "")),
    shapes: [...el.querySelectorAll('input[name="thumb-shape"]')].map((i) => i.value + (i.checked ? "*" : "")),
    sortInside: el.contains(document.getElementById("sort")),
    ratings: ["s", "q", "e"].map((r) => document.getElementById("rating-" + r).checked),
  }));
  assert.deepEqual(menu.sizes, ["large", "normal*", "small"]);
  assert.deepEqual(menu.shapes, ["full", "cropped*"]);
  assert.equal(menu.sortInside, true);
  assert.deepEqual(menu.ratings, [true, false, false]);
  assert.match(lastPostsTags(calls), /(^|\s)rating:s(\s|$)/);
  await shot(page, "display-menu");

  // Sizes change the grid.
  const width = () => page.$eval("#grid .thumb", (el) => el.getBoundingClientRect().width);
  const normalW = await width();
  await page.click('#display-menu input[name="thumb-size"][value="large"]');
  const largeW = await width();
  await page.click('#display-menu input[name="thumb-size"][value="small"]');
  const smallW = await width();
  assert.ok(largeW > normalW && normalW > smallW, `sizes ${largeW} > ${normalW} > ${smallW}`);
  // Full keeps the picture's shape (mock preview is 150x100); Cropped is square.
  await page.click('#display-menu input[name="thumb-shape"][value="full"]');
  let box = await page.$eval("#grid .thumb", (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, fit: getComputedStyle(el.querySelector("img")).objectFit }; });
  assert.ok(Math.abs(box.w / box.h - 1.5) < 0.05, "full shape keeps 3:2, got " + (box.w / box.h).toFixed(2));
  assert.equal(box.fit, "contain");
  await page.click('#display-menu input[name="thumb-shape"][value="cropped"]');
  box = await page.$eval("#grid .thumb", (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, fit: getComputedStyle(el.querySelector("img")).objectFit }; });
  assert.ok(Math.abs(box.w - box.h) < 1, "cropped is square");
  assert.equal(box.fit, "cover");
  await page.click('#display-menu input[name="thumb-size"][value="normal"]');
  let saved = JSON.parse(await page.evaluate(() => localStorage.getItem("e621-browser:display")));
  assert.equal(saved.size, "normal");
  assert.equal(saved.shape, "cropped");
  assert.deepEqual(saved.ratings, ["s"]);
  log("PASS display menu: Large/Normal/Small sizes and Full/Cropped shapes change the grid and are saved");

  // Ratings: two checked sends -rating:<the third>; one can't be unchecked.
  let before = calls.filter((c) => c.path === "/posts.json").length;
  await page.click("#rating-q");
  await waitPostsCall(page, calls, before);
  assert.match(lastPostsTags(calls), /(^|\s)-rating:e(\s|$)/);
  assert.doesNotMatch(lastPostsTags(calls), /(^|\s)rating:s(\s|$)/);
  before = calls.filter((c) => c.path === "/posts.json").length;
  await page.click("#rating-q");
  await waitPostsCall(page, calls, before);
  assert.match(lastPostsTags(calls), /(^|\s)rating:s(\s|$)/);
  await page.click("#rating-s");
  assert.equal(await page.$eval("#rating-s", (el) => el.checked), true, "the last rating stays checked");
  assert.match(await page.$eval("#display-note", (el) => el.textContent), /at least one/i);
  log("PASS rating checkboxes: one adds rating:s, two add -rating:e, and at least one stays checked");

  // Sort lives in the menu and adds one order: token.
  before = calls.filter((c) => c.path === "/posts.json").length;
  await page.select("#sort", "order:score");
  await waitPostsCall(page, calls, before);
  assert.equal((lastPostsTags(calls).match(/order:/g) || []).length, 1);
  assert.match(lastPostsTags(calls), /order:score/);
  saved = JSON.parse(await page.evaluate(() => localStorage.getItem("e621-browser:display")));
  assert.equal(saved.sort, "order:score");
  before = calls.filter((c) => c.path === "/posts.json").length;
  await page.select("#sort", "");
  await waitPostsCall(page, calls, before);
  log("PASS sort select is in the display menu and saved");

  // Esc closes and returns focus; an outside tap closes too.
  await page.focus("#rating-s");
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval("#display-menu", (el) => el.hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "display-btn");
  await page.click("#display-btn");
  await page.waitForSelector("#display-menu:not([hidden])");
  const outside = await page.$eval("#status", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; });
  await page.mouse.click(outside.x, outside.y);
  assert.equal(await page.$eval("#display-menu", (el) => el.hidden), true);
  log("PASS display menu closes with Esc (focus back on the button) and on an outside tap");
}

const SHOTS = process.env.SHOTS || "";
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png") });
}

const { server, base } = await startServer();
let browser;
let failed = false;
try {
  browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36");
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const calls = [];
  await setupMocks(page, calls);
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#age-confirm");
  await safeOnly(page);
  await page.click("#age-confirm");
  await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
  // Never let a download land on disk during the test.
  const browserCdp = await browser.target().createCDPSession();
  await browserCdp.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});

  await displayMenuChecks(page, calls);

  // Metatag autocomplete: names, then enum values, keeping a - prefix.
  await page.focus("#search");
  await page.$eval("#search", (el) => { el.value = ""; });
  await page.type("#search", "ord");
  await page.waitForFunction(() => [...document.querySelectorAll("#suggest li")].some((li) => li.dataset.name === "order:"), { timeout: 10000 });
  await page.$eval("#search", (el) => { el.value = ""; });
  await page.type("#search", "-order:sc");
  await page.waitForFunction(() => [...document.querySelectorAll("#suggest li")].some((li) => li.dataset.name === "order:score"), { timeout: 10000 });
  await page.evaluate(() => {
    const li = [...document.querySelectorAll("#suggest li")].find((item) => item.dataset.name === "order:score");
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
  assert.equal((await page.$eval("#search", (el) => el.value)).trim(), "-order:score");
  log("PASS autocomplete suggests metatag names and values and keeps the - prefix");

  // Search help popover.
  await page.$eval("#search-help-btn", (el) => el.click());
  await page.waitForSelector("#search-help[open]");
  const helpText = await page.$eval("#search-help", (el) => el.textContent);
  for (const piece of ["~cat ~dog", "order:score", "type:", "favcount"]) assert.ok(helpText.includes(piece), "help missing " + piece);
  await page.$eval("#search-help-close", (el) => el.click());
  log("PASS search help lists the syntax and metatags");

  // Wiki preview above the grid for a single-tag search.
  await page.$eval("#search", (el) => { el.value = "canine"; });
  await page.$eval("#search-form", (form) => form.requestSubmit());
  await page.waitForFunction(() => !document.getElementById("wiki-preview").hidden, { timeout: 15000 });
  const preview = await page.evaluate(() => {
    const box = document.getElementById("wiki-preview");
    const grid = document.getElementById("grid");
    return {
      text: document.getElementById("wiki-preview-body").textContent,
      before: Boolean(box.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING),
      tag: box.querySelector(".tag-name").textContent,
      more: document.getElementById("wiki-preview-more").textContent,
    };
  });
  assert.equal(preview.before, true, "wiki preview sits above the thumbnails");
  assert.equal(preview.tag, "canine");
  assert.match(preview.text, /dogs, wolves, and foxes/);
  assert.doesNotMatch(preview.text, /Fourth part/);
  assert.equal(preview.more, "Show more");
  await shot(page, "wiki-preview");
  await page.$eval("#wiki-preview-more", (el) => el.click());
  await page.waitForSelector("#wiki-dialog[open]");
  await page.waitForFunction(() => document.querySelectorAll("#wiki-relations .tag-chip").length >= 3, { timeout: 15000 });
  await page.waitForFunction(() => /Fourth part/.test(document.getElementById("wiki-body").textContent), { timeout: 15000 });
  const wiki = await page.evaluate(() => ({
    title: document.getElementById("wiki-title").textContent,
    relations: document.getElementById("wiki-relations").textContent,
    mentions: [...document.querySelectorAll("#wiki-mentions .tag-name")].map((el) => el.textContent),
    scripts: document.querySelectorAll("#wiki-body script").length,
    ownChip: Boolean(document.querySelector("#wiki-tag .tag-plus") && document.querySelector("#wiki-tag .tag-minus") && document.querySelector("#wiki-tag .tag-wiki")),
    open: document.getElementById("wiki-open").href,
  }));
  assert.equal(wiki.title, "canine");
  assert.match(wiki.relations, /Aliased from/);
  assert.match(wiki.relations, /canines/);
  assert.match(wiki.relations, /Implies[\s\S]*canid/);
  assert.match(wiki.relations, /Implied by[\s\S]*fox/);
  assert.deepEqual(wiki.mentions, ["fox", "canid"]);
  assert.equal(wiki.scripts, 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(wiki.ownChip, true);
  assert.equal(wiki.open, "https://e621.net/wiki_pages/show_or_new?title=canine");
  await shot(page, "wiki");
  // A [[wiki]] link inside the page opens that page in the app.
  await page.$eval('#wiki-body a[data-wiki="fox"]', (el) => el.click());
  await page.waitForFunction(() => document.getElementById("wiki-title").textContent === "fox", { timeout: 10000 });
  await page.waitForFunction(() => /Foxes/.test(document.getElementById("wiki-body").textContent), { timeout: 10000 });
  await page.$eval("#wiki-close", (el) => el.click());
  assert.equal(await page.$eval("#wiki-dialog", (el) => el.open), false);
  log("PASS single-tag search shows a wiki preview; Show more opens the in-app wiki with aliases, implications, and tag chips");

  // Related tags: button under the search bar, list from the search's related tags.
  await page.click("#related-btn");
  await page.waitForFunction(() => document.querySelectorAll("#related-list .related-tag").length > 0, { timeout: 15000 });
  await page.waitForFunction(() => { const c = [...document.querySelectorAll("#related-list .tag-count")]; return c.length && c.every((n) => n.textContent.trim()); }, { timeout: 15000 });
  await shot(page, "related");
  const related = await page.$$eval("#related-list .related-tag", (els) =>
    els.map((el) => ({
      name: el.querySelector(".tag-name").textContent,
      count: el.querySelector(".tag-count").textContent,
      tools: Boolean(el.querySelector(".tag-plus") && el.querySelector(".tag-minus") && el.querySelector(".tag-wiki")),
      category: el.dataset.category || "",
    }))
  );
  assert.deepEqual(related.map((r) => r.name), ["mammal", "fox", "solo", "canid"]);
  assert.ok(related.every((r) => /\d/.test(r.count)), "related tags show counts");
  assert.ok(related.every((r) => r.tools), "related tags have + ? -");
  assert.equal(related.find((r) => r.name === "fox").category, "species");
  await page.$eval('#related-list .related-tag[data-tag="fox"] .tag-name', (el) => el.click());
  await page.waitForFunction(() => document.getElementById("related-panel").hidden, { timeout: 5000 });
  assert.equal(await page.$eval("#search", (el) => el.value), "canine fox");
  await page.waitForFunction(() => document.getElementById("wiki-preview").hidden, { timeout: 5000 });
  log("PASS related tags list colored tag chips with counts; tapping adds to the search and the wiki preview hides for two tags");

  await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
  await page.click("#grid .thumb");
  await page.waitForSelector("#viewer[open]");

  // Layout order: media, actions, comments, tags, details.
  const order = await page.evaluate(() => {
    const ids = ["viewer-stage", "viewer-actions", "viewer-comments", "viewer-tags", "viewer-details"];
    const nodes = ids.map((id) => document.getElementById(id));
    return nodes.every((node, i) => i === 0 || nodes[i - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.equal(order, true, "viewer sections must be media, actions, comments, tags, details");
  log("PASS viewer order: image, favorite/vote bar, comments, tags, details");

  // Notes overlay.
  await page.waitForFunction(() => document.querySelectorAll("#viewer-stage .note-box").length === 2, { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.querySelector("#viewer-stage .media-wrap img");
    return img && img.complete && img.naturalWidth > 0;
  });
  const notesCall = calls.find((c) => c.path === "/notes.json");
  assert.equal(notesCall.params["search[post_id]"], "500");
  let geo = await noteGeometry(page);
  assertAligned(geo, "unzoomed");
  await shot(page, "viewer");
  const flatImg = geo.img;

  // Tap a visible note box for its text (safe DText, no HTML injection).
  const tapTarget = await page.evaluate(() => {
    const stage = document.getElementById("viewer-stage").getBoundingClientRect();
    for (const box of document.querySelectorAll("#viewer-stage .note-box")) {
      const b = box.getBoundingClientRect();
      const x = Math.min(Math.max(b.left + b.width / 2, stage.left + 2), stage.right - 2);
      const y = Math.min(Math.max(b.top + b.height / 2, stage.top + 2), stage.bottom - 2);
      if (document.elementFromPoint(x, y) === box) return { x, y, id: box.dataset.noteId };
    }
    return null;
  });
  assert.ok(tapTarget, "a note box should be tappable");
  await page.touchscreen.tap(tapTarget.x, tapTarget.y);
  await page.waitForSelector("#viewer-note-popup", { timeout: 5000 });
  const popupText = await page.$eval("#viewer-note-popup", (el) => el.textContent);
  assert.match(popupText, tapTarget.id === "1" ? /Hello there/ : /<img src=x/);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  log("PASS tapping a note shows its text");

  // Toggle hides and shows the notes.
  assert.match(await page.$eval("#viewer-notes-toggle", (el) => el.textContent), /Hide notes \(2\)/);
  await page.$eval("#viewer-notes-toggle", (el) => el.click());
  assert.equal(await page.$eval("#viewer-stage .notes-layer", (el) => el.hidden), true);
  assert.equal(await page.$("#viewer-note-popup"), null);
  await page.$eval("#viewer-notes-toggle", (el) => el.click());
  assert.equal(await page.$eval("#viewer-stage .notes-layer", (el) => el.hidden), false);
  log("PASS notes toggle hides and shows the overlay");

  assert.equal(await page.$("#viewer-note-popup"), null);

  const client = await page.target().createCDPSession();
  const cx = flatImg.left + flatImg.width / 2;
  const cy = flatImg.top + flatImg.height / 2;
  await touch(client, "touchStart", [[cx - 30, cy], [cx + 30, cy]]);
  for (let step = 1; step <= 8; step++) {
    await touch(client, "touchMove", [[cx - 30 - step * 12, cy], [cx + 30 + step * 12, cy]]);
  }
  await touch(client, "touchEnd", []);
  geo = await noteGeometry(page);
  assert.match(geo.wrapTransform, /scale\(/, "pinch must zoom the media wrapper");
  assert.ok(geo.img.width > flatImg.width * 2, "image should be zoomed in");
  assertAligned(geo, "pinch-zoomed");
  await shot(page, "zoomed");
  log(`PASS notes stay aligned after a pinch zoom (${(geo.img.width / flatImg.width).toFixed(2)}x)`);

  const zoomedImg = geo.img;
  await touch(client, "touchStart", [[cx, cy]]);
  for (let step = 1; step <= 6; step++) await touch(client, "touchMove", [[cx + step * 15, cy + step * 10]]);
  await touch(client, "touchEnd", []);
  geo = await noteGeometry(page);
  assert.ok(Math.abs(geo.img.left - zoomedImg.left) > 5 || Math.abs(geo.img.top - zoomedImg.top) > 5, "pan should move the image");
  assertAligned(geo, "panned");
  log("PASS notes stay aligned after a one-finger pan while zoomed");

  // A note box can still be tapped while zoomed once it is panned into view.
  const zoomedTap = await page.evaluate(() => {
    const stage = document.getElementById("viewer-stage").getBoundingClientRect();
    for (const box of document.querySelectorAll("#viewer-stage .note-box")) {
      const b = box.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      if (x > stage.left && x < stage.right && y > stage.top && y < stage.bottom && document.elementFromPoint(x, y) === box) return { x, y };
    }
    return null;
  });
  if (zoomedTap) {
    await page.touchscreen.tap(zoomedTap.x, zoomedTap.y);
    await page.waitForSelector("#viewer-note-popup", { timeout: 5000 });
    await page.$eval(".note-popup-close", (el) => el.click());
    log("PASS a note can be tapped while zoomed");
  }

  // Double-tap resets the zoom and the notes are aligned again.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const spot = await page.evaluate(() => {
    const stage = document.getElementById("viewer-stage").getBoundingClientRect();
    const img = document.querySelector("#viewer-stage .media-wrap img").getBoundingClientRect();
    const x = Math.min(Math.max(img.left + 5, stage.left + 5), stage.right - 5);
    const y = Math.min(Math.max(img.top + 5, stage.top + 5), stage.bottom - 5);
    return document.elementFromPoint(x, y).classList.contains("note-box") ? { x: stage.left + 3, y: stage.bottom - 3 } : { x, y };
  });
  await page.touchscreen.tap(spot.x, spot.y);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await page.touchscreen.tap(spot.x, spot.y);
  await page.waitForFunction(() => !document.querySelector("#viewer-stage .media-wrap").style.transform, { timeout: 5000 });
  geo = await noteGeometry(page);
  assertAligned(geo, "after reset");
  log("PASS double-tap resets zoom and notes realign");

  // Tag counts in the viewer tag list.
  await page.waitForFunction(() => [...document.querySelectorAll("#viewer-tags .tag-count")].every((n) => n.textContent.trim()), { timeout: 15000 });
  const tagCountCalls = calls.filter((c) => c.path === "/tags.json" && (c.params["search[name]"] || "").includes("mock_artist"));
  assert.equal(tagCountCalls.length, 1, "viewer tag counts use one batched request");
  const tagNames = await page.$$eval("#viewer-tags .tag-name", (els) => els.map((el) => el.textContent));
  assert.ok(tagNames.includes("canine"), "tag names stay plain");
  log("PASS viewer tags show post counts from one batched tags.json request");

  // Comments load lazily when scrolled into view.
  await page.$eval("#viewer-comments", (el) => el.scrollIntoView());
  await page.waitForFunction(() => document.querySelectorAll("#viewer-comments .comment").length === 2, { timeout: 15000 });
  await shot(page, "comments");
  const commentCalls = calls.filter((c) => c.path === "/comments.json");
  assert.equal(commentCalls.length, 1, "comments are fetched once for the open post");
  const commentCall = commentCalls[0];
  assert.equal(commentCall.params.group_by, "comment");
  assert.equal(commentCall.params["search[post_id]"], "500");
  assert.equal(commentCall.params["search[order]"], "id_asc", "comments are requested oldest first");
  assert.equal(commentCall.params.limit, "75", "posts with few comments load in one request");
  const authors = await page.$$eval("#viewer-comments .comment .comment-author", (els) => els.map((el) => el.textContent));
  assert.deepEqual(authors, ["commenter_b", "commenter_a"], "oldest comment first");
  const comment = await page.$eval('#viewer-comments .comment[data-id="9"]', (el) => ({
    author: el.querySelector(".comment-author").textContent,
    score: el.querySelector(".comment-score").textContent,
    quote: Boolean(el.querySelector("blockquote")),
    rawB: Boolean(el.querySelector(".comment-body b")),
    text: el.querySelector(".comment-body").textContent,
    postLink: el.querySelector('.comment-body a[href="https://e621.net/posts/1"]') ? true : false,
  }));
  assert.equal(comment.author, "commenter_a");
  assert.match(comment.score, /3/);
  assert.equal(comment.quote, true);
  assert.equal(comment.rawB, false, "raw HTML in comments must not become elements");
  assert.match(comment.text, /<b>not bold<\/b>/);
  assert.equal(comment.postLink, true);
  log("PASS comments load lazily, oldest to newest, with author, date, score, and safe DText");

  // Add comment sits at the very bottom; signed out it opens Sign in and posts nothing.
  const composeLast = await page.evaluate(() => {
    const body = document.getElementById("viewer-comments-body");
    return body.lastElementChild.id === "comment-compose" && document.getElementById("comment-add").textContent.trim() === "Add comment";
  });
  assert.equal(composeLast, true, "Add comment is the last thing in the comments");
  const postsBeforeComment = calls.filter((c) => c.method === "POST").length;
  await page.$eval("#comment-add", (el) => el.click());
  await page.waitForSelector("#account-dialog[open]", { timeout: 5000 });
  assert.equal(await page.$eval("#comment-form", (el) => el.hidden), true);
  assert.equal(calls.filter((c) => c.method === "POST").length, postsBeforeComment);
  await page.$eval("#account-close", (el) => el.click());
  log("PASS Add comment while signed out opens Sign in and sends nothing");

  // Download and Fullscreen: a row directly under the favorite/vote buttons.
  const toolsRow = await page.evaluate(() => {
    const buttons = document.querySelector("#viewer-actions .viewer-action-buttons").getBoundingClientRect();
    const tools = document.getElementById("viewer-tools");
    const t = tools.getBoundingClientRect();
    return {
      inActions: document.getElementById("viewer-actions").contains(tools),
      afterButtons: tools.previousElementSibling.classList.contains("viewer-action-buttons"),
      below: t.top >= buttons.bottom - 1,
      labels: [...tools.querySelectorAll("button")].map((b) => b.textContent.trim()),
    };
  });
  assert.equal(toolsRow.inActions && toolsRow.afterButtons && toolsRow.below, true, "tools row is right under the favorite/vote bar");
  assert.deepEqual(toolsRow.labels, ["⤓ Download", "⛶ Fullscreen"]);
  await page.$eval("#viewer-download", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("viewer-download").dataset.lastVia, { timeout: 10000 });
  const dl = await page.$eval("#viewer-download", (el) => ({ name: el.dataset.lastName, via: el.dataset.lastVia, status: document.getElementById("viewer-action-status").textContent }));
  assert.equal(dl.via, "blob");
  assert.equal(dl.name, "mock_artist - 500 - fox canine solo.png");
  assert.match(dl.status, /Saved mock_artist - 500 - fox canine solo\.png/);
  // When the file server blocks cross-site reads, the original opens in a new tab instead.
  mock.fileCors = false;
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(url);
      return {};
    };
    document.getElementById("viewer-download").dataset.lastVia = "";
  });
  await page.$eval("#viewer-download", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("viewer-download").dataset.lastVia, { timeout: 10000 });
  const fb = await page.evaluate(() => ({ via: document.getElementById("viewer-download").dataset.lastVia, opened: window.__opened, status: document.getElementById("viewer-action-status").textContent, link: document.querySelector("#viewer-action-status a.download-fallback")?.href }));
  assert.equal(fb.via, "open");
  assert.deepEqual(fb.opened, [IMG_URL]);
  assert.match(fb.status, /new tab/);
  assert.equal(fb.link, IMG_URL);
  mock.fileCors = true;
  log("PASS Download saves the original as a readable file name (blob), and opens it in a new tab when CORS blocks that");

  await page.$eval("#viewer-stage", (el) => el.scrollIntoView());
  await page.click("#viewer-fullscreen");
  await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.id === "viewer-stage", { timeout: 5000 });
  await page.waitForFunction(() => /Exit fullscreen/.test(document.getElementById("viewer-fullscreen").textContent), { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const fsImg = await page.$eval("#viewer-stage .media-wrap img", (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const fsClient = await page.target().createCDPSession();
  const fx = fsImg.left + fsImg.width / 2;
  const fy = fsImg.top + fsImg.height / 2;
  await touch(fsClient, "touchStart", [[fx - 30, fy], [fx + 30, fy]]);
  for (let step = 1; step <= 6; step++) await touch(fsClient, "touchMove", [[fx - 30 - step * 12, fy], [fx + 30 + step * 12, fy]]);
  await touch(fsClient, "touchEnd", []);
  const fsGeo = await noteGeometry(page);
  assert.match(fsGeo.wrapTransform, /scale\(/, "pinch zoom works in fullscreen");
  assert.ok(fsGeo.img.width > fsImg.width * 1.5);
  assertAligned(fsGeo, "fullscreen zoomed");
  await shot(page, "fullscreen");
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement, { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById("viewer-fullscreen").textContent === "⛶ Fullscreen", { timeout: 5000 });
  assert.equal(await page.$eval("#viewer-stage .media-wrap", (el) => el.style.transform || "none").then((t) => /scale\(1\)|none|^$/.test(t)), true, "zoom resets after fullscreen");
  log("PASS Fullscreen puts the media fullscreen, pinch zoom still works with notes aligned, and exiting resets the zoom");

  // Details at the bottom.
  await page.$eval("#viewer-details", (el) => el.scrollIntoView({ block: "end" }));
  await shot(page, "details");
  const details = await page.$eval("#viewer-details", (el) => ({
    text: el.textContent,
    links: [...el.querySelectorAll("a")].map((a) => ({ href: a.href, rel: a.rel })),
    scripts: el.querySelectorAll("script").length,
  }));
  for (const piece of ["mock_artist", "mock_uploader", "PNG", "600 × 400", "121 KB", "Safe", "500", "0123456789abcdef0123456789abcdef", "A safe test post."]) {
    assert.ok(details.text.includes(piece), "details missing " + piece);
  }
  assert.equal(details.scripts, 0);
  assert.ok(details.links.some((l) => l.href === "https://example.com/art/1" && /noopener/.test(l.rel)));
  assert.ok(details.links.every((l) => /^https?:/.test(l.href)), "no unsafe links in details");
  log("PASS details show artist, uploader, date, file info, sources, rating, ID, MD5, and description");

  // Tag colors by category in the viewer.
  const artistColor = await page.$eval('#viewer-tags .tag-row[data-tag="mock_artist"] .tag-name', (el) => getComputedStyle(el).color);
  assert.equal(artistColor, "rgb(242, 172, 8)");
  const groupColors = await page.$$eval("#viewer-tags .tag-row", (rows) => rows.map((r) => r.dataset.category));
  assert.ok(groupColors.includes("species") && groupColors.includes("meta"));
  log("PASS viewer tags are colored by category");

  // Long-press a tag (real touch, held ~700ms): menu opens, the tap action does not run.
  const searchBefore = await page.$eval("#search", (el) => el.value);
  const cdp = await page.target().createCDPSession();
  await page.$eval('#viewer-tags .tag-row[data-tag="canine"] .tag-name', (el) => el.scrollIntoView({ block: "center" }));
  const spotTag = await page.$eval('#viewer-tags .tag-row[data-tag="canine"] .tag-name', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await touch(cdp, "touchStart", [[spotTag.x, spotTag.y]]);
  await new Promise((resolve) => setTimeout(resolve, 700));
  await touch(cdp, "touchEnd", []);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await page.$eval("#tag-menu", (el) => el.open), true, "long-press opens the tag menu");
  assert.equal(await page.$eval("#viewer", (el) => el.open), true, "long-press must not run the tap (viewer stays open)");
  assert.equal(await page.$eval("#search", (el) => el.value), searchBefore, "long-press must not change the search");
  const menu = await page.$eval("#tag-menu", (el) => ({ title: el.querySelector("#tag-menu-title").textContent, buttons: [...el.querySelectorAll("[data-tag-action]")].map((b) => b.textContent) }));
  assert.equal(menu.title, "canine");
  assert.deepEqual(menu.buttons.slice(0, 5), ["Copy tag name", "Add to blacklist", 'Add as "or" (~tag)', "Open wiki", "Search only this tag"]);
  const callout = await page.$eval('#viewer-tags .tag-row[data-tag="canine"] .tag-name', (el) => {
    const cs = getComputedStyle(el);
    return { select: cs.userSelect || cs.webkitUserSelect, callout: cs.webkitTouchCallout || "" };
  });
  assert.equal(callout.select, "none");
  await shot(page, "tag-menu");
  log("PASS touch long-press opens the tag menu without firing the tap or selecting text");

  await page.$eval('#tag-menu [data-tag-action="copy"]', (el) => el.click());
  await page.waitForFunction(() => /canine/.test(document.getElementById("tag-menu-status").textContent), { timeout: 5000 });
  await page.$eval('#tag-menu [data-tag-action="blacklist"]', (el) => el.click());
  await page.waitForFunction(() => document.querySelector('#tag-menu [data-tag-action="blacklist"]').textContent === "Remove from blacklist", { timeout: 5000 });
  assert.ok((await page.$$eval("#blacklist-list li span", (els) => els.map((e) => e.textContent))).includes("canine"));
  await page.$eval('#tag-menu [data-tag-action="blacklist"]', (el) => el.click());
  await page.waitForFunction(() => document.querySelector('#tag-menu [data-tag-action="blacklist"]').textContent === "Add to blacklist", { timeout: 5000 });
  assert.equal((await page.$$eval("#blacklist-list li span", (els) => els.map((e) => e.textContent))).includes("canine"), false);
  await page.$eval('#tag-menu [data-tag-action="close"]', (el) => el.click());
  log("PASS tag menu copies the name and adds/removes the tag from the blacklist");

  // Right-click (desktop) opens the menu too; "?" opens the wiki.
  await page.$eval('#viewer-tags .tag-row[data-tag="fox"] .tag-name', (el) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  assert.equal(await page.$eval("#tag-menu", (el) => el.open), true);
  assert.equal(await page.$eval("#tag-menu-title", (el) => el.textContent), "fox");
  await page.$eval('#tag-menu [data-tag-action="close"]', (el) => el.click());
  await page.$eval('#viewer-tags .tag-row[data-tag="fox"] .tag-wiki', (el) => el.click());
  await page.waitForSelector("#wiki-dialog[open]");
  assert.equal(await page.$eval("#wiki-title", (el) => el.textContent), "fox");
  await page.$eval("#wiki-close", (el) => el.click());
  assert.equal(await page.$eval("#viewer", (el) => el.open), true, "closing the wiki returns to the post");
  log("PASS right-click opens the tag menu and ? opens the tag's wiki over the post");

  // Comments toggle: hides the section and is remembered on the device.
  await page.$eval("#viewer-comments-toggle", (el) => el.click());
  assert.equal(await page.$eval("#viewer-comments-body", (el) => el.hidden), true);
  assert.equal(await page.$eval("#viewer-comments-toggle", (el) => el.textContent), "Show comments");
  assert.equal(await page.evaluate(() => localStorage.getItem("e621-browser:comments-hidden")), "1");
  await page.$eval("#viewer-comments-toggle", (el) => el.click());
  assert.equal(await page.$eval("#viewer-comments-body", (el) => el.hidden), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("e621-browser:comments-hidden")), "0");
  await page.$eval("#viewer-comments-toggle", (el) => el.click());
  log("PASS Hide comments collapses the section and saves the choice");

  // Favorite while signed out opens the sign-in dialog and sends nothing.
  const writesBefore = calls.filter((c) => c.method !== "GET").length;
  await page.$eval("#viewer-fav", (el) => el.click());
  await page.waitForSelector("#account-dialog[open]", { timeout: 5000 });
  assert.equal(calls.filter((c) => c.method !== "GET").length, writesBefore);
  log("PASS favorite while signed out opens the sign-in dialog");

  // Sign in (mock) and favorite, vote, unvote, unfavorite.
  await page.$eval("#auth-user", (el) => { el.value = "mock_user"; });
  await page.$eval("#auth-key", (el) => { el.value = "mock_key_123"; });
  await page.$eval("#auth-save", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("account-btn").textContent.trim() === "mock_user", { timeout: 10000 });
  await page.$eval("#account-close", (el) => el.click());

  await page.$eval("#viewer-fav", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("viewer-fav").getAttribute("aria-pressed") === "true", { timeout: 10000 });
  const fav = calls.find((c) => c.method === "POST" && c.path === "/favorites.json");
  assert.equal(new URLSearchParams(fav.body).get("post_id"), "500");
  assert.match(fav.auth, /^Basic /);
  assert.match(await page.$eval("#viewer-stats .stat-fav", (el) => el.textContent), /6/);

  await page.$eval("#viewer-up", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("viewer-up").getAttribute("aria-pressed") === "true", { timeout: 10000 });
  let vote = calls.filter((c) => c.path === "/posts/500/votes.json").at(-1);
  assert.equal(new URLSearchParams(vote.body).get("score"), "1");
  assert.equal(new URLSearchParams(vote.body).get("no_unvote"), "true");
  assert.match(await page.$eval("#viewer-stats .stat-score", (el) => el.textContent), /9/);

  await page.$eval("#viewer-down", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("viewer-down").getAttribute("aria-pressed") === "true", { timeout: 10000 });
  assert.equal(await page.$eval("#viewer-up", (el) => el.getAttribute("aria-pressed")), "false");

  await page.$eval("#viewer-down", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("viewer-down").getAttribute("aria-pressed") === "false", { timeout: 10000 });
  vote = calls.filter((c) => c.path === "/posts/500/votes.json").at(-1);
  assert.equal(new URLSearchParams(vote.body).get("no_unvote"), null, "same direction again removes the vote");

  await page.$eval("#viewer-fav", (el) => el.click());
  await page.waitForFunction(() => document.getElementById("viewer-fav").getAttribute("aria-pressed") === "false", { timeout: 10000 });
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === "/favorites/500.json"));
  await page.$eval("#viewer-stage", (el) => el.scrollIntoView());
  await shot(page, "signed-in");
  log("PASS signed-in favorite, upvote, downvote, unvote, and unfavorite send the right requests and update the bar");

  // Add comment while signed in: preview, a validation error inline, then success.
  if (await page.$eval("#viewer-comments-body", (el) => el.hidden)) await page.$eval("#viewer-comments-toggle", (el) => el.click());
  await page.$eval("#viewer-comments", (el) => el.scrollIntoView());
  await page.waitForFunction(() => document.querySelectorAll("#viewer-comments .comment").length === 2, { timeout: 15000 });
  await page.$eval("#comment-add", (el) => el.click());
  assert.equal(await page.$eval("#comment-form", (el) => el.hidden), false);
  await page.type("#comment-text", "x");
  await page.$eval("#comment-post", (el) => el.click());
  await page.waitForFunction(() => /too short/i.test(document.getElementById("comment-status").textContent), { timeout: 10000 });
  assert.equal(await page.$eval("#comment-status", (el) => el.dataset.kind), "error");
  assert.equal(await page.$$eval("#viewer-comments .comment", (els) => els.length), 2, "failed comment is not added");
  await page.$eval("#comment-text", (el) => { el.value = ""; });
  await page.type("#comment-text", "[b]Hello[/b] from the test <i>raw</i>");
  await page.$eval("#comment-preview-btn", (el) => el.click());
  const cpreview = await page.$eval("#comment-preview", (el) => ({ hidden: el.hidden, bold: el.querySelector("strong, b") ? el.querySelector("strong, b").textContent : "", raw: Boolean(el.querySelector("i")) }));
  assert.equal(cpreview.hidden, false);
  assert.equal(cpreview.bold, "Hello");
  assert.equal(cpreview.raw, false, "preview never renders raw HTML");
  await shot(page, "add-comment");
  await page.$eval("#comment-post", (el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll("#viewer-comments .comment").length === 3, { timeout: 10000 });
  const posted = calls.filter((c) => c.method === "POST" && c.path === "/comments.json").at(-1);
  const postedBody = new URLSearchParams(posted.body);
  assert.equal(postedBody.get("comment[post_id]"), "500");
  assert.equal(postedBody.get("comment[body]"), "[b]Hello[/b] from the test <i>raw</i>");
  assert.match(posted.auth, /^Basic /);
  const lastComment = await page.$eval("#viewer-comments .comment:last-of-type", (el) => ({ author: el.querySelector(".comment-author").textContent, id: el.dataset.id }));
  assert.deepEqual(lastComment, { author: "mock_user", id: "10" });
  assert.equal(await page.$eval("#viewer-comments-title", (el) => el.textContent), "Comments (3)");
  assert.equal(await page.$eval("#comment-form", (el) => el.hidden), true);
  assert.equal(await page.$eval("#comment-add", (el) => el.hidden), false);
  log("PASS Add comment posts comment[post_id] and comment[body], shows errors inline, previews DText safely, and appends the new comment");

  await page.$eval("#viewer-comments-toggle", (el) => el.click());
  assert.equal(await page.evaluate(() => localStorage.getItem("e621-browser:comments-hidden")), "1");
  await page.$eval("#viewer-close", (el) => el.click());
  await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 5000 });

  // Account dropdown.
  assert.equal(await page.$eval("#account-btn", (el) => el.getAttribute("aria-haspopup")), "menu");
  await page.click("#account-btn");
  await page.waitForSelector("#account-menu:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#account-menu-avatar img"), { timeout: 10000 });
  const dropdown = await page.evaluate(() => {
    const menu = document.getElementById("account-menu");
    const cs = getComputedStyle(menu);
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const avatar = document.querySelector("#account-menu-avatar img").getBoundingClientRect();
    const nameBox = document.getElementById("account-menu-name").getBoundingClientRect();
    return {
      expanded: document.getElementById("account-btn").getAttribute("aria-expanded"),
      focused: document.activeElement.id,
      ids: items.map((el) => el.id),
      stacked: items.every((el, i) => i === 0 || el.getBoundingClientRect().top >= items[i - 1].getBoundingClientRect().bottom - 1),
      border: cs.borderTopColor,
      glow: cs.boxShadow,
      profileBg: getComputedStyle(items[0]).backgroundColor,
      favBg: getComputedStyle(items[1]).backgroundImage,
      logoutBg: getComputedStyle(items[2]).backgroundImage,
      avatarLeft: avatar.right <= nameBox.left,
      avatarSrc: document.querySelector("#account-menu-avatar img").getAttribute("src"),
      name: document.getElementById("account-menu-name").textContent,
    };
  });
  assert.equal(dropdown.expanded, "true");
  assert.equal(dropdown.focused, "account-menu-profile");
  assert.deepEqual(dropdown.ids, ["account-menu-profile", "account-menu-favorites", "account-menu-logout"]);
  assert.equal(dropdown.stacked, true);
  assert.equal(dropdown.border, "rgb(0, 0, 0)", "black border");
  assert.match(dropdown.glow, /rgba\(92, 0, 14/, "deep red glow");
  assert.equal(dropdown.profileBg, "rgb(122, 12, 30)", "deep crimson account button");
  assert.match(dropdown.favBg, /^linear-gradient\(90deg, rgb\(122, 12, 30\) 0%, rgb\(78, 7, 18\) 100%\)$/, "favorites: crimson to deeper crimson");
  assert.match(dropdown.logoutBg, /^linear-gradient\(90deg, rgb\(78, 7, 18\) 0%, .*rgb\(14, 1, 3\) 100%\)$/, "log out: slow gradient deeper");
  assert.equal(dropdown.avatarLeft, true, "profile picture on the left of the name");
  assert.equal(dropdown.avatarSrc, IMG_URL, "avatar is the avatar post's thumbnail");
  assert.equal(dropdown.name, "mock_user");
  const avatarCall = calls.filter((c) => c.path === "/posts.json" && /id:500/.test(c.params.tags || "")).at(-1);
  assert.ok(avatarCall, "avatar post fetched by id");
  await shot(page, "account-menu");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.id), "account-menu-favorites");
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval("#account-menu", (el) => el.hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "account-btn");
  assert.equal(await page.$eval("#account-btn", (el) => el.getAttribute("aria-expanded")), "false");
  await page.click("#account-btn");
  await page.waitForSelector("#account-menu:not([hidden])");
  const outside2 = await page.$eval("#status", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 5, y: r.top + r.height / 2 }; });
  await page.mouse.click(outside2.x, outside2.y);
  assert.equal(await page.$eval("#account-menu", (el) => el.hidden), true);
  log("PASS account dropdown: avatar + name, Favorites, Log out stacked in a black box with a deep red glow; Esc and outside taps close it");

  // Favorites from the dropdown.
  let postsBefore = calls.filter((c) => c.path === "/posts.json").length;
  await page.click("#account-btn");
  await page.waitForSelector("#account-menu:not([hidden])");
  await page.click("#account-menu-favorites");
  await waitPostsCall(page, calls, postsBefore);
  assert.match(lastPostsTags(calls), /(^|\s)fav:mock_user(\s|$)/);
  assert.equal(await page.$eval('[data-sub="favorites"]', (el) => el.getAttribute("aria-selected")), "true");
  log("PASS dropdown Favorites opens your favorites");

  // Profile page.
  await page.click("#account-btn");
  await page.waitForSelector("#account-menu:not([hidden])");
  await page.click("#account-menu-profile");
  await page.waitForSelector("#profile-dialog[open]");
  await page.waitForFunction(() => document.querySelectorAll("#profile-stats .profile-stat").length > 0, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll("#profile-sections .profile-thumb").length >= 4, { timeout: 20000 });
  const profile = await page.evaluate(() => ({
    name: document.getElementById("profile-name").textContent,
    level: document.getElementById("profile-level").textContent,
    joined: document.getElementById("profile-joined").textContent,
    stats: [...document.querySelectorAll("#profile-stats .profile-stat")].map((el) => el.querySelector("dt").textContent + "=" + el.querySelector("dd").textContent),
    sections: [...document.querySelectorAll("#profile-sections .profile-section")].map((el) => el.dataset.key),
    about: document.getElementById("profile-about").textContent,
    aboutBold: Boolean(document.querySelector("#profile-about strong, #profile-about b")),
    scripts: document.querySelectorAll("#profile-dialog script").length,
    open: document.getElementById("profile-open").href,
    avatar: document.querySelector("#profile-avatar img")?.getAttribute("src") || "",
  }));
  assert.equal(profile.name, "mock_user");
  assert.equal(profile.level, "Member");
  assert.match(profile.joined, /^Joined .*2020/);
  assert.ok(profile.stats.includes("Uploads=12") && profile.stats.includes("Favorites=34") && profile.stats.includes("Comments=5"), profile.stats.join(", "));
  assert.deepEqual(profile.sections, ["uploads", "favorites", "upvoted", "downvoted"]);
  assert.equal(profile.aboutBold, true);
  assert.equal(profile.scripts, 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(profile.open, "https://e621.net/users/42");
  assert.equal(profile.avatar, IMG_URL);
  for (const q of ["user:mock_user", "fav:mock_user", "votedup:mock_user", "voteddown:mock_user"]) {
    assert.ok(calls.some((c) => c.path === "/posts.json" && (c.params.tags || "").split(" ").includes(q)), "profile strip for " + q);
  }
  await shot(page, "profile");
  postsBefore = calls.filter((c) => c.path === "/posts.json").length;
  await page.$eval('#profile-sections .profile-section[data-key="uploads"] .profile-see-all', (el) => el.click());
  await waitPostsCall(page, calls, postsBefore);
  assert.equal(await page.$eval("#profile-dialog", (el) => el.open), false);
  assert.equal(await page.$eval("#search", (el) => el.value), "user:mock_user");
  log("PASS profile page shows avatar, name, level, join date, stats, About (safe DText), uploads/favorites/votes, and the e621 link");

  // Two-way blacklist sync (all against the mock account).
  await page.click('[data-sub="blacklist"]');
  await page.waitForSelector("#blacklist-panel:not([hidden])");
  const lines = () => page.$$eval("#blacklist-list li span", (els) => els.map((el) => el.textContent));
  await page.waitForFunction(() => /Synced with e621/.test(document.getElementById("blacklist-sync-status").textContent), { timeout: 10000 });
  assert.deepEqual(await lines(), ["gore", "feline rating:e"], "account blacklist merged in on sign-in, lines intact");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0, "nothing written when the lists already match");
  await page.type("#blacklist-add", "scat");
  await page.click("#blacklist-form button[type=submit]");
  const waitPatch = async (n) => {
    const start = Date.now();
    while (calls.filter((c) => c.method === "PATCH").length < n) {
      if (Date.now() - start > 10000) throw new Error("expected PATCH #" + n);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await page.waitForFunction(() => /Synced with e621/.test(document.getElementById("blacklist-sync-status").textContent), { timeout: 10000 });
  };
  await waitPatch(1);
  let patch = calls.filter((c) => c.method === "PATCH").at(-1);
  assert.equal(patch.path, "/users/42.json");
  assert.equal(new URLSearchParams(patch.body).get("user[blacklisted_tags]"), "gore\nfeline rating:e\nscat");
  // Removing a line removes it from the account too.
  await page.$eval('#blacklist-list button[aria-label="Remove gore"]', (el) => el.click());
  await waitPatch(2);
  patch = calls.filter((c) => c.method === "PATCH").at(-1);
  assert.equal(new URLSearchParams(patch.body).get("user[blacklisted_tags]"), "feline rating:e\nscat");
  // A change made on e621 comes in with Sync now, without writing back.
  mock.remoteBlacklist = "feline rating:e\nscat\nfrom_e621";
  const patches = calls.filter((c) => c.method === "PATCH").length;
  await page.click("#blacklist-sync-now");
  await page.waitForFunction(() => [...document.querySelectorAll("#blacklist-list li span")].some((el) => el.textContent === "from_e621"), { timeout: 10000 });
  await page.waitForFunction(() => /Synced with e621/.test(document.getElementById("blacklist-sync-status").textContent), { timeout: 10000 });
  assert.equal(calls.filter((c) => c.method === "PATCH").length, patches);
  assert.deepEqual(await lines(), ["feline rating:e", "scat", "from_e621"]);
  // An account error is shown in the panel and the local list is kept.
  mock.remoteBlacklist = null;
  await page.click("#blacklist-sync-now");
  await page.waitForFunction(() => /sync failed/i.test(document.getElementById("blacklist-sync-status").textContent), { timeout: 10000 });
  assert.equal(await page.$eval("#blacklist-sync-status", (el) => el.dataset.kind), "error");
  assert.deepEqual(await lines(), ["feline rating:e", "scat", "from_e621"]);
  mock.remoteBlacklist = "feline rating:e\nscat\nfrom_e621";
  await shot(page, "blacklist-sync");
  log("PASS blacklist sync: merges the account list on sign-in, PATCHes adds and removes, pulls e621 changes with Sync now, and shows errors");

  // Clean up the local list and log out from the dropdown.
  for (const line of await lines()) {
    await page.$eval(`#blacklist-list button[aria-label="Remove ${line}"]`, (el) => el.click());
  }
  await waitPatch(calls.filter((c) => c.method === "PATCH").length + 1).catch(() => {});
  await page.click("#account-btn");
  await page.waitForSelector("#account-menu:not([hidden])");
  await page.click("#account-menu-logout");
  await page.waitForFunction(() => document.getElementById("account-btn").textContent.trim() === "Sign in", { timeout: 5000 });
  assert.equal(await page.$eval("#account-menu", (el) => el.hidden), true);
  assert.equal(await page.$eval("#account-btn", (el) => el.getAttribute("aria-haspopup")), "dialog");
  await page.click("#account-btn");
  await page.waitForSelector("#account-dialog[open]");
  await page.$eval("#account-close", (el) => el.click());
  log("PASS Log out in the dropdown signs out, and the button opens Sign in again");

  // The hidden-comments choice survives a reload, and hidden comments are not fetched.
  // Forget the age confirmation so the gate (and its safe rating pick) shows again.
  await page.evaluate(() => localStorage.removeItem("e621-browser:age-ok"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#age-confirm");
  await safeOnly(page);
  await page.click("#age-confirm");
  await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
  const commentCallsBefore = calls.filter((c) => c.path === "/comments.json").length;
  await page.click("#grid .thumb");
  await page.waitForSelector("#viewer[open]");
  await page.$eval("#viewer-comments", (el) => el.scrollIntoView());
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(await page.$eval("#viewer-comments-body", (el) => el.hidden), true);
  assert.equal(calls.filter((c) => c.path === "/comments.json").length, commentCallsBefore, "hidden comments are not fetched");
  await page.$eval("#viewer-comments-toggle", (el) => el.click());
  await page.waitForFunction(() => document.querySelectorAll("#viewer-comments .comment").length === 2, { timeout: 15000 });
  log("PASS hidden comments stay hidden after a reload and load when shown again");

  // Menu "or" and "only" actions, using real mouse clicks on the items.
  await page.$eval("#search", (el) => { el.value = "canine"; });
  await page.$eval('#viewer-tags .tag-row[data-tag="fox"] .tag-name', (el) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await page.waitForSelector("#tag-menu[open]");
  await page.click('#tag-menu [data-tag-action="or"]');
  await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 5000 });
  assert.equal(await page.$eval("#search", (el) => el.value), "canine ~fox");
  await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
  await page.click("#grid .thumb");
  await page.waitForSelector("#viewer[open]");
  await page.$eval('#viewer-tags .tag-row[data-tag="solo"] .tag-name', (el) => el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  await page.waitForSelector("#tag-menu[open]");
  await page.click('#tag-menu [data-tag-action="only"]');
  await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 5000 });
  assert.equal(await page.$eval("#search", (el) => el.value), "solo");
  log("PASS tag menu adds a tag as ~or and searches only one tag");

  assert.deepEqual(errors, [], "no page errors");
  log("All viewer extras tests passed.");
} catch (error) {
  failed = true;
  console.error("VIEWER EXTRAS TEST FAILED:", error);
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failed) process.exit(1);
