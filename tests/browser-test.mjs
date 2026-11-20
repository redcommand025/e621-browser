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


  log("All browser tests passed.");
} catch (error) {
  failures = 1;
  console.error("BROWSER TEST FAILED:", error);
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failures) process.exit(1);
