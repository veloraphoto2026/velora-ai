const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const server = fs.readFileSync("server.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
test("server JavaScript parses", () => {
  assert.doesNotThrow(() => new vm.Script(server));
});
test("registration has two initial credits", () => {
  assert.ok(server.includes("credits INTEGER NOT NULL DEFAULT 2"));
});
test("generation is opt-in", () => {
  assert.ok(server.includes('ENABLE_GENERATION !== "true"'));
});
test("generation requires login", () => {
  assert.ok(server.includes('app.post("/api/generate", authenticate'));
});
test("atomic credit reservation", () => {
  assert.ok(server.includes("credits = credits - 1 WHERE id = $1 AND credits > 0"));
});
test("test key is not requested by browser", () => {
  assert.ok(!html.includes('id="testKey"'));
});
