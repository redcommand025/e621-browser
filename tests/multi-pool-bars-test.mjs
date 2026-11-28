/**
 * Headless Chrome (phone viewport) checks that a post in several pools
 * gets one pool bar per pool, each with <<First / <Prev / name / Next> / Last>>,
 * and that First/Last jump to the first or last viewable post in that pool
 * (skipping posts hidden by the rating filter).
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

const IMG = "https://static1.e621.net/data/test/pool-bar-card.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="#335"/></svg>';
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

// Posts hidden by the rating filter (returned empty from id: lookups).
const HIDDEN = new Set([301]);

const POOLS = {
  11: { id: 11, name: "Alpha_Series", category: "series", is_active: true, post_ids: [101, 102, 103, 104], post_count: 4, description: "", creator_name: "mock" },
  12: { id: 12, name: "Beta_Collection", category: "collection", is_active: true, post_ids: [201, 202, 101, 203, 204], post_count: 5, description: "", creator_name: "mock" },
  13: { id: 13, name: "Gamma_Mini", category: "series", is_active: true, post_ids: [301, 104, 305], post_count: 3, description: "", creator_name: "mock" },
};

const MEMBERSHIP = {
  101: [11, 12],
  102: [11],
  103: [11],
  104: [11, 13],
  201: [12],
  202: [12],
  203: [12],
  204: [12],
  301: [13],
  305: [13],
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
    pools: MEMBERSHIP[id] || [],
    tags: { general: ["solo"] },
  };
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
      return json(request, [makePost(101), makePost(102), makePost(103)]);
    }
    if (parsed.pathname === "/pools.json") {
      const idParam = parsed.searchParams.get("search[id]");
      if (idParam) {
        const ids = idParam.split(",").map(Number);
        return json(request, ids.map((id) => POOLS[id]).filter(Boolean));
      }
      return json(request, Object.values(POOLS));
    }
    return json(request, []);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function idle(page) {
  await page.waitForFunction(() => !/Loading/i.test(document.getElementById("status").textContent), { timeout: 20000 });
}

async function viewerPostId(page) {
  return page.$eval("#viewer-open", (a) => Number((a.getAttribute("href") || "").match(/(\d+)(?!.*\d)/)?.[1]));
}

async function waitForPost(page, id) {
  await page.waitForFunction((want) => {
    const href = document.getElementById("viewer-open")?.getAttribute("href") || "";
    return href.includes("/posts/" + want);
  }, { timeout: 15000 }, id);
  await sleep(200);
}

async function barState(page) {
  return page.evaluate(() => {
    const bars = [...document.querySelectorAll("#viewer-pool-bars .viewer-pool-bar:not([hidden])")];
    return {
      mode: document.getElementById("viewer").dataset.bars,
      searchHidden: document.getElementById("viewer-search-bar").hidden,
      count: bars.length,
      firstHasLegacyIds: !!(
        document.getElementById("viewer-pool-bar") &&
        document.getElementById("viewer-pool-first") &&
        document.getElementById("viewer-pool-prev") &&
        document.getElementById("viewer-pool-name") &&
        document.getElementById("viewer-pool-next") &&
        document.getElementById("viewer-pool-last")
      ),
      firstLabel: document.getElementById("viewer-pool-first")?.textContent.replace(/\s+/g, "") || "",
      lastLabel: document.getElementById("viewer-pool-last")?.textContent.replace(/\s+/g, "") || "",
      bars: bars.map((bar) => ({
        id: Number(bar.dataset.poolId),
        name: bar.querySelector(".viewer-pool-name")?.textContent.trim() || "",
        first: bar.querySelector(".viewer-pool-first")?.disabled ?? null,
        prev: bar.querySelector(".viewer-pool-prev")?.disabled ?? null,
        next: bar.querySelector(".viewer-pool-next")?.disabled ?? null,
        last: bar.querySelector(".viewer-pool-last")?.disabled ?? null,
      })),
    };
  });
}

async function clickBar(page, poolId, kind) {
  const selector = `.viewer-pool-bar[data-pool-id="${poolId}"] .viewer-pool-${kind}`;
  await page.waitForSelector(selector);
  await page.click(selector);
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
  await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
  await idle(page);

  // Open the post that belongs to two pools.
  await page.click("#grid .thumb[data-index='0']");
  await page.waitForFunction(() => document.getElementById("viewer").open, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll("#viewer-pool-bars .viewer-pool-bar:not([hidden])").length === 2, { timeout: 15000 });

  let info = await barState(page);
  assert.equal(info.mode, "both");
  assert.equal(info.searchHidden, false);
  assert.equal(info.count, 2);
  assert.equal(info.firstHasLegacyIds, true);
  assert.equal(info.firstLabel, "<<First");
  assert.equal(info.lastLabel, "Last>>");
  assert.deepEqual(info.bars.map((b) => b.name), ["Alpha Series", "Beta Collection"]);
  assert.equal(info.bars[0].id, 11);
  assert.equal(info.bars[0].first, true, "First disabled at the start of Alpha");
  assert.equal(info.bars[0].prev, true);
  assert.equal(info.bars[0].next, false);
  assert.equal(info.bars[0].last, false);
  assert.equal(info.bars[1].id, 12);
  assert.equal(info.bars[1].first, false, "Beta has posts before 101");
  assert.equal(info.bars[1].prev, false);
  assert.equal(info.bars[1].next, false);
  assert.equal(info.bars[1].last, false);
  console.log("PASS a post in two pools shows two bars; First/Prev are disabled only on the pool it starts");

  // Last on Alpha jumps to 104; Beta is replaced by Gamma.
  await clickBar(page, 11, "last");
    await waitForPost(page, 104);
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll("#viewer-pool-bars .viewer-pool-bar:not([hidden]) .viewer-pool-name")].map((el) => el.textContent.trim());
    return names.includes("Gamma Mini") && names.includes("Alpha Series") && names.length === 2;
  }, { timeout: 15000 });
  info = await barState(page);
  assert.equal(await viewerPostId(page), 104);
  assert.deepEqual(info.bars.map((b) => b.name), ["Alpha Series", "Gamma Mini"]);
  const alpha = info.bars.find((b) => b.id === 11);
  assert.equal(alpha.next, true);
  assert.equal(alpha.last, true);
  assert.equal(alpha.first, false);
  assert.equal(alpha.prev, false);
  console.log("PASS Last>> on Alpha opens its last post and the bars match that post's pools");

  // First on Alpha returns to 101 and both original bars.
  await clickBar(page, 11, "first");
  await waitForPost(page, 101);
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll("#viewer-pool-bars .viewer-pool-bar:not([hidden]) .viewer-pool-name")].map((el) => el.textContent.trim());
    return names[0] === "Alpha Series" && names[1] === "Beta Collection" && names.length === 2;
  }, { timeout: 15000 });
  assert.equal(await viewerPostId(page), 101);
  console.log("PASS <<First on Alpha returns to its first post");

  // Last on Beta (the second bar) jumps to 204; only Beta remains.
  await clickBar(page, 12, "last");
  await waitForPost(page, 204);
  await page.waitForFunction(() => {
    const bars = document.querySelectorAll("#viewer-pool-bars .viewer-pool-bar:not([hidden])");
    return bars.length === 1 && bars[0].querySelector(".viewer-pool-name")?.textContent.trim() === "Beta Collection";
  }, { timeout: 15000 });
  info = await barState(page);
  assert.equal(await viewerPostId(page), 204);
  assert.equal(info.count, 1);
  assert.equal(info.bars[0].last, true);
  assert.equal(info.bars[0].next, true);
  assert.equal(info.bars[0].first, false);
  await clickBar(page, 12, "first");
  await waitForPost(page, 201);
  info = await barState(page);
  assert.equal(await viewerPostId(page), 201);
  assert.equal(info.bars[0].first, true);
  assert.equal(info.bars[0].prev, true);
  console.log("PASS First/Last on the second bar move only within that pool");

  // Hidden leading post in Gamma is skipped: Last to 104 via Alpha, First on Gamma stays on 104.
  await clickBar(page, 12, "next");
  await waitForPost(page, 202);
  await clickBar(page, 12, "next");
  await waitForPost(page, 101);
  await clickBar(page, 11, "last");
  await waitForPost(page, 104);
  await page.waitForFunction(() => document.querySelector('.viewer-pool-bar[data-pool-id="13"]'), { timeout: 10000 });
  await clickBar(page, 13, "first");
  await sleep(800);
  assert.equal(await viewerPostId(page), 104, "First on Gamma skips the hidden leading post");
  info = await barState(page);
  const gamma = info.bars.find((b) => b.id === 13);
  assert.ok(gamma, "Gamma bar is present");
  assert.equal(gamma.first, true);
  assert.equal(gamma.prev, true);
  await clickBar(page, 13, "last");
  await waitForPost(page, 305);
  info = await barState(page);
  assert.equal(info.bars.find((b) => b.id === 13).last, true);
  await clickBar(page, 13, "first");
  await waitForPost(page, 104);
  console.log("PASS First/Last skip a post hidden by the rating filter");

  // Tapping the pool name opens that pool's grid (scroll memory must not break this).
  await clickBar(page, 11, "name");
  await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 8000 });
  await page.waitForFunction(() => !document.getElementById("pool-nav").hidden && document.querySelectorAll("#grid .thumb").length > 0, { timeout: 15000 });
  await idle(page);
  const opened = await page.evaluate(() => ({
    title: document.getElementById("pool-title")?.textContent.trim() || "",
    thumbs: document.querySelectorAll("#grid .thumb").length,
    view: document.querySelector('[data-view="pools"]')?.getAttribute("aria-selected"),
  }));
  assert.match(opened.title, /alpha series/i);
  assert.ok(opened.thumbs >= 3, "pool grid loaded, got " + opened.thumbs);
  assert.equal(opened.view, "true");
  console.log("PASS tapping a pool name closes the viewer and opens that pool");

  // Scroll memory still holds in a pool grid after opening/closing a post.
  await page.evaluate(() => window.scrollTo(0, 80));
  await sleep(200);
  const y = await page.evaluate(() => window.scrollY);
  const n = await page.$$eval("#grid .thumb", (els) => els.length);
  await page.click("#grid .thumb[data-index='0']");
  await page.waitForFunction(() => document.getElementById("viewer").open, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll("#viewer-pool-bars .viewer-pool-bar:not([hidden])").length >= 1, { timeout: 10000 });
  await page.click("#viewer-close");
  await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 5000 });
  await sleep(350);
  const after = await page.evaluate(() => ({ y: window.scrollY, n: document.querySelectorAll("#grid .thumb").length }));
  assert.ok(Math.abs(after.y - y) <= 1, `scroll ${y} -> ${after.y}`);
  assert.equal(after.n, n);
  console.log("PASS closing a multi-pool post keeps the pool grid scroll and thumbs");

  assert.deepEqual(errors, []);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  if (browser) await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
