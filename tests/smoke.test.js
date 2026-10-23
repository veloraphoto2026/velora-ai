const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const server = fs.readFileSync("server.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

test("server JavaScript parses", () => assert.doesNotThrow(() => new vm.Script(server)));
test("frontend JavaScript parses", () => {
  assert.ok(script, "Inline script must exist");
  assert.doesNotThrow(() => new vm.Script(script));
});
test("new accounts receive exactly two free credits by default", () => {
  assert.match(server, /credits INTEGER NOT NULL DEFAULT 2/);
  assert.match(server, /ALTER COLUMN credits SET DEFAULT 2/);
});
test("credits are debited atomically and only when positive", () => {
  assert.match(server, /UPDATE users SET credits = credits - 1 WHERE id = \$1 AND credits > 0 RETURNING id/);
});
test("failed generations refund reserved credit", () => {
  assert.match(server, /UPDATE users SET credits = credits \+ 1 WHERE id = \$1/);
});
test("successful generation does not refund on balance lookup failure", () => {
  assert.match(server, /catch \(balanceError\)/);
});
test("frontend calls deployed API, not static site", () => {
  assert.match(html, /const API_BASE = "https:\/\/velora-ai-api-4rra\.onrender\.com"/);
  assert.doesNotMatch(html, /fetch\("\/api\//);
});
test("authentication endpoints and protected account endpoint exist", () => {
  for (const endpoint of ["/api/register", "/api/login", "/api/me"]) {
    assert.ok(server.includes('"' + endpoint + '"'), endpoint);
  }
});
test("public readiness check does not reveal secrets", () => {
  assert.match(server, /app\.get\("\/api\/ready"/);
  assert.doesNotMatch(server, /res\.json\(\{[^}]*JWT_SECRET/);
});
