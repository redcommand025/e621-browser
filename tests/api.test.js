import test from "node:test";
import assert from "node:assert/strict";
import {
  describeApiFailure,
  encodeBasicAuth,
  hasBasicAuth,
  normalizeApiKey,
  verifyBasicAuth,
} from "../js/api.js";

test("JSON errors use the plain message and never return HTML", () => {
  assert.equal(
    describeApiFailure(403, "application/json", '{"message":"You cannot search for more than 40 tags"}'),
    "You cannot search for more than 40 tags"
  );
  const html = describeApiFailure(
    403,
    "text/html",
    "<html><h1>Access Denied</h1><p>Cloudflare</p></html>"
  );
  assert.equal(html.includes("<"), false);
  assert.equal(html.includes("Access Denied"), false);
  assert.match(html, /403/);
});

test("rate-limit and unexpected responses stay short and readable", () => {
  assert.match(describeApiFailure(503, "text/html", "<html>error</html>"), /rate-limiting/);
  assert.match(describeApiFailure(200, "text/html", "<html>challenge</html>"), /unexpected|failed/i);
});

test("normalizeApiKey strips spaces and line breaks from pasted keys", () => {
  assert.equal(normalizeApiKey("  ab cd\n12\t "), "abcd12");
});

test("encodeBasicAuth builds a Basic header and rejects empty values", () => {
  const header = encodeBasicAuth("bitWolfy", " abc def ");
  assert.equal(header, "Basic " + btoa("bitWolfy:abcdef"));
  assert.throws(() => encodeBasicAuth("bitWolfy", "   "), /username and API key/);
});

test("AuthenticationFailure JSON is shown as a rejected sign-in, not a class name", () => {
  assert.equal(
    describeApiFailure(401, "application/json", '{"success":false,"message":"SessionLoader::AuthenticationFailure","code":null}'),
    "e621 rejected the username or API key."
  );
  assert.equal(describeApiFailure(401, "text/plain", ""), "e621 rejected the username or API key.");
  assert.match(
    describeApiFailure(403, "application/json", '{"message":"API access disabled"}'),
    /API access may be disabled/
  );
});

test("verifyBasicAuth distinguishes 401, 403, network errors, and success", async () => {
  await assert.rejects(
    () =>
      verifyBasicAuth("somebody", "bad-key", {
        fetchImpl: async () =>
          new Response(JSON.stringify({ success: false, message: "SessionLoader::AuthenticationFailure" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      }),
    { message: /rejected the username or API key/ }
  );

  await assert.rejects(
    () =>
      verifyBasicAuth("somebody", "bad-key", {
        fetchImpl: async () =>
          new Response(JSON.stringify({ message: "API access is disabled for this account" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      }),
    { message: /API access may be disabled/ }
  );

  await assert.rejects(
    () =>
      verifyBasicAuth("somebody", "key", {
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    { message: /network or CORS/ }
  );

  const seen = {};
  const user = await verifyBasicAuth("somebody", "good-key", {
    fetchImpl: async (url, opts) => {
      seen.url = String(url);
      seen.auth = opts.headers.Authorization;
      return new Response(JSON.stringify({ name: "somebody", id: 9 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(user.name, "somebody");
  assert.match(seen.url, /\/users\/somebody\.json/);
  assert.equal(seen.auth, encodeBasicAuth("somebody", "good-key"));
  assert.equal(hasBasicAuth(), false);
});

