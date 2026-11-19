import test from "node:test";
import assert from "node:assert/strict";
import { describeApiFailure } from "../js/api.js";

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
