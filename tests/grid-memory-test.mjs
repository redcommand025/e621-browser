/**
 * Headless Chrome (phone viewport) checks for grid position memory and the
 * pool loading fix:
 *  - open/close a post at a deep scroll keeps the exact offset, all loaded
 *    pages, and makes no new request;
 *  - Next across several posts (into a page that loads more), then Close,
 *    centers and highlights the last-viewed thumb;
 *  - the browser Back button closes the viewer at the same spot;
 *  - pools list -> pool -> post -> close -> Back keeps the pool list's
 *    scroll and loaded pages with no new pools request (also via history Back);
 *  - regression: a pool whose middle chunks have no visible posts keeps
 *    loading to the end, and a long blacklist stays within 40 tags.
 *
 * Every e621 request is answered with mock JSON (rating:s only). Nothing is
 * written to an account and no media is downloaded.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

const IMG = "https://static1.e621.net/data/test/grid-card.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="#335"/></svg>';
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

function makePost(id) {
  return {
    id,
    created_at: "2024-05-01T12:00:00.000-04:00",
    rating: "s",
    uploader_id: 1,
    uploader_name: "mock",
    description: "",
    sources: [],
    files: {
      meta: { md5: "0123456789abcdef0123456789abcdef", ext: "png", size: 1000, has_sample: false },
      original: { width: 150, height: 150, url: IMG + "?o=" + id },
      preview: { width: 150, height: 150, jpg: IMG + "?p=" + id },
      sample: { width: 150, height: 150, jpg: IMG + "?s=" + id },
    },
    stats: { score: { up: 1, down: 0, total: 1 }, fav_count: 0, is_favorited: false, vote: 0, comment_count: 0 },
    flags: {},
    has: { notes: false, parent: false, children: false, active_children: false },
    relationships: { parent_id: null, children: [] },
    pools: [],
    tags: { general: ["solo"] },
  };
}

// Search pages: 24 distinct posts per page.
function searchPage(page) {
  return Array.from({ length: 24 }, (_, i) => makePost(100000 - (page - 1) * 24 - i));
}

// Pools: 100 on page 1 and 100 on page 2, 10 on page 3. Pool 7 is long:
// 200 posts where chunks 2-6 (ids 24..143) are all hidden by the rating
// filter (the server returns nothing for them), the case that stalled.
const LONG_POOL = 7;
const HIDDEN = new Set();
for (let i = 24; i < 144; i++) HIDDEN.add(70000 + i);
function poolPostIds(id) {
  if (id === LONG_POOL) return Array.from({ length: 200 }, (_, i) => 70000 + i);
  return Array.from({ length: 30 }, (_, i) => id * 1000 + i);
}
function makePool(id) {
  const post_ids = poolPostIds(id);
  return { id, name: `mock_pool_${id}`, category: "series", is_active: true, post_count: post_ids.length, post_ids, description: "", creator_name: "mock" };
}
function poolsPage(page) {
  const count = page <= 2 ? 100 : page === 3 ? 10 : 0;
  return Array.from({ length: count }, (_, i) => makePool((page - 1) * 100 + i + 1));
}

function json(request, body, status = 200) {
  request.respond({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
}

async function setupMocks(page, calls) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(IMG)) {
      request.respond({ status: 200, contentType: "image/svg+xml", headers: cors, body: SVG });
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
    calls.push({ method: request.method(), path: parsed.pathname, params: Object.fromEntries(parsed.searchParams) });
    if (request.method() !== "GET") {
      json(request, { error: "writes are not expected in this test" }, 500);
      return;
    }
    if (parsed.pathname === "/posts.json") {
      const tags = parsed.searchParams.get("tags") || "";
      assert.match(tags, /(^|\s)rating:s(\s|$)/, "posts query must be safe only: " + tags);
      const tokens = tags.split(/\s+/).filter(Boolean);
      assert.ok(tokens.length <= 40, `e621 allows 40 tags, got ${tokens.length}`);
      const idToken = tokens.find((t) => t.startsWith("id:"));
      if (idToken) {
        const ids = idToken.slice(3).split(",").map(Number);
        assert.ok(ids.length <= 100, "id: lists are capped at 100");
        return json(request, ids.filter((id) => !HIDDEN.has(id)).map(makePost));
      }
      return json(request, searchPage(Number(parsed.searchParams.get("page") || 1)));
    }
    if (parsed.pathname === "/pools.json") return json(request, poolsPage(Number(parsed.searchParams.get("page") || 1)));
    return json(request, []);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const count = (calls, p) => calls.filter((c) => c.path === p).length;

async function idle(page) {
  await page.waitForFunction(() => !/Loading/i.test(document.getElementById("status").textContent), { timeout: 20000 });
}

async function scrollToBottomUntil(page, predicate, arg, label) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(predicate, arg)) return;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(700);
  }
  const info = await page.evaluate(() => ({ thumbs: document.querySelectorAll("#grid .thumb").length, pools: document.querySelectorAll("#pool-list .pool-item").length, status: document.getElementById("status").textContent, y: window.scrollY, h: document.documentElement.scrollHeight, more: document.getElementById("more").disabled }));
  throw new Error("timed out: " + label + " " + JSON.stringify(info));
}

async function viewerPostId(page) {
  return page.$eval("#viewer-open", (a) => Number((a.getAttribute("href") || "").match(/(\d+)(?!.*\d)/)?.[1]));
}

// A thumb in the middle of the viewport (so a click lands on it).
async function visibleThumbIndex(page, selector = "#grid .thumb") {
  return page.evaluate((sel) => {
    const mid = window.innerHeight / 2;
    let best = null;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 120 || r.top > window.innerHeight - 120) continue;
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (!best || d < best.d) best = { d, index: el.dataset.index, poolId: el.dataset.poolId };
    }
    return best;
  }, selector);
}

async function closeAndSettle(page, how = "button") {
  if (how === "button") await page.click("#viewer-close");
  else if (how === "escape") await page.keyboard.press("Escape");
  else await page.evaluate(() => history.back());
  await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 5000 });
  await sleep(350);
}

const { server, base } = await startServer();
let browser;
let failed = false;
try {
  browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const browserCdp = await browser.target().createCDPSession();
  await browserCdp.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const calls = [];
  await setupMocks(page, calls);
  // A long (synced-size) blacklist: 45 single tags.
  await page.evaluateOnNewDocument(() => {
    if (!sessionStorage.getItem("grid-test-seeded")) {
      localStorage.setItem("e621-browser:blacklist", JSON.stringify(Array.from({ length: 45 }, (_, i) => "mock_black_" + i)));
      sessionStorage.setItem("grid-test-seeded", "1");
    }
  });
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#age-confirm");
  await page.evaluate(() => {
    for (const [id, on] of [["rating-s", true], ["rating-q", false], ["rating-e", false]]) {
      const box = document.getElementById(id);
      if (box.checked !== on) {
        box.checked = on;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
  await page.click("#age-confirm");
  await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length >= 24, { timeout: 20000 });
  await idle(page);
  console.log("PASS a 45-tag blacklist search stays within e621's 40-tag limit");

  // 1. Deep scroll: load 3 pages, open a post, close: same pixel, no refetch.
  await scrollToBottomUntil(page, () => document.querySelectorAll("#grid .thumb").length >= 72, null, "3 pages");
  await idle(page);
  await page.evaluate(() => window.scrollTo(0, 3000));
  await sleep(400);
  const deep = await page.evaluate(() => ({ y: window.scrollY, n: document.querySelectorAll("#grid .thumb").length }));
  assert.ok(deep.y >= 2900, "expected a deep scroll, got " + deep.y);
  for (const how of ["button", "escape", "back"]) {
    const postsBefore = count(calls, "/posts.json");
    const target = await visibleThumbIndex(page);
    await page.click(`#grid .thumb[data-index="${target.index}"]`);
    await page.waitForFunction(() => document.getElementById("viewer").open, { timeout: 5000 });
    await sleep(300);
    await closeAndSettle(page, how);
    const after = await page.evaluate(() => ({ y: window.scrollY, n: document.querySelectorAll("#grid .thumb").length, href: location.href }));
    assert.ok(Math.abs(after.y - deep.y) <= 1, `${how}: scroll ${deep.y} -> ${after.y}`);
    assert.equal(after.n, deep.n, `${how}: thumbs kept`);
    assert.equal(count(calls, "/posts.json"), postsBefore, `${how}: no refetch on close`);
    assert.equal(after.href, base + "/", `${how}: URL unchanged`);
  }
  console.log(`PASS open/close at scrollY ${deep.y} keeps the exact spot and all ${deep.n} thumbs (Close, Esc, browser Back), no refetch`);

  // 2. Next across several posts into a page that loads more, then close.
  {
    // Stay far from the infinite-scroll sentinel and open the second-to-last
    // thumb with a plain click, so no page loads before the viewer opens.
    await page.evaluate(() => window.scrollTo(0, 1000));
    let n = -1;
    for (let stable = 0; stable < 3; ) {
      await sleep(500);
      await idle(page);
      const now = await page.$$eval("#grid .thumb", (els) => els.length);
      stable = now === n ? stable + 1 : 0;
      n = now;
    }
    const postsBefore = count(calls, "/posts.json");
    await page.evaluate((i) => document.querySelector(`#grid .thumb[data-index="${i}"]`).click(), n - 2);
    await page.waitForFunction(() => document.getElementById("viewer").open, { timeout: 5000 });
    for (let k = 0; k < 4; k++) {
      const before = await viewerPostId(page);
      await page.click("#viewer-next");
      await page.waitForFunction((b) => {
        const href = document.getElementById("viewer-open").getAttribute("href") || "";
        return !href.endsWith("/" + b) && !document.getElementById("viewer-next").disabled;
      }, { timeout: 15000 }, before);
    }
    const lastId = await viewerPostId(page);
    assert.ok(count(calls, "/posts.json") > postsBefore, "Next past the end loaded another page");
    await closeAndSettle(page);
    const res = await page.evaluate((id) => {
      const thumbs = [...document.querySelectorAll("#grid .thumb")];
      const thumb = thumbs.find((el) => el.querySelector("img")?.src.includes("p=" + id));
      if (!thumb) return null;
      const r = thumb.getBoundingClientRect();
      return { n: thumbs.length, index: Number(thumb.dataset.index), center: r.top + r.height / 2, recent: thumb.classList.contains("thumb-recent"), focused: document.activeElement === thumb };
    }, lastId);
    assert.ok(res, "last-viewed thumb is in the grid");
    assert.equal(res.index, n + 2, "4 Nexts from index " + (n - 2));
    assert.ok(Math.abs(res.center - 422) < 60, "last-viewed thumb centered, center at " + res.center);
    assert.ok(res.recent, "last-viewed thumb is highlighted");
    assert.ok(res.focused, "focus moved to the last-viewed thumb");
    console.log(`PASS Next x4 across a page load, then Close centers and highlights thumb #${res.index} (${res.n} thumbs kept)`);
  }

  // 3. Pools: list -> scroll deep (2 pages) -> pool -> post -> close -> Back.
  await page.click('[data-view="pools"]');
  await page.waitForFunction(() => document.querySelectorAll("#pool-list .pool-item").length >= 100, { timeout: 20000 });
  await idle(page);
  await scrollToBottomUntil(page, () => document.querySelectorAll("#pool-list .pool-item").length >= 200, null, "2 pool pages");
  await idle(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
  await sleep(400);
  const list = await page.evaluate(() => ({ y: window.scrollY, n: document.querySelectorAll("#pool-list .pool-item").length }));
  for (const how of ["button", "history"]) {
    const poolsBefore = count(calls, "/pools.json");
    const pick = await visibleThumbIndex(page, "#pool-list .pool-item");
    await page.click(`#pool-list .pool-item[data-pool-id="${pick.poolId}"]`);
    await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length >= 24 && !document.getElementById("pool-nav").hidden, { timeout: 15000 });
    await idle(page);
    assert.ok((await page.evaluate(() => window.scrollY)) < 400, "a pool opens at its top");
    // Pool grid keeps its spot across a post open/close.
    await page.evaluate(() => window.scrollTo(0, 600));
    await sleep(300);
    const gy = await page.evaluate(() => window.scrollY);
    const t = await visibleThumbIndex(page);
    await page.click(`#grid .thumb[data-index="${t.index}"]`);
    await page.waitForFunction(() => document.getElementById("viewer").open, { timeout: 5000 });
    await closeAndSettle(page);
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - gy) <= 1, "pool grid kept its spot");
    if (how === "button") await page.click("#pool-back");
    else await page.evaluate(() => history.back());
    await page.waitForFunction(() => !document.getElementById("pool-list").hidden, { timeout: 5000 });
    await sleep(350);
    const back = await page.evaluate((id) => ({
      y: window.scrollY,
      n: document.querySelectorAll("#pool-list .pool-item").length,
      recent: document.querySelector(`#pool-list .pool-item[data-pool-id="${id}"]`).classList.contains("thumb-recent"),
      gridHidden: document.getElementById("grid").hidden,
    }), pick.poolId);
    assert.ok(Math.abs(back.y - list.y) <= 1, `${how}: pool list scroll ${list.y} -> ${back.y}`);
    assert.equal(back.n, list.n, `${how}: loaded pools kept`);
    assert.ok(back.recent, `${how}: opened pool highlighted`);
    assert.ok(back.gridHidden);
    assert.equal(count(calls, "/pools.json"), poolsBefore, `${how}: no pools refetch on Back`);
  }
  console.log(`PASS pools list (${list.n} pools, scrollY ${list.y}) -> pool -> post -> close -> Back keeps the spot without refetching (button and browser Back)`);

  // 4. Regression: a pool with 5 empty chunks in a row keeps loading.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.click(`#pool-list .pool-item[data-pool-id="${LONG_POOL}"]`);
  await page.waitForFunction(() => !document.getElementById("pool-nav").hidden, { timeout: 15000 });
  const expected = 200 - HIDDEN.size;
  await scrollToBottomUntil(page, (want) => document.querySelectorAll("#grid .thumb").length >= want && !/Loading/i.test(document.getElementById("status").textContent), expected, `all ${expected} visible pool posts`);
  const done = await page.evaluate(() => ({ n: document.querySelectorAll("#grid .thumb").length, status: document.getElementById("status").textContent }));
  assert.equal(done.n, expected);
  console.log(`PASS a pool with 120 hidden posts in a row loads all ${done.n} visible posts (${done.status})`);

  assert.deepEqual(errors, []);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  if (browser) await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
