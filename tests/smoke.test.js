// Non-destructive smoke checks. Run after deploying the preview API:
// VELORA_API_BASE=https://preview-api.example.com node --test tests/smoke.test.js
// Never calls registration or generation and never spends Replicate credits.
const test = require("node:test");
const assert = require("node:assert/strict");

const base = process.env.VELORA_API_BASE;
if (!base) {
  test("Preview URL is required (set VELORA_API_BASE)", { skip: true }, () => {});
} else {
  const url = base.replace(/\/$/, "");
  test("health endpoint responds successfully", async () => {
    const res = await fetch(url + "/api/health", { signal: AbortSignal.timeout(90000) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });
  test("account profile requires a session", async () => {
    const res = await fetch(url + "/api/me", { signal: AbortSignal.timeout(90000) });
    assert.equal(res.status, 401);
  });
  test("account generation rejects missing session without charging", async () => {
    const res = await fetch(url + "/api/generate/account", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "invalid", prompt: "test" }),
      signal: AbortSignal.timeout(90000)
    });
    assert.equal(res.status, 401);
  });
  test("CORS allows Velora static site", async () => {
    const res = await fetch(url + "/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://velora-ai-wyp6.onrender.com", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
      signal: AbortSignal.timeout(90000)
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "https://velora-ai-wyp6.onrender.com");
  });
  test("CORS does not allow unknown site", async () => {
    const res = await fetch(url + "/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://untrusted.example", "Access-Control-Request-Method": "GET" },
      signal: AbortSignal.timeout(90000)
    });
    assert.notEqual(res.headers.get("access-control-allow-origin"), "https://untrusted.example");
  });
}
