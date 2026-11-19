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

async function confirmAndUseSafe(page) {
  await page.waitForSelector("#age-confirm");
  assert.equal(await page.$eval("#app", (el) => el.hidden), true);
  await page.click("#age-confirm");
  await page.waitForSelector("#app:not([hidden])");
  await page.select("#rating", "s");
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
    await new Promise((r) => setTimeout(r, 800));
    const after = apiCalls.filter((url) => url.startsWith("https://e621.net/posts.json"));
    assert.equal(after.length, 0, "Search must not auto-run after confirmation");
    log("PASS confirmation reveals the app and does not auto-search");
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
      await page.click("#age-confirm");
      await page.waitForSelector("#app:not([hidden])");
      const after = await page.evaluate(() => {
        const gate = document.getElementById("age-gate");
        const declined = document.getElementById("age-declined");
        return {
          scrollH: document.documentElement.scrollHeight,
          innerH: window.innerHeight,
          gateDisplay: getComputedStyle(gate).display,
          declinedDisplay: getComputedStyle(declined).display,
          gateHeight: gate.getBoundingClientRect().height,
          declinedHeight: declined.getBoundingClientRect().height,
          visibleAccess: /access\s+(denied|declined)/i.test(document.body.innerText),
          appHidden: document.getElementById("app").hidden,
        };
      });
      assert.equal(after.gateDisplay, "none");
      assert.equal(after.declinedDisplay, "none");
      assert.equal(after.gateHeight, 0);
      assert.equal(after.declinedHeight, 0);
      assert.equal(after.appHidden, false);
      assert.equal(after.visibleAccess, false);
      assert.ok(
        after.scrollH < after.innerH * 2,
        `page stayed too tall after confirm: ${after.scrollH}`
      );
      const posts = apiCalls.filter((url) => url.includes("/posts.json"));
      assert.equal(posts.length, 0, "must not auto-search after confirm");
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
      assert.ok(afterConfirm.scrollH < afterConfirm.innerH * 2, `layout too tall: ${afterConfirm.scrollH}`);

      await page.click('[data-view="favorites"]');
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

      await page.click('[data-view="popular"]');
      await page.waitForSelector("#popular-panel:not([hidden])");
      const popularBefore = apiCalls.filter((url) => url.includes("/popular.json")).length;
      await page.click('#popular-panel [data-scale="day"]');
      await page.waitForFunction(
        () => document.querySelectorAll("#grid .thumb").length > 0 || /No viewable popular posts/i.test(document.getElementById("status").textContent),
        { timeout: 20000 }
      );
      const popularCalls = apiCalls.filter((url) => url.includes("/popular.json"));
      assert.ok(popularCalls.length > popularBefore, "expected a popular request");
      const popularUrl = new URL(popularCalls.at(-1));
      assert.equal(popularUrl.searchParams.get("scale"), "day");
      assert.ok(!popularUrl.searchParams.get("tags"));
      const popularBadges = await page.$$eval("#grid .badge", (els) => els.map((el) => el.textContent));
      assert.ok(popularBadges.every((b) => b === "S"), `non-safe popular visible: ${popularBadges}`);
      log(`PASS popular day view (${popularBadges.length} safe thumbs after client filter)`);
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
