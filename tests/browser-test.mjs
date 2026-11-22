/**
 * Headless Chromium checks. Uses SAFE queries only (rating:s).
 * Does not save media files and does not open explicit posts.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import {
  collectTagsByCategory,
  formatPostStats,
  formatTagCategoryLabel,
  isBlockedTag,
  normalizePostsResponse,
  tagName,
  TAG_CATEGORY_ORDER,
} from "../js/filter.js";
import { buildApiUrl } from "../js/api.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
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
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function isApiRequest(url) {
  return (
    url.startsWith("https://e621.net/posts.json") ||
    url.startsWith("https://e621.net/tags/") ||
    url.startsWith("https://e621.net/pools.json") ||
    url.startsWith("https://e621.net/popular.json")
  );
}

function isUnsafePostsQuery(url) {
  if (!url.startsWith("https://e621.net/posts.json")) return false;
  const parsed = new URL(url);
  const tags = parsed.searchParams.get("tags") || "";
  return !/(^|\s)rating:s(\s|$)/.test(tags);
}

async function withPage(browser, base, setupStorage, fn) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36"
  );
  const apiCalls = [];
  const unsafe = [];
  page.on("request", (request) => {
    const url = request.url();
    if (isApiRequest(url)) apiCalls.push(url);
    if (isUnsafePostsQuery(url)) unsafe.push(url);
  });
  if (setupStorage) await setupStorage(page);
  try {
    await fn(page, { apiCalls, unsafe });
    assert.equal(unsafe.length, 0, `Unsafe posts query used: ${unsafe.join(" | ")}`);
  } finally {
    await context.close();
  }
}

async function waitForCall(listFn, prev, { timeout = 20000, match } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const list = listFn();
    if (list.length > prev) {
      const last = list.at(-1);
      if (!match || match(last)) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for API call");
}


async function blockStorageAndPhone(page) {
  await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await page.setUserAgent(
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36"
  );
  await page.evaluateOnNewDocument(() => {
    const boom = () => { throw new Error("storage blocked"); };
    const fake = {
      getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom,
      get length() { throw new Error("storage blocked"); },
    };
    Object.defineProperty(window, "localStorage", { get: () => fake });
  });
}

async function clickSelector(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.evaluate((sel) => document.querySelector(sel).click(), selector);
}

async function confirmAndUseSafe(page) {
  await page.waitForSelector("#age-confirm");
  assert.equal(await page.$eval("#app", (el) => el.hidden), true);
  await page.select("#rating", "s");
  await page.click("#age-confirm");
  await page.waitForSelector("#app:not([hidden])");
}

const logs = [];
function log(message) {
  logs.push(message);
  console.log(message);
}

const { server, base } = await startServer();
let failures = 0;
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    protocolTimeout: 45000,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  });

  await withPage(browser, base, null, async (page, { apiCalls }) => {
    await page.goto(base + "/", { waitUntil: "networkidle0" });
    await page.waitForSelector("#age-confirm");
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(
      apiCalls.length,
      0,
      `API was called before confirmation: ${apiCalls.join(" | ")}`
    );
    assert.equal(await page.$eval("#age-gate", (el) => el.hidden), false);
    log("PASS gate is shown and no API calls are made before confirmation");
    await confirmAndUseSafe(page);
    await page.waitForFunction(
      () => document.querySelectorAll("#grid .thumb").length > 0 || /No posts found/i.test(document.getElementById("status").textContent),
      { timeout: 20000 }
    );
    const after = apiCalls.filter((url) => url.startsWith("https://e621.net/posts.json"));
    assert.ok(after.length >= 1, "Posts view should auto-load recent posts after confirmation");
    const tags = new URL(after[0]).searchParams.get("tags") || "";
    assert.match(tags, /(^|\s)rating:s(\s|$)/);
    assert.match(tags, /(^|\s)-young(\s|$)/);
    const brand = await page.$eval(".brand", (el) => el.textContent.trim());
    assert.equal(brand, "e621-red");
    assert.equal(await page.$eval('[data-view="posts"]', (el) => el.getAttribute("aria-selected")), "true");
    assert.equal(await page.$eval("#search-form", (el) => el.hidden), false);
    assert.equal(await page.$eval("#sub-nav", (el) => el.hidden), false);
    log("PASS confirmation reveals e621-red, defaults to Posts, and auto-loads recent safe posts");
  });


  await withPage(
    browser,
    base,
    async (page) => {
      await page.setViewport({
        width: 360,
        height: 740,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      });
      await page.setUserAgent(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36"
      );
      await page.evaluateOnNewDocument(() => {
        const boom = () => {
          throw new Error("storage blocked");
        };
        const fake = {
          getItem: boom,
          setItem: boom,
          removeItem: boom,
          clear: boom,
          key: boom,
          get length() {
            throw new Error("storage blocked");
          },
        };
        Object.defineProperty(window, "localStorage", { get: () => fake });
      });
    },
    async (page, { apiCalls }) => {
      await page.goto(base + "/", { waitUntil: "networkidle0" });
      const before = await page.evaluate(() => {
        const declined = document.getElementById("age-declined");
        const cs = getComputedStyle(declined);
        return {
          scrollH: document.documentElement.scrollHeight,
          innerH: window.innerHeight,
          declinedDisplay: cs.display,
          declinedHeight: declined.getBoundingClientRect().height,
          visibleAccess: /access\s+(denied|declined)/i.test(document.body.innerText),
        };
      });
      assert.equal(before.declinedDisplay, "none", "declined overlay must not layout while hidden");
      assert.equal(before.declinedHeight, 0);
      assert.ok(before.scrollH <= before.innerH + 8, `startup page too tall: ${before.scrollH}`);
      assert.equal(before.visibleAccess, false);
      await page.select("#rating", "s");
      await page.click("#age-confirm");
      await page.waitForSelector("#app:not([hidden])");
      const after = await page.evaluate(() => {
        const gate = document.getElementById("age-gate");
        const declined = document.getElementById("age-declined");
        return {
          gateDisplay: getComputedStyle(gate).display,
          declinedDisplay: getComputedStyle(declined).display,
          gateHeight: gate.getBoundingClientRect().height,
          declinedHeight: declined.getBoundingClientRect().height,
          visibleAccess: /access\s+(denied|declined)/i.test(document.body.innerText),
          appHidden: document.getElementById("app").hidden,
          title: document.title,
          brand: document.querySelector(".brand")?.textContent.trim(),
        };
      });
      assert.equal(after.gateDisplay, "none");
      assert.equal(after.declinedDisplay, "none");
      assert.equal(after.gateHeight, 0);
      assert.equal(after.declinedHeight, 0);
      assert.equal(after.appHidden, false);
      assert.equal(after.visibleAccess, false);
      assert.equal(after.title, "e621-red");
      assert.equal(after.brand, "e621-red");
      const posts = apiCalls.filter((url) => url.includes("/posts.json"));
      assert.ok(posts.every((url) => /(^|\s)rating:s(\s|$)/.test(new URL(url).searchParams.get("tags") || "")));
      log("PASS mobile gate hides cleanly and does not leave a tall Access declined screen");
    }
  );


  await withPage(browser, base, null, async (page, { apiCalls }) => {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await confirmAndUseSafe(page);
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, {
      timeout: 20000,
    });
    const count = await page.$$eval("#grid .thumb", (els) => els.length);
    assert.ok(count > 0, "expected thumbnails");
    const postsCalls = apiCalls.filter((url) => url.includes("/posts.json"));
    assert.ok(postsCalls.length >= 1, "expected a posts request");
    for (const url of postsCalls) {
      const tags = new URL(url).searchParams.get("tags") || "";
      assert.match(tags, /(^|\s)-young(\s|$)/);
      assert.match(tags, /(^|\s)rating:s(\s|$)/);
      assert.match(new URL(url).searchParams.get("_client") || "", /e621-browser/);
    }
    log(`PASS safe grid loaded (${count} thumbs) with -young and rating:s`);

    await page.click("#grid .thumb");
    await page.waitForSelector("#viewer[open], dialog.viewer[open]");
    const hasMedia = await page.$eval("#viewer-stage", (el) =>
      Boolean(el.querySelector("img, video"))
    );
    assert.ok(hasMedia, "viewer should show an image or video");
    const href = await page.$eval("#viewer-open", (el) => el.getAttribute("href"));
    assert.match(href, /^https:\/\/e621\.net\/posts\/\d+/);
    log("PASS viewer opened with media and an e621 post link");
    await page.click("#viewer-close");
  });

  await withPage(browser, base, null, async (page, { apiCalls }) => {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await confirmAndUseSafe(page);
    await page.click("#search");
    await page.type("#search", "fox", { delay: 40 });
    await page.waitForSelector("#suggest:not([hidden]) li", { timeout: 15000 });
    const suggestions = await page.$$eval("#suggest li", (els) =>
      els.map((el) => ({
        name: el.dataset.name,
        text: el.textContent,
      }))
    );
    assert.ok(suggestions.length > 0, "expected autocomplete suggestions");
    const blocked = ["young", "loli", "shota", "cub"];
    for (const item of suggestions) {
      const hay = `${item.name} ${item.text}`.toLowerCase();
      for (const tag of blocked) {
        assert.equal(
          hay.split(/\s+/).includes(tag),
          false,
          `blocked tag ${tag} appeared in suggestions`
        );
      }
      assert.match(item.text, /\d/);
    }
    const autoCalls = apiCalls.filter((url) => url.includes("/tags/autocomplete.json"));
    assert.ok(autoCalls.length >= 1, "expected autocomplete request");
    log(`PASS autocomplete suggestions (${suggestions.length}) show counts and omit blocked tags`);
  });

  await withPage(browser, base, null, async (page, { apiCalls }) => {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await confirmAndUseSafe(page);
    await page.select("#sort", "order:score");
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, {
      timeout: 20000,
    });
    const postsCalls = apiCalls.filter((url) => url.includes("/posts.json"));
    const last = postsCalls.at(-1);
    const tags = new URL(last).searchParams.get("tags") || "";
    assert.match(tags, /order:score/);
    assert.match(tags, /(^|\s)-young(\s|$)/);
    log("PASS sorting adds order:score and keeps -young");
  });

  await withPage(browser, base, null, async (page) => {
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    await confirmAndUseSafe(page);
    await page.$eval("#search", (el) => {
      el.value = "";
    });
    await page.type("#search", "type:webm");
    await page.click("button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, {
      timeout: 20000,
    });
    await page.click("#grid .thumb");
    await page.waitForSelector("#viewer-stage video", { timeout: 20000 });
    const result = await page.evaluate(async () => {
      const video = document.querySelector("#viewer-stage video");
      if (!video) return { ok: false, error: "no video element" };
      video.muted = true;
      video.playsInline = true;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      if (video.readyState < 2) {
        await Promise.race([
          new Promise((resolve) => {
            video.addEventListener("loadeddata", resolve, { once: true });
            video.addEventListener("canplay", resolve, { once: true });
            video.addEventListener("error", resolve, { once: true });
          }),
          wait(8000),
        ]);
      }
      let playOutcome = "not-attempted";
      try {
        playOutcome = await Promise.race([
          video.play().then(() => "played"),
          wait(5000).then(() => "play-timeout"),
        ]);
      } catch (error) {
        playOutcome = String(error);
      }
      if (!video.paused) video.pause();
      return {
        ok:
          playOutcome === "played" ||
          video.readyState >= 2 ||
          Boolean(video.videoWidth),
        playOutcome,
        readyState: video.readyState,
        hasSource: Boolean(video.currentSrc || video.querySelector("source")?.src),
        canMp4: video.canPlayType("video/mp4"),
        alts: document.querySelectorAll("#viewer-alts button").length,
      };
    });
    assert.equal(result.hasSource, true, "video should have a source");
    assert.ok(
      result.ok || result.alts > 0,
      `safe video did not become playable and no alternates were offered: ${JSON.stringify(result)}`
    );
    log(`PASS safe video viewer (${JSON.stringify(result)})`);
    await page.click("#viewer-close");
  });

  await withPage(
    browser,
    base,
    async (page) => {
      await page.evaluateOnNewDocument(() => {
        const boom = () => {
          throw new Error("storage blocked");
        };
        const fake = {
          getItem: boom,
          setItem: boom,
          removeItem: boom,
          clear: boom,
          key: boom,
          get length() {
            throw new Error("storage blocked");
          },
        };
        Object.defineProperty(window, "localStorage", { get: () => fake });
      });
    },
    async (page, { apiCalls }) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      const crashed = await page.evaluate(() => document.body && document.getElementById("age-confirm"));
      assert.ok(crashed, "page should render when localStorage throws");
      await confirmAndUseSafe(page);
      const banner = await page.$eval("#storage-banner", (el) => !el.hidden);
      assert.equal(banner, true);
      await page.click("button[type=submit]");
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, {
        timeout: 20000,
      });
      log("PASS storage-blocked mode still loads the gate, banner, and safe grid");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#age-confirm");
      assert.equal(await page.$eval("#app", (el) => el.hidden), true);
      log("PASS 18+ gate reappears after reload when storage is blocked");
      assert.ok(apiCalls.length >= 1);
    }
  );


  await withPage(
    browser,
    base,
    async (page) => {
      await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
      await page.setUserAgent(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36"
      );
    },
    async (page, { apiCalls }) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      const afterConfirm = await page.evaluate(() => ({
        scrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
        gateDisplay: getComputedStyle(document.getElementById("age-gate")).display,
        declinedDisplay: getComputedStyle(document.getElementById("age-declined")).display,
      }));
      assert.equal(afterConfirm.gateDisplay, "none");
      assert.equal(afterConfirm.declinedDisplay, "none");

      await page.click('[data-sub="favorites"]');
      await page.waitForSelector("#favorites-panel:not([hidden])");
      await page.$eval("#fav-user", (el) => { el.value = ""; });
      await page.type("#fav-user", "bitWolfy");
      await page.click("#fav-load");
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      const favCalls = apiCalls.filter((url) => url.includes("/posts.json"));
      assert.ok(favCalls.length >= 1, "expected a favorites request");
      const favTags = new URL(favCalls.at(-1)).searchParams.get("tags") || "";
      assert.match(favTags, /fav:bitWolfy/i);
      assert.match(favTags, /(^|\s)rating:s(\s|$)/);
      assert.match(favTags, /(^|\s)-young(\s|$)/);
      const favBadges = await page.$$eval("#grid .badge", (els) => els.map((el) => el.textContent));
      assert.ok(favBadges.length > 0);
      assert.ok(favBadges.every((b) => b === "S"), `non-safe favorite visible: ${favBadges}`);
      log(`PASS public favorites loaded for bitWolfy (${favBadges.length} safe thumbs)`);

      await page.click('[data-view="pools"]');
      await page.waitForSelector("#pools-panel:not([hidden])");
      await page.$eval("#pool-search", (el) => { el.value = ""; });
      await page.type("#pool-search", "Safety_Plan");
      await page.click("#pool-load");
      await page.waitForFunction(() => document.querySelectorAll("#pool-list .pool-item").length > 0, { timeout: 20000 });
      const poolNames = await page.$$eval("#pool-list .pool-item strong", (els) => els.map((el) => el.textContent.toLowerCase()));
      for (const name of poolNames) {
        for (const tag of ["young", "loli", "shota", "cub"]) {
          assert.equal(name.split(/\s+/).includes(tag), false, `blocked pool listed: ${name}`);
        }
      }
      await page.click("#pool-list .pool-item");
      await page.waitForFunction(
        () => document.querySelectorAll("#grid .thumb").length > 0 || /No viewable posts/i.test(document.getElementById("status").textContent),
        { timeout: 20000 }
      );
      const poolCalls = apiCalls.filter((url) => url.includes("/pools.json"));
      assert.ok(poolCalls.length >= 1, "expected a pools request");
      if (await page.$("#grid .thumb")) {
        const poolBadges = await page.$$eval("#grid .badge", (els) => els.map((el) => el.textContent));
        assert.ok(poolBadges.every((b) => b === "S"));
      }
      log(`PASS pools list and open (${poolNames.length} listed)`);

      await page.click('[data-view="posts"]');
      await page.waitForSelector("#sub-nav:not([hidden])");
      const popularBefore = apiCalls.filter((url) => url.includes("/popular.json")).length;
      await page.click('[data-sub="popular"]');
      await page.waitForSelector("#popular-panel:not([hidden])");
      await page.waitForFunction(
        () => document.querySelectorAll("#grid .thumb").length > 0 || /No viewable popular posts/i.test(document.getElementById("status").textContent),
        { timeout: 20000 }
      );
      let popularCalls = apiCalls.filter((url) => url.includes("/popular.json"));
      assert.ok(popularCalls.length > popularBefore, "expected a popular request");
      let popularUrl = new URL(popularCalls.at(-1));
      assert.equal(popularUrl.searchParams.get("scale"), "day");
      assert.ok(!popularUrl.searchParams.get("tags"));
      const firstDate = popularUrl.searchParams.get("date");
      const rangeText = await page.$eval("#popular-range", (el) => el.textContent);
      assert.match(rangeText, /Day/i);
      const popularBadges = await page.$$eval("#grid .badge", (els) => els.map((el) => el.textContent));
      assert.ok(popularBadges.every((b) => b === "S"), `non-safe popular visible: ${popularBadges}`);

      const nine = await page.$$eval("#popular-grid button", (els) => els.map((el) => el.textContent.trim()));
      assert.deepEqual(nine, ["«prev", "Day", "next»", "«prev", "Week", "next»", "«prev", "Month", "next»"]);

      const popularCount = apiCalls.filter((url) => url.includes("/popular.json")).length;
      await page.click('#popular-grid [data-pop="prev"][data-scale="day"]');
      const afterPrevUrl = await waitForCall(
        () => apiCalls.filter((url) => url.includes("/popular.json")),
        popularCount,
        { match: (url) => new URL(url).searchParams.get("scale") === "day" }
      );
      const afterPrev = new URL(afterPrevUrl);
      assert.equal(afterPrev.searchParams.get("scale"), "day");
      const prevDate = afterPrev.searchParams.get("date");
      assert.ok(prevDate && prevDate <= firstDate, `prev should move the day back: ${firstDate} -> ${prevDate}`);

      const afterPrevCount = apiCalls.filter((url) => url.includes("/popular.json")).length;
      await page.click('#popular-grid [data-pop="scale"][data-scale="week"]');
      const weekUrl = new URL(await waitForCall(
        () => apiCalls.filter((url) => url.includes("/popular.json")),
        afterPrevCount,
        { match: (url) => new URL(url).searchParams.get("scale") === "week" }
      ));
      assert.equal(weekUrl.searchParams.get("scale"), "week");
      const weekRange = await page.$eval("#popular-range", (el) => el.textContent);
      assert.match(weekRange, /Week/i);
      log(`PASS popular 3x3 day/week controls (${popularBadges.length} safe thumbs after client filter)`);

      const hotBefore = apiCalls.filter((url) => url.includes("/posts.json")).length;
      await page.click('[data-sub="hot"]');
      await page.waitForFunction(() => /order:hot/i.test(document.getElementById("search").value), { timeout: 20000 });
      const hotUrl = await waitForCall(
        () => apiCalls.filter((url) => url.includes("/posts.json")),
        hotBefore,
        { match: (url) => /order:hot/i.test(new URL(url).searchParams.get("tags") || "") }
      );
      const hotTags = new URL(hotUrl).searchParams.get("tags") || "";
      assert.match(hotTags, /order:hot/i);
      assert.match(hotTags, /(^|\s)rating:s(\s|$)/);
      assert.match(hotTags, /(^|\s)-young(\s|$)/);
      log("PASS Hot puts order:hot in the search bar and query");

      await page.click('[data-sub="blacklist"]');
      await page.waitForSelector("#blacklist-panel:not([hidden])");
      const locked = await page.$eval("#blacklist-panel", (el) => el.textContent);
      assert.match(locked, /young/);
      assert.match(locked, /loli/);
      await page.$eval("#blacklist-add", (el) => { el.value = ""; });
      await page.type("#blacklist-add", "young");
      await page.click("#blacklist-form button[type=submit]");
      const afterBlocked = await page.$$eval("#blacklist-list li", (els) => els.map((el) => el.textContent));
      assert.equal(afterBlocked.some((text) => /\byoung\b/i.test(text)), false, "hard exclusion must not be a removable blacklist item");
      await page.$eval("#blacklist-add", (el) => { el.value = ""; });
      await page.type("#blacklist-add", "canine");
      await page.click("#blacklist-form button[type=submit]");
      await page.waitForFunction(() => [...document.querySelectorAll("#blacklist-list li")].some((el) => /canine/i.test(el.textContent)));
      log("PASS blacklist adds user tags and keeps hard exclusions locked");

      await page.$eval("#search", (el) => { el.value = ""; });
      await page.type("#search", "canid order:score");
      await page.click('[data-sub="saved"]');
      await page.waitForSelector("#saved-panel:not([hidden])");
      await page.click("#saved-add");
      await page.waitForFunction(() => [...document.querySelectorAll("#saved-list li")].some((el) => /canid order:score/i.test(el.textContent)));
      const beforeSaved = apiCalls.filter((url) => url.includes("/posts.json")).length;
      await page.click("#saved-list li button:not(.secondary)");
      const savedUrl = await waitForCall(
        () => apiCalls.filter((url) => url.includes("/posts.json")),
        beforeSaved,
        { match: (url) => /canid/i.test(new URL(url).searchParams.get("tags") || "") }
      );
      const savedTags = new URL(savedUrl).searchParams.get("tags") || "";
      assert.match(savedTags, /canid/i);
      assert.match(savedTags, /order:score/i);
      assert.match(savedTags, /(^|\s)rating:s(\s|$)/);
      assert.match(savedTags, /(^|\s)-young(\s|$)/);
      log("PASS saved search stores and runs canid order:score");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await page.evaluateOnNewDocument(() => {
        const boom = () => { throw new Error("storage blocked"); };
        const fake = {
          getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom,
          get length() { throw new Error("storage blocked"); },
        };
        Object.defineProperty(window, "localStorage", { get: () => fake });
      });
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.click('[data-sub="blacklist"]');
      await page.waitForSelector("#blacklist-panel:not([hidden])");
      const note = await page.$eval("#blacklist-storage-note", (el) => !el.hidden);
      assert.equal(note, true);
      await page.type("#blacklist-add", "canine");
      await page.click("#blacklist-form button[type=submit]");
      await page.waitForFunction(() => [...document.querySelectorAll("#blacklist-list li")].some((el) => /canine/i.test(el.textContent)));
      await page.$eval("#search", (el) => { el.value = "canid order:score"; });
      await page.click('[data-sub="saved"]');
      await page.waitForSelector("#saved-panel:not([hidden])");
      assert.equal(await page.$eval("#saved-storage-note", (el) => !el.hidden), true);
      await page.click("#saved-add");
      await page.waitForFunction(() => [...document.querySelectorAll("#saved-list li")].some((el) => /canid order:score/i.test(el.textContent)));
      await page.click('[data-sub="favorites"]');
      await page.waitForSelector("#favorites-panel:not([hidden])");
      assert.equal(await page.$eval("#auth-remember-note", (el) => !el.hidden), true);
      assert.equal(await page.$eval("#auth-remember", (el) => el.disabled), false);
      await page.click("#auth-remember");
      assert.equal(await page.$eval("#auth-remember", (el) => el.checked), true);
      log("PASS blocked storage still allows blacklist, saved searches, and remember-in-memory");
    }
  );

  // Default all-ratings auto-load, intercepted so no live explicit media is fetched.
  {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 360, height: 560, isMobile: true, hasTouch: true });
    await page.setUserAgent(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36"
    );
    const postsUrls = [];
    await page.evaluateOnNewDocument(() => {
      const fake = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      };
      Object.defineProperty(window, "localStorage", { get: () => fake });
    });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("https://e621.net/posts.json")) {
        postsUrls.push(url);
        request.respond({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({
            posts: [{
              id: 1,
              rating: "s",
              tags: { general: ["canine"] },
              flags: {},
              file: { url: "https://example.invalid/file.png", ext: "png" },
              files: {
                original: { url: "https://example.invalid/file.png" },
                preview: { url: "https://example.invalid/preview.png" },
              },
            }],
          }),
        });
        return;
      }
      if (url.startsWith("https://e621.net/")) {
        request.respond({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: "[]",
        });
        return;
      }
      request.continue();
    });
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    const srcs = await page.evaluate(() => ({
      css: document.querySelector('link[rel="stylesheet"]')?.getAttribute("href"),
      js: document.querySelector('script[type="module"]')?.getAttribute("src"),
    }));
    assert.match(srcs.css, /[?&]v=/);
    assert.match(srcs.js, /[?&]v=/);
    assert.equal(await page.$eval("#rating", (el) => el.value), "all");
    await page.click("#age-confirm");
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForFunction(() => /posts loaded|No posts found/i.test(document.getElementById("status")?.textContent || ""), { timeout: 20000 });
    assert.ok(postsUrls.length >= 1, "expected a default posts request");
    const tags = new URL(postsUrls[0]).searchParams.get("tags") || "";
    assert.equal(/rating:s/.test(tags), false, "default load must not force Safe");
    assert.match(tags, /(^|\s)-young(\s|$)/);
    assert.match(tags, /(^|\s)-loli(\s|$)/);
    assert.match(tags, /(^|\s)-shota(\s|$)/);
    assert.match(tags, /(^|\s)-cub(\s|$)/);
    const status = await page.$eval("#status", (el) => el.textContent);
    assert.match(status, /posts loaded/i);
    log("PASS default all-ratings recent load (getItem always null) sends exclusions and shows results");
    await context.close();
  }

  await withPage(
    browser,
    base,
    async (page) => {
      await page.setViewport({ width: 360, height: 560, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.setUserAgent(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36"
      );
      await page.evaluateOnNewDocument(() => {
        const boom = () => { throw new Error("storage blocked"); };
        const fake = {
          getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom,
          get length() { throw new Error("storage blocked"); },
        };
        Object.defineProperty(window, "localStorage", { get: () => fake });
      });
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      const layout = await page.evaluate(() => {
        const first = document.querySelector("#grid .thumb");
        const views = document.querySelector('.views button');
        const sub = document.querySelector('.sub-bar button');
        const chrome = document.querySelector(".chrome");
        const brand = document.getElementById("brand-home");
        const banner = document.getElementById("storage-banner");
        const fr = first.getBoundingClientRect();
        const chromeBox = chrome.getBoundingClientRect();
        return {
          innerH: window.innerHeight,
          chromeH: Math.round(chromeBox.height),
          chromeTop: Math.round(chromeBox.top),
          brandInChrome: chrome.contains(brand),
          brandText: brand && brand.textContent.trim(),
          brandTag: brand && brand.tagName,
          topH: Math.round(document.querySelector(".top").getBoundingClientRect().height),
          bannerH: Math.round(banner.getBoundingClientRect().height),
          bannerHidden: banner.hidden,
          firstTop: Math.round(fr.top),
          firstVisible: Math.min(fr.bottom, window.innerHeight) - Math.max(fr.top, 0),
          viewH: Math.round(getComputedStyle(views).minHeight.replace("px", "")),
          subH: Math.round(getComputedStyle(sub).minHeight.replace("px", "")),
        };
      });
      assert.equal(layout.brandInChrome, true);
      assert.equal(layout.brandText, "e621-red");
      assert.equal(layout.brandTag, "BUTTON");
      assert.ok(layout.firstVisible >= 80, `first post not visible under header: ${JSON.stringify(layout)}`);
      assert.ok(layout.chromeH <= 200, `sticky chrome including title too tall: ${JSON.stringify(layout)}`);
      assert.ok(layout.chromeH < layout.innerH * 0.5, `sticky chrome too tall: ${JSON.stringify(layout)}`);
      assert.ok(layout.viewH <= 36 && layout.viewH >= 28, `views button height ${layout.viewH}`);
      assert.ok(layout.subH <= 36 && layout.subH >= 28, `sub-bar button height ${layout.subH}`);
      await page.click('[data-sub="popular"]');
      await page.waitForSelector("#popular-panel:not([hidden])");
      const popH = await page.$eval(".popular-grid button", (el) => Math.round(getComputedStyle(el).minHeight.replace("px", "")));
      assert.ok(popH <= 36 && popH >= 28, `popular button height ${popH}`);
      log(`PASS compact header leaves posts visible on a short phone (${JSON.stringify(layout)}, popular=${popH})`);
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.setUserAgent(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36"
      );
      await page.evaluateOnNewDocument(() => {
        const boom = () => { throw new Error("storage blocked"); };
        const fake = {
          getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom,
          get length() { throw new Error("storage blocked"); },
        };
        Object.defineProperty(window, "localStorage", { get: () => fake });
      });
    },
    async (page, { apiCalls }) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      await page.click("#grid .thumb");
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      const chrome = await page.evaluate(() => ({
        prev: document.getElementById("viewer-prev").textContent.trim(),
        next: document.getElementById("viewer-next").textContent.trim(),
        mid: document.getElementById("viewer-context-btn").textContent.trim(),
        kind: document.getElementById("viewer-context-btn").dataset.kind,
        prevDisabled: document.getElementById("viewer-prev").disabled,
        hasMedia: Boolean(document.querySelector("#viewer-stage img, #viewer-stage video")),
      }));
      assert.equal(chrome.prev, "<Prev");
      assert.equal(chrome.next, "Next>");
      assert.equal(chrome.mid, "Search: (none)");
      assert.equal(chrome.kind, "search");
      assert.equal(chrome.prevDisabled, true);
      assert.equal(chrome.hasMedia, true);

      const tagRows = await page.$$eval("#viewer-tags .tag-row", (rows) =>
        rows.map((row) => ({
          name: row.querySelector(".tag-name")?.textContent || "",
          plus: row.querySelector(".tag-plus")?.textContent || "",
          minus: row.querySelector(".tag-minus")?.textContent || "",
        }))
      );
      assert.ok(tagRows.length > 0, "expected tags under the image");
      for (const row of tagRows) {
        assert.equal(row.plus, "+");
        assert.equal(row.minus, "-");
        for (const tag of ["young", "loli", "shota", "cub"]) {
          assert.equal(row.name === tag, false, "blocked tag shown: " + row.name);
        }
      }
      const pick = tagRows.find((row) => row.name && !row.name.includes(":")) || tagRows[0];
      const firstHref = await page.$eval("#viewer-open", (el) => el.getAttribute("href"));
      const nextDisabled = await page.$eval("#viewer-next", (el) => el.disabled);
      if (!nextDisabled) {
        await page.click("#viewer-next");
        await page.waitForFunction(
          (prev) => document.getElementById("viewer-open").getAttribute("href") !== prev,
          { timeout: 20000 },
          firstHref
        );
        await page.click("#viewer-prev");
        await page.waitForFunction(
          (prev) => document.getElementById("viewer-open").getAttribute("href") === prev,
          { timeout: 20000 },
          firstHref
        );
      }
      log(`PASS viewer bar is <Prev / Search: (none) / Next> with ${tagRows.length} tag rows`);

      const beforeReplace = apiCalls.filter((url) => url.includes("/posts.json")).length;
      const selector = `#viewer-tags .tag-name`;
      const handle = await page.evaluateHandle((name) => {
        return [...document.querySelectorAll("#viewer-tags .tag-name")].find((el) => el.textContent === name);
      }, pick.name);
      const el = handle.asElement();
      assert.ok(el, "could not find tag button " + pick.name);
      await el.click();
      await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 10000 });
      const replaced = await page.$eval("#search", (node) => node.value.trim());
      assert.equal(replaced, pick.name);
      const replaceUrl = await waitForCall(
        () => apiCalls.filter((url) => url.includes("/posts.json")),
        beforeReplace,
        { match: (url) => (new URL(url).searchParams.get("tags") || "").includes(pick.name) }
      );
      const replaceTags = new URL(replaceUrl).searchParams.get("tags") || "";
      assert.match(replaceTags, new RegExp("(^|\\s)" + pick.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)"));
      assert.match(replaceTags, /(^|\s)rating:s(\s|$)/);
      assert.match(replaceTags, /(^|\s)-young(\s|$)/);
      log("PASS tapping a tag replaces the search and runs it (" + pick.name + ")");

      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      await page.click("#grid .thumb");
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      await page.waitForFunction(
        (label) => document.getElementById("viewer-context-btn").textContent.trim() === label,
        { timeout: 10000 },
        "Search: (" + pick.name + ")"
      );
      const plusRows = await page.$$eval("#viewer-tags .tag-row", (rows) =>
        rows.map((row) => row.querySelector(".tag-name")?.textContent || "")
      );
      const addName = plusRows.find((name) => name && name !== pick.name && !name.includes(":")) || plusRows.find((name) => name && name !== pick.name);
      assert.ok(addName, "needed a second tag to add");
      const beforeAdd = apiCalls.filter((url) => url.includes("/posts.json")).length;
      await page.evaluate((name) => {
        const row = [...document.querySelectorAll("#viewer-tags .tag-row")].find((el) => el.querySelector(".tag-name")?.textContent === name);
        row.querySelector(".tag-plus").click();
      }, addName);
      await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 10000 });
      const added = await page.$eval("#search", (node) => node.value.trim());
      assert.match(added, new RegExp("(^|\\s)" + pick.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)"));
      assert.match(added, new RegExp("(^|\\s)" + addName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)"));
      const addUrl = await waitForCall(
        () => apiCalls.filter((url) => url.includes("/posts.json")),
        beforeAdd,
        { match: (url) => {
          const tags = new URL(url).searchParams.get("tags") || "";
          return tags.includes(pick.name) && tags.includes(addName);
        } }
      );
      const addTags = new URL(addUrl).searchParams.get("tags") || "";
      assert.match(addTags, /(^|\s)rating:s(\s|$)/);
      assert.match(addTags, /(^|\s)-young(\s|$)/);
      log("PASS + adds the tag to the current search (" + added + ")");

      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0 || /No posts found/i.test(document.getElementById("status").textContent), { timeout: 20000 });
      if (await page.$("#grid .thumb")) {
        await page.click("#grid .thumb");
        await page.waitForSelector("#viewer[open], dialog.viewer[open]");
        const beforeMinus = apiCalls.filter((url) => url.includes("/posts.json")).length;
        const minusName = await page.$eval("#viewer-tags .tag-name", (node) => node.textContent);
        await page.click("#viewer-tags .tag-minus");
        await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 10000 });
        const excluded = await page.$eval("#search", (node) => node.value.trim());
        assert.match(excluded, new RegExp("(^|\\s)-" + minusName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)"));
        const minusUrl = await waitForCall(
          () => apiCalls.filter((url) => url.includes("/posts.json")),
          beforeMinus,
          { match: (url) => (new URL(url).searchParams.get("tags") || "").includes("-" + minusName) }
        );
        const minusTags = new URL(minusUrl).searchParams.get("tags") || "";
        assert.match(minusTags, /(^|\s)rating:s(\s|$)/);
        assert.match(minusTags, /(^|\s)-young(\s|$)/);
        log("PASS - excludes the tag (" + excluded + ")");
      } else {
        log("SKIP minus-tag click; added search returned no posts");
      }
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      const ids = await page.$$eval("#grid .thumb img", (imgs) =>
        imgs.map((img) => {
          const match = (img.alt || "").match(/Post\s+(\d+)/);
          return match ? Number(match[1]) : 0;
        }).filter(Boolean)
      );
      assert.ok(ids.length, "needed post ids from the safe grid");
      await new Promise((resolve) => setTimeout(resolve, 900));
      const apiUrl = buildApiUrl("/posts.json", {
        tags: "id:" + ids.join(",") + " rating:s -young -loli -shota -cub",
        limit: String(Math.min(Math.max(ids.length, 1), 24)),
        mode: "extended",
      });
      const apiRes = await fetch(apiUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        },
      });
      assert.equal(apiRes.ok, true, "API tag comparison fetch failed: " + apiRes.status);
      const apiPosts = normalizePostsResponse(await apiRes.json());
      const postsById = new Map(apiPosts.map((post) => [Number(post.id), post]));
      let chosen = null;
      for (const id of ids) {
        const post = postsById.get(id);
        const categoryCount = post && post.tags && !Array.isArray(post.tags)
          ? Object.keys(post.tags).filter((key) => {
              const list = post.tags[key];
              return Array.isArray(list) ? list.length > 0 : Boolean(list);
            }).length
          : 0;
        if (post && categoryCount >= 4) {
          chosen = { id, post };
          break;
        }
      }
      assert.ok(chosen, "needed a safe post with several tag categories");
      await page.click('#grid .thumb img[alt="Post ' + chosen.id + '"]');
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      await page.waitForFunction(() => document.querySelectorAll("#viewer-tags .tag-row").length > 0, { timeout: 15000 });
      const expected = collectTagsByCategory(chosen.post);
      assert.ok(expected.length >= 4, "expected several visible tag groups");
      const rendered = await page.evaluate(() =>
        [...document.querySelectorAll("#viewer-tags .tag-group")].map((group) => ({
          category: group.dataset.category,
          title: (group.querySelector(".tag-group-title") || {}).textContent.trim(),
          tags: [...group.querySelectorAll(".tag-name")].map((node) => node.textContent.trim()),
        }))
      );
      assert.deepEqual(
        rendered,
        expected.map((group) => ({
          category: group.category,
          title: formatTagCategoryLabel(group.category),
          tags: group.tags,
        }))
      );
      const fromApi = new Set();
      const tags = chosen.post.tags || {};
      for (const key of Object.keys(tags)) {
        const list = Array.isArray(tags[key]) ? tags[key] : String(tags[key] || "").split(/\s+/);
        for (const raw of list) {
          const name = tagName(raw);
          if (name && !isBlockedTag(name)) fromApi.add(name);
        }
      }
      const fromDom = new Set(rendered.flatMap((group) => group.tags));
      assert.deepEqual([...fromDom].sort(), [...fromApi].sort());
      const known = new Set(TAG_CATEGORY_ORDER);
      const renderedKnown = rendered.map((group) => group.category).filter((key) => known.has(key));
      const expectedKnown = TAG_CATEGORY_ORDER.filter((key) => renderedKnown.includes(key));
      assert.deepEqual(renderedKnown, expectedKnown);
      const titles = rendered.map((group) => group.title);
      for (const blocked of ["young", "loli", "shota", "cub"]) {
        assert.equal(fromDom.has(blocked), false);
      }
      log("PASS viewer tags match the API and use the requested category order (" + titles.join(", ") + ")");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.click('[data-view="pools"]');
      await page.waitForSelector("#pools-panel:not([hidden])");
      await page.$eval("#pool-search", (el) => { el.value = ""; });
      await page.$eval("#pool-search", (el) => { el.value = "Official_Pokémon_species_artwork"; });
      await page.click("#pool-load");
      await page.waitForFunction(() => document.querySelectorAll("#pool-list .pool-item").length > 0, { timeout: 20000 });
      const poolTitle = await page.evaluate(() => {
        const items = [...document.querySelectorAll("#pool-list .pool-item")];
        const match = items.find((item) => /official\s+pokémon\s+species\s+artwork/i.test(item.querySelector("strong")?.textContent || ""));
        const item = match || items[0];
        if (match) match.dataset.testPick = "1";
        return (item.querySelector("strong")?.textContent || "").trim();
      });
      if (await page.$('#pool-list .pool-item[data-test-pick="1"]')) {
        await page.click('#pool-list .pool-item[data-test-pick="1"]');
      } else {
        await page.click("#pool-list .pool-item");
      }
      await page.waitForFunction(
        () => document.querySelectorAll("#grid .thumb").length > 0 || /No viewable posts/i.test(document.getElementById("status").textContent),
        { timeout: 20000 }
      );
      if (!(await page.$("#grid .thumb"))) {
        log("SKIP in-pool viewer bar; no viewable posts in " + poolTitle);
        return;
      }
      await page.click("#grid .thumb");
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      await page.waitForFunction(
        (name) => {
          const viewer = document.getElementById("viewer");
          const poolBar = document.getElementById("viewer-pool-bar");
          const poolName = document.getElementById("viewer-pool-name");
          return viewer && viewer.dataset.bars === "pool" && poolBar && !poolBar.hidden && poolName && poolName.textContent.trim() === name;
        },
        { timeout: 15000 },
        poolTitle
      );
      const bars = await page.evaluate(() => ({
        searchHidden: document.getElementById("viewer-search-bar").hidden,
        poolHidden: document.getElementById("viewer-pool-bar").hidden,
        name: document.getElementById("viewer-pool-name").textContent.trim(),
        prevDisabled: document.getElementById("viewer-pool-prev").disabled,
        nextDisabled: document.getElementById("viewer-pool-next").disabled,
        firstHref: document.getElementById("viewer-open").getAttribute("href") || "",
        title: document.getElementById("viewer-brand-home") && document.getElementById("viewer-brand-home").textContent.trim(),
      }));
      assert.equal(bars.searchHidden, true);
      assert.equal(bars.poolHidden, false);
      assert.equal(bars.name, poolTitle);
      assert.equal(bars.prevDisabled, true);
      assert.equal(bars.title, "e621-red");
      if (!bars.nextDisabled) {
        await page.click("#viewer-pool-next");
        await page.waitForFunction(
          (first) => {
            const href = document.getElementById("viewer-open").getAttribute("href") || "";
            const prevOff = document.getElementById("viewer-pool-prev").disabled;
            return href && href !== first && !prevOff;
          },
          { timeout: 20000 },
          bars.firstHref
        );
        const after = await page.evaluate(() => ({
          href: document.getElementById("viewer-open").getAttribute("href") || "",
          prevDisabled: document.getElementById("viewer-pool-prev").disabled,
          searchHidden: document.getElementById("viewer-search-bar").hidden,
          name: document.getElementById("viewer-pool-name").textContent.trim(),
        }));
        assert.notEqual(after.href, bars.firstHref);
        assert.equal(after.prevDisabled, false);
        assert.equal(after.searchHidden, true);
        assert.equal(after.name, poolTitle);
      }
      await page.click("#viewer-pool-name");
      await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 10000 });
      assert.equal(await page.$eval("#pools-panel", (el) => el.hidden), false);
      assert.equal(await page.$eval("#pool-nav", (el) => el.hidden), false);
      log("PASS pools-only viewer shows the pool bar, greys first Prev, and returns to the pool (" + poolTitle + ")");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForSelector("#search");
      const beforeAlts = await page.$$eval("#grid .thumb img", (imgs) => imgs.map((img) => img.alt).join("|"));
      await page.$eval("#search", (el) => { el.value = "pool:19609"; });
      await page.click("#search-form button[type=submit]");
      await page.waitForFunction(
        (prev) => {
          const alts = [...document.querySelectorAll("#grid .thumb img")].map((img) => img.alt).join("|");
          const status = (document.getElementById("status") || {}).textContent || "";
          const query = (document.getElementById("search") || {}).value || "";
          return query.indexOf("pool:19609") !== -1 && alts && alts !== prev && !/Loading/i.test(status);
        },
        { timeout: 20000 },
        beforeAlts
      );
      await page.click("#grid .thumb");
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      await page.waitForFunction(() => {
        const viewer = document.getElementById("viewer");
        const searchBar = document.getElementById("viewer-search-bar");
        const poolBar = document.getElementById("viewer-pool-bar");
        const mid = document.getElementById("viewer-context-btn");
        const name = document.getElementById("viewer-pool-name");
        return viewer && viewer.dataset.bars === "both" && searchBar && !searchBar.hidden && poolBar && !poolBar.hidden && /Search: \(pool:19609\)/.test(mid.textContent) && /official\s+pokémon\s+species\s+artwork/i.test(name.textContent);
      }, { timeout: 20000 });
      const first = await page.evaluate(() => ({
        href: document.getElementById("viewer-open").getAttribute("href") || "",
        search: document.getElementById("viewer-context-btn").textContent.trim(),
        name: document.getElementById("viewer-pool-name").textContent.trim(),
        poolPrev: document.getElementById("viewer-pool-prev").disabled,
        poolNext: document.getElementById("viewer-pool-next").disabled,
        searchPrev: document.getElementById("viewer-prev").disabled,
        searchNext: document.getElementById("viewer-next").disabled,
        title: document.getElementById("viewer-brand-home").textContent.trim(),
      }));
      assert.equal(first.search, "Search: (pool:19609)");
      assert.match(first.name, /official\s+pokémon\s+species\s+artwork/i);
      assert.equal(first.title, "e621-red");
      assert.equal(first.searchPrev, true);
      assert.equal(first.searchNext, false);
      const poolDir = !first.poolNext ? "next" : (!first.poolPrev ? "prev" : "");
      assert.notEqual(poolDir, "");
      await page.click(poolDir === "next" ? "#viewer-pool-next" : "#viewer-pool-prev");
      await page.waitForFunction(
        (href) => (document.getElementById("viewer-open").getAttribute("href") || "") !== href,
        { timeout: 20000 },
        first.href
      );
      const afterPool = await page.evaluate(() => ({
        href: document.getElementById("viewer-open").getAttribute("href") || "",
        search: document.getElementById("viewer-context-btn").textContent.trim(),
        searchHidden: document.getElementById("viewer-search-bar").hidden,
        poolHidden: document.getElementById("viewer-pool-bar").hidden,
      }));
      assert.notEqual(afterPool.href, first.href);
      assert.equal(afterPool.search, "Search: (pool:19609)");
      assert.equal(afterPool.searchHidden, false);
      assert.equal(afterPool.poolHidden, false);
      log("PASS search-plus-pool viewer shows both bars and keeps the search label after pool Next");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      const count = await page.$$eval("#grid .thumb", (els) => els.length);
      let found = false;
      for (let i = 0; i < Math.min(count, 16); i++) {
        const thumbs = await page.$$("#grid .thumb");
        if (!thumbs[i]) break;
        await thumbs[i].click();
        await page.waitForSelector("#viewer[open], dialog.viewer[open]");
        await page.waitForFunction(() => {
          const mode = document.getElementById("viewer").dataset.bars;
          return mode === "search" || mode === "both" || mode === "pool";
        }, { timeout: 15000 });
        const mode = await page.$eval("#viewer", (el) => el.dataset.bars);
        if (mode === "search") {
          const bars = await page.evaluate(() => ({
            searchHidden: document.getElementById("viewer-search-bar").hidden,
            poolHidden: document.getElementById("viewer-pool-bar").hidden,
            mid: document.getElementById("viewer-context-btn").textContent.trim(),
          }));
          assert.equal(bars.searchHidden, false);
          assert.equal(bars.poolHidden, true);
          assert.equal(bars.mid, "Search: (none)");
          found = true;
          break;
        }
        await page.click("#viewer-close");
        await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 10000 });
      }
      assert.equal(found, true);
      log("PASS a post with no pool shows only the search bar");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.setUserAgent(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36"
      );
      await page.evaluateOnNewDocument(() => {
        const boom = () => { throw new Error("storage blocked"); };
        const fake = {
          getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom,
          get length() { throw new Error("storage blocked"); },
        };
        Object.defineProperty(window, "localStorage", { get: () => fake });
      });
    },
    async (page, { apiCalls }) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });

      async function brandVisible() {
        return page.evaluate(() => {
          const brand = document.getElementById("brand-home");
          if (!brand) return { ok: false, reason: "missing" };
          const box = brand.getBoundingClientRect();
          const cs = getComputedStyle(brand);
          return {
            ok: box.height > 0 && box.bottom > 0 && box.top < window.innerHeight && cs.display !== "none" && cs.visibility !== "hidden",
            text: brand.textContent.trim(),
            tag: brand.tagName,
            top: Math.round(box.top),
            label: brand.getAttribute("aria-label") || "",
          };
        });
      }

      const views = [
        { name: "posts", click: null },
        { name: "popular", click: '[data-sub="popular"]', wait: "#popular-panel:not([hidden])" },
        { name: "favorites", click: '[data-sub="favorites"]', wait: "#favorites-panel:not([hidden])" },
        { name: "blacklist", click: '[data-sub="blacklist"]', wait: "#blacklist-panel:not([hidden])" },
        { name: "saved", click: '[data-sub="saved"]', wait: "#saved-panel:not([hidden])" },
        { name: "pools", click: '[data-view="pools"]', wait: "#pools-panel:not([hidden])" },
      ];
      for (const view of views) {
        if (view.click) {
          await page.click(view.click);
          if (view.wait) await page.waitForSelector(view.wait);
        }
        const info = await brandVisible();
        assert.equal(info.ok, true, "e621-red missing on " + view.name + ": " + JSON.stringify(info));
        assert.equal(info.text, "e621-red");
        assert.equal(info.tag, "BUTTON");
        assert.match(info.label, /recent posts/i);
      }
      log("PASS e621-red stays visible as a button on Posts, Popular, Favorites, Blacklist, Saved, and Pools");

      await page.click('[data-view="posts"]');
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      await page.evaluate(() => window.scrollTo(0, 800));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const afterScroll = await page.evaluate(() => {
        const brand = document.getElementById("brand-home");
        const chrome = document.querySelector(".chrome");
        const brandBox = brand.getBoundingClientRect();
        const chromeBox = chrome.getBoundingClientRect();
        return {
          brandTop: Math.round(brandBox.top),
          chromeTop: Math.round(chromeBox.top),
          visible: brandBox.bottom > 0 && brandBox.top < 80,
        };
      });
      assert.equal(afterScroll.visible, true, "title should stay sticky while scrolling: " + JSON.stringify(afterScroll));
      log("PASS e621-red stays in the sticky header while scrolling");

      await page.$eval("#search", (el) => { el.value = "canine"; });
      const beforeHome = apiCalls.filter((url) => url.includes("/posts.json")).length;
      await page.click("#brand-home");
      await page.waitForFunction(() => document.getElementById("search").value === "", { timeout: 10000 });
      const afterHome = await page.evaluate(() => ({
        search: document.getElementById("search").value,
        postsSelected: document.querySelector('[data-view="posts"]').getAttribute("aria-selected"),
        subHiddenSelected: [...document.querySelectorAll("#sub-nav [data-sub]")].every((el) => el.getAttribute("aria-selected") === "false"),
        viewerOpen: Boolean(document.getElementById("viewer").open),
      }));
      assert.equal(afterHome.search, "");
      assert.equal(afterHome.postsSelected, "true");
      assert.equal(afterHome.subHiddenSelected, true);
      assert.equal(afterHome.viewerOpen, false);
      const homeUrl = await waitForCall(
        () => apiCalls.filter((url) => url.includes("/posts.json")),
        beforeHome,
        { match: (url) => {
          const tags = new URL(url).searchParams.get("tags") || "";
          return /(^|\s)rating:s(\s|$)/.test(tags) && !/(^|\s)canine(\s|$)/.test(tags);
        } }
      );
      const homeTags = new URL(homeUrl).searchParams.get("tags") || "";
      assert.match(homeTags, /(^|\s)-young(\s|$)/);
      log("PASS tapping e621-red clears the search and loads recent posts");

      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      await page.click("#grid .thumb");
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      const inViewer = await page.evaluate(() => {
        const brand = document.getElementById("viewer-brand-home");
        const context = document.querySelector(".viewer-context");
        const stage = document.getElementById("viewer-stage");
        const media = document.querySelector("#viewer-stage img, #viewer-stage video");
        const brandBox = brand.getBoundingClientRect();
        const contextBox = context.getBoundingClientRect();
        const stageBox = stage.getBoundingClientRect();
        const mediaBox = media ? media.getBoundingClientRect() : stageBox;
        return {
          text: brand && brand.textContent.trim(),
          tag: brand && brand.tagName,
          brandBottom: Math.round(brandBox.bottom),
          contextTop: Math.round(contextBox.top),
          stageTop: Math.round(stageBox.top),
          mediaTop: Math.round(mediaBox.top),
          coversMedia: brandBox.bottom > mediaBox.top + 1,
        };
      });
      assert.equal(inViewer.text, "e621-red");
      assert.equal(inViewer.tag, "BUTTON");
      assert.ok(inViewer.brandBottom <= inViewer.contextTop + 1, "title should sit above the Prev/Search/Next bar: " + JSON.stringify(inViewer));
      assert.ok(inViewer.brandBottom <= inViewer.stageTop + 1, "title should not overlap the media stage: " + JSON.stringify(inViewer));
      assert.equal(inViewer.coversMedia, false, "title covers media: " + JSON.stringify(inViewer));
      log("PASS viewer shows e621-red above the post bar without covering the media");

      await page.$eval("#search", (el) => { el.value = "canine"; });
      const beforeViewerHome = apiCalls.filter((url) => url.includes("/posts.json")).length;
      await page.click("#viewer-brand-home");
      await page.waitForFunction(() => !document.getElementById("viewer").open, { timeout: 10000 });
      const afterViewerHome = await page.evaluate(() => ({
        search: document.getElementById("search").value,
        postsSelected: document.querySelector('[data-view="posts"]').getAttribute("aria-selected"),
        viewerOpen: Boolean(document.getElementById("viewer").open),
      }));
      assert.equal(afterViewerHome.viewerOpen, false);
      assert.equal(afterViewerHome.search, "");
      assert.equal(afterViewerHome.postsSelected, "true");
      await waitForCall(
        () => apiCalls.filter((url) => url.includes("/posts.json")),
        beforeViewerHome,
        { match: (url) => {
          const tags = new URL(url).searchParams.get("tags") || "";
          return /(^|\s)rating:s(\s|$)/.test(tags) && !/(^|\s)canine(\s|$)/.test(tags);
        } }
      );
      log("PASS tapping e621-red in the viewer closes it and loads recent posts");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page, { apiCalls }) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.click('[data-view="pools"]');
      await page.waitForSelector("#pools-panel:not([hidden])");
      await page.waitForFunction(() => document.querySelectorAll("#pool-list .pool-item").length > 0, { timeout: 30000 });
      const first = await page.evaluate(() => ({
        count: document.querySelectorAll("#pool-list .pool-item").length,
        status: (document.getElementById("status") || {}).textContent || "",
        pageLabel: (document.getElementById("page-label") || {}).textContent || "",
        moreDisabled: document.getElementById("more").disabled,
        nextDisabled: document.getElementById("next").disabled,
      }));
      assert.ok(first.count > 23, "expected more than 23 pools, got " + first.count);
      const poolUrls = apiCalls.filter((url) => url.includes("/pools.json"));
      assert.ok(poolUrls.length >= 1, "expected a pools request");
      const lastList = poolUrls.filter((url) => !new URL(url).searchParams.get("search[id]")).at(-1);
      const limit = Number(new URL(lastList).searchParams.get("limit") || 0);
      assert.ok(limit >= 75, "expected a larger pool page, got limit=" + limit);
      assert.match(first.status, /pools loaded/i);
      assert.match(first.status, /more available|end of list/i);
      assert.match(first.pageLabel, /Page/);
      if (!first.moreDisabled || !first.nextDisabled) {
        const before = first.count;
        if (!first.moreDisabled) await clickSelector(page, "#more");
        else await clickSelector(page, "#next");
        await page.waitForFunction(
          (prev) => {
            const count = document.querySelectorAll("#pool-list .pool-item").length;
            const status = (document.getElementById("status") || {}).textContent || "";
            return !/Loading/i.test(status) && (count > prev || /page/i.test(status));
          },
          { timeout: 30000 },
          before
        );
        const after = await page.evaluate(() => ({
          count: document.querySelectorAll("#pool-list .pool-item").length,
          status: (document.getElementById("status") || {}).textContent || "",
          pageLabel: (document.getElementById("page-label") || {}).textContent || "",
        }));
        if (!first.moreDisabled) {
          assert.ok(after.count > before, "Load more should append pools (" + before + " -> " + after.count + ")");
        } else {
          assert.ok(after.count > 23, "Next should show another page of pools");
        }
        if (!first.moreDisabled && !after.status.match(/end of list/i)) {
          const mid = after.count;
          await clickSelector(page, "#more");
          await page.waitForFunction(
            (prev) => {
              const count = document.querySelectorAll("#pool-list .pool-item").length;
              const status = (document.getElementById("status") || {}).textContent || "";
              return !/Loading/i.test(status) && count > prev;
            },
            { timeout: 30000 },
            mid
          );
          const third = await page.$$eval("#pool-list .pool-item", (els) => els.length);
          assert.ok(third > mid, "paging a third page should add more pools");
          log("PASS default pools load " + first.count + ", then " + after.count + ", then " + third);
        } else {
          log("PASS default pools load " + first.count + " and continue to " + after.count);
        }
      } else {
        assert.match(first.status, /end of list/i);
        log("PASS default pools load " + first.count + " and reached the end of the list");
      }

      await page.$eval("#pool-search", (el) => { el.value = ""; });
      await page.type("#pool-search", "official");
      await clickSelector(page, "#pool-load");
      await page.waitForFunction(
        () => {
          const status = (document.getElementById("status") || {}).textContent || "";
          return !/Loading/i.test(status) && document.querySelectorAll("#pool-list .pool-item").length > 0;
        },
        { timeout: 30000 }
      );
      const named = await page.evaluate(() => ({
        count: document.querySelectorAll("#pool-list .pool-item").length,
        status: (document.getElementById("status") || {}).textContent || "",
        moreDisabled: document.getElementById("more").disabled,
        names: [...document.querySelectorAll("#pool-list .pool-item strong")].slice(0, 8).map((el) => (el.textContent || "").toLowerCase()),
      }));
      assert.ok(named.count > 0, "expected name search results");
      for (const name of named.names) {
        assert.match(name, /official/);
        for (const tag of ["young", "loli", "shota", "cub"]) {
          assert.equal(name.split(/\s+/).includes(tag), false, "blocked pool listed: " + name);
        }
      }
      if (!named.moreDisabled) {
        const beforeNamed = named.count;
        await clickSelector(page, "#more");
        await page.waitForFunction(
          (prev) => {
            const count = document.querySelectorAll("#pool-list .pool-item").length;
            const status = (document.getElementById("status") || {}).textContent || "";
            return !/Loading/i.test(status) && count > prev;
          },
          { timeout: 30000 },
          beforeNamed
        );
        const afterNamed = await page.$$eval("#pool-list .pool-item", (els) => els.length);
        assert.ok(afterNamed > beforeNamed, "name search Load more should append");
        log("PASS pool name search paging (" + beforeNamed + " -> " + afterNamed + ")");
      } else {
        log("PASS pool name search loaded " + named.count + " (single page)");
      }
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      const grid = await page.$eval("#grid .thumb", (thumb) => {
        const stats = thumb.querySelector(".thumb-stats");
        const box = thumb.getBoundingClientRect();
        const fav = stats && stats.querySelector(".stat-fav");
        const score = stats && stats.querySelector(".stat-score");
        return {
          hasBar: Boolean(stats),
          fav: fav ? fav.textContent.trim() : "",
          score: score ? score.textContent.trim() : "",
          direction: score ? [...score.classList].find((name) => name.indexOf("score-") === 0) : "",
          square: Math.abs(box.width - box.height) < 2,
          text: stats ? stats.textContent.replace(/\s+/g, " ").trim() : "",
        };
      });
      assert.equal(grid.hasBar, true);
      assert.equal(grid.square, true);
      assert.match(grid.fav, /^☆\d+$/);
      assert.match(grid.score, /^[⬆⬇=] \d+$/);
      assert.match(grid.direction, /^score-(up|down|zero)$/);
      await page.click("#grid .thumb");
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      const viewer = await page.evaluate(() => {
        const stats = document.getElementById("viewer-stats");
        const fav = stats && stats.querySelector(".stat-fav");
        const score = stats && stats.querySelector(".stat-score");
        const tags = document.getElementById("viewer-tags");
        const stage = document.getElementById("viewer-stage");
        return {
          fav: fav ? fav.textContent.trim() : "",
          score: score ? score.textContent.trim() : "",
          text: stats ? stats.textContent.replace(/\s+/g, " ").trim() : "",
          afterMedia: Boolean(stats && stage && tags && stage.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING && stats.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING),
        };
      });
      assert.equal(viewer.fav, grid.fav);
      assert.equal(viewer.score, grid.score);
      assert.equal(viewer.afterMedia, true);
      log("PASS thumbnail and viewer stats show favorites and score (" + grid.text + ")");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page, { apiCalls }) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      let foundIds = [];
      let lastStatus = "";
      for (let attempt = 0; attempt < 3 && !foundIds.includes("6875594"); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 2000 : 2500));
        const beforeAlts = await page.$$eval("#grid .thumb img", (imgs) => imgs.map((img) => img.alt).join("|"));
        await page.$eval("#search", (el) => {
          el.value = "id:6875594,6875570";
        });
        await page.evaluate(() => {
          const form = document.getElementById("search-form");
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        });
        try {
          await page.waitForFunction(
            (prev) => {
              const alts = [...document.querySelectorAll("#grid .thumb img")].map((img) => img.alt).join("|");
              const status = (document.getElementById("status") || {}).textContent || "";
              const query = (document.getElementById("search") || {}).value || "";
              return query.indexOf("id:6875594,6875570") !== -1 && alts && alts !== prev && !/Loading/i.test(status);
            },
            { timeout: 25000 },
            beforeAlts
          );
        } catch (error) {
          lastStatus = await page.$eval("#status", (el) => el.textContent || "");
          if (attempt === 2) throw new Error("family search failed: " + lastStatus + " / " + error.message);
          continue;
        }
        foundIds = await page.$$eval("#grid .thumb img", (imgs) =>
          imgs.map((img) => {
            const match = (img.alt || "").match(/Post\s+(\d+)/);
            return match ? match[1] : "";
          })
        );
        lastStatus = await page.$eval("#status", (el) => el.textContent || "");
      }
      const found = foundIds;
      assert.ok(found.includes("6875594"), "expected safe child post 6875594 in the grid");
      assert.ok(found.includes("6875570"), "expected safe parent post 6875570 in the grid");
      await clickSelector(page, '#grid .thumb img[alt="Post 6875594"]');
      await page.waitForSelector("#viewer[open], dialog.viewer[open]");
      await page.waitForFunction(() => {
        const family = document.getElementById("viewer-family");
        return family && !family.hidden && family.querySelector('.family-thumb[data-role="parent"][data-post-id="6875570"]');
      }, { timeout: 20000 });
      const childView = await page.evaluate(() => {
        const family = document.getElementById("viewer-family");
        const sides = [...family.querySelectorAll(".family-side")].map((side) => ({
          label: (side.querySelector(".family-label") || {}).textContent.trim(),
          parent: side.classList.contains("family-parent"),
          children: side.classList.contains("family-children"),
          ids: [...side.querySelectorAll(".family-thumb")].map((btn) => btn.dataset.postId),
          roles: [...side.querySelectorAll(".family-thumb")].map((btn) => btn.dataset.role),
        }));
        const parentBtn = family.querySelector('.family-thumb[data-role="parent"]');
        const box = parentBtn ? parentBtn.getBoundingClientRect() : { width: 0, height: 0 };
        const searchPrev = document.getElementById("viewer-prev");
        const searchNext = document.getElementById("viewer-next");
        return {
          hidden: family.hidden,
          sides,
          parentId: parentBtn && parentBtn.dataset.postId,
          parentLeft: sides[0] && sides[0].parent,
          thumbSize: Math.round(box.width) + "x" + Math.round(box.height),
          searchPrevDisabled: searchPrev && searchPrev.disabled,
          searchNextDisabled: searchNext && searchNext.disabled,
          mid: (document.getElementById("viewer-context-btn") || {}).textContent.trim(),
        };
      });
      assert.equal(childView.hidden, false);
      assert.equal(childView.parentId, "6875570");
      assert.equal(childView.parentLeft, true);
      assert.equal(childView.sides[0].label, "Parent");
      const siblingSide = childView.sides.find((side) => side.roles.includes("sibling") || side.roles.includes("child"));
      assert.ok(siblingSide && siblingSide.ids.length > 0, "expected siblings or children on the right");
      assert.equal(siblingSide.children, true);
      assert.equal(siblingSide.ids.includes("6875594"), false);
      assert.match(childView.thumbSize, /^7\dx7\d$/);
      assert.equal(childView.searchPrevDisabled === false || childView.searchNextDisabled === false, true);
      const familyUrls = apiCalls.filter((url) => {
        const tags = decodeURIComponent(new URL(url).searchParams.get("tags") || "");
        return url.includes("/posts.json") && /(^|\s)id:\d/.test(tags);
      });
      assert.ok(familyUrls.length > 0, "expected a family id fetch");
      for (const url of familyUrls) {
        const tags = decodeURIComponent(new URL(url).searchParams.get("tags") || "");
        assert.match(tags, /(^|\s)rating:s(\s|$)/);
        assert.match(tags, /(^|\s)-young(\s|$)/);
      }

      const beforeMeta = await page.$eval("#viewer-meta", (el) => el.textContent);
      await clickSelector(page, '.family-thumb[data-role="parent"]');
      await page.waitForFunction((prev) => {
        const family = document.getElementById("viewer-family");
        return (
          document.getElementById("viewer-meta").textContent !== prev &&
          family &&
          !family.hidden &&
          family.querySelectorAll('.family-thumb[data-role="child"]').length > 0
        );
      }, { timeout: 20000 }, beforeMeta);
      const parentView = await page.evaluate(() => {
        const family = document.getElementById("viewer-family");
        const children = [...family.querySelectorAll('.family-thumb[data-role="child"]')].map((btn) => btn.dataset.postId);
        const parents = [...family.querySelectorAll('.family-thumb[data-role="parent"]')];
        const childSide = family.querySelector(".family-children");
        const label = childSide && childSide.querySelector(".family-label");
        return {
          meta: (document.getElementById("viewer-meta") || {}).textContent,
          childIds: children,
          parentCount: parents.length,
          rightLabel: label ? label.textContent.trim() : "",
          childOnRight: Boolean(childSide),
          searchPrevDisabled: document.getElementById("viewer-prev").disabled,
          searchNextDisabled: document.getElementById("viewer-next").disabled,
        };
      });
      assert.match(parentView.meta, /#6875570/);
      assert.equal(parentView.parentCount, 0);
      assert.ok(parentView.childIds.includes("6875594"), "parent should list the child we came from");
      assert.ok(parentView.childIds.length >= 2, "expected several children on the parent");
      assert.equal(parentView.childOnRight, true);
      assert.equal(parentView.rightLabel, parentView.childIds.length === 1 ? "Child" : "Children");
      assert.equal(parentView.searchPrevDisabled === false || parentView.searchNextDisabled === false, true);

      const siblingId = parentView.childIds.find((id) => id !== "6875594");
      if (siblingId) {
        const midMeta = await page.$eval("#viewer-meta", (el) => el.textContent);
        await clickSelector(page, '.family-thumb[data-role="child"][data-post-id="' + siblingId + '"]');
        await page.waitForFunction((prev) => document.getElementById("viewer-meta").textContent !== prev, { timeout: 20000 }, midMeta);
        const jumped = await page.evaluate(() => ({
          meta: (document.getElementById("viewer-meta") || {}).textContent,
          prev: document.getElementById("viewer-prev").disabled,
          next: document.getElementById("viewer-next").disabled,
          hasParent: Boolean(document.querySelector('#viewer-family .family-thumb[data-role="parent"]')),
        }));
        assert.match(jumped.meta, new RegExp("#" + siblingId));
        assert.equal(jumped.prev, true);
        assert.equal(jumped.next, true);
        assert.equal(jumped.hasParent, true);
      }
      log("PASS viewer family strip shows parent on the left and children or siblings on the right");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      await new Promise((resolve) => setTimeout(resolve, 900));
      await page.click('[data-sub="favorites"]');
      await page.waitForSelector("#favorites-panel:not([hidden])");
      await page.$eval("#fav-user", (el) => {
        el.value = "bitWolfy";
      });
      await page.$eval("#auth-details", (el) => {
        el.open = true;
      });
      await page.$eval("#auth-key", (el) => {
        el.value = "not-a-real-key-000";
      });
      await clickSelector(page, "#auth-save");
      await page.waitForFunction(() => {
        const status = (document.getElementById("auth-status") || {}).textContent || "";
        const pageStatus = (document.getElementById("status") || {}).textContent || "";
        return /rejected the username or API key/i.test(status + " " + pageStatus);
      }, { timeout: 25000 });
      const rejected = await page.evaluate(() => ({
        status: (document.getElementById("auth-status") || {}).textContent.trim(),
        kind: (document.getElementById("auth-status") || {}).getAttribute("data-kind"),
        signedHidden: document.getElementById("auth-signed").hidden,
        signOutDisabled: document.getElementById("auth-clear").disabled,
        summary: (document.querySelector("#auth-details summary") || {}).textContent.trim(),
      }));
      assert.match(rejected.status, /rejected the username or API key/i);
      assert.equal(rejected.kind, "error");
      assert.equal(rejected.signedHidden, true);
      assert.equal(rejected.signOutDisabled, true);
      assert.equal(rejected.summary, "Optional API key");
      log("PASS fake API key is rejected with a clear 401 message");
    }
  );

  await withPage(
    browser,
    base,
    async (page) => {
      await blockStorageAndPhone(page);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const url = request.url();
        if (/^https:\/\/e621\.net\/users\/mock_user\.json/.test(url)) {
          if (request.method() === "OPTIONS") {
            request.respond({
              status: 204,
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "authorization, accept",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
              },
              body: "",
            });
            return;
          }
          const auth = request.headers().authorization || "";
          if (auth.indexOf("Basic ") !== 0) {
            request.respond({
              status: 401,
              contentType: "application/json",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ success: false, message: "SessionLoader::AuthenticationFailure" }),
            });
            return;
          }
          request.respond({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ name: "mock_user", id: 42 }),
          });
          return;
        }
        request.continue();
      });
    },
    async (page) => {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await confirmAndUseSafe(page);
      await page.waitForFunction(() => document.querySelectorAll("#grid .thumb").length > 0, { timeout: 20000 });
      await page.click('[data-sub="favorites"]');
      await page.waitForSelector("#favorites-panel:not([hidden])");
      await page.$eval("#fav-user", (el) => {
        el.value = "mock_user";
      });
      await page.$eval("#auth-details", (el) => {
        el.open = true;
      });
      await page.$eval("#auth-key", (el) => {
        el.value = "good-key-for-mock";
      });
      await page.click("#auth-remember");
      await clickSelector(page, "#auth-save");
      await page.waitForFunction(() => {
        const signed = document.getElementById("auth-signed");
        return signed && !signed.hidden && /Signed in as mock_user/.test(signed.textContent);
      }, { timeout: 20000 });
      const signed = await page.evaluate(() => ({
        badge: (document.getElementById("auth-signed") || {}).textContent.trim(),
        status: (document.getElementById("auth-status") || {}).textContent.trim(),
        kind: (document.getElementById("auth-status") || {}).getAttribute("data-kind"),
        summary: (document.querySelector("#auth-details summary") || {}).textContent.trim(),
        signOutDisabled: document.getElementById("auth-clear").disabled,
        keyCleared: document.getElementById("auth-key").value === "",
        remember: document.getElementById("auth-remember").checked,
        rememberNote: !document.getElementById("auth-remember-note").hidden,
      }));
      assert.equal(signed.badge, "Signed in as mock_user");
      assert.match(signed.status, /Signed in as mock_user/);
      assert.match(signed.status, /until this tab closes/);
      assert.equal(signed.kind, "ok");
      assert.equal(signed.summary, "Signed in as mock_user");
      assert.equal(signed.signOutDisabled, false);
      assert.equal(signed.keyCleared, true);
      assert.equal(signed.remember, true);
      assert.equal(signed.rememberNote, true);
      await page.click('[data-sub="hot"]');
      await page.waitForSelector("#favorites-panel[hidden]");
      await page.click('[data-sub="favorites"]');
      await page.waitForSelector("#favorites-panel:not([hidden])");
      const still = await page.evaluate(() => ({
        badge: (document.getElementById("auth-signed") || {}).textContent.trim(),
        hidden: document.getElementById("auth-signed").hidden,
        pageStatus: (document.getElementById("status") || {}).textContent.trim(),
      }));
      assert.equal(still.hidden, false);
      assert.equal(still.badge, "Signed in as mock_user");
      assert.match(still.pageStatus, /Signed in as mock_user/);
      await clickSelector(page, "#auth-clear");
      await page.waitForFunction(() => document.getElementById("auth-signed").hidden, { timeout: 5000 });
      assert.equal(await page.$eval("#auth-clear", (el) => el.disabled), true);
      log("PASS mocked sign-in shows Signed in as X, survives view changes with blocked storage, and signs out");
    }
  );

  log("All browser tests passed.");
} catch (error) {
  failures = 1;
  console.error("BROWSER TEST FAILED:", error);
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failures) process.exit(1);
