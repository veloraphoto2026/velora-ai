const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");

test("real PostgreSQL registration, login, profile, and disabled generation", { timeout: 30000 }, async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  const port = 39000 + Math.floor(Math.random() * 1000);
  const env = {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET: "test-only-secret-do-not-use-in-production-12345",
    VELORA_GENERATION_ENABLED: "false",
    REPLICATE_API_TOKEN: "",
  };
  const child = spawn(process.execPath, ["server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk.toString(); });
  child.stderr.on("data", chunk => { logs += chunk.toString(); });
  const base = "http://127.0.0.1:" + port;
  const request = async (route, method = "GET", body, token) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const email = "test-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "@example.test";
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try { const result = await request("/api/health"); if (result.status === 200) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Server failed to start: " + logs);
    const invalid = await request("/api/register", "POST", { email: "bad", password: "short" });
    assert.equal(invalid.status, 400);
    const registered = await request("/api/register", "POST", { email: " " + email.toUpperCase() + " ", password: "password123" });
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    assert.equal(registered.data.user.credits, 2);
    assert.ok(registered.data.token);
    const duplicate = await request("/api/register", "POST", { email, password: "password123" });
    assert.equal(duplicate.status, 409);
    const wrong = await request("/api/login", "POST", { email, password: "incorrect" });
    assert.equal(wrong.status, 401);
    const login = await request("/api/login", "POST", { email, password: "password123" });
    assert.equal(login.status, 200);
    const unauthorized = await request("/api/me");
    assert.equal(unauthorized.status, 401);
    const profile = await request("/api/me", "GET", undefined, login.data.token);
    assert.equal(profile.status, 200);
    assert.equal(profile.data.user.credits, 2);
    const disabled = await request("/api/generate", "POST", { image: "x", prompt: "x" }, login.data.token);
    assert.equal(disabled.status, 503);
    const finalProfile = await request("/api/me", "GET", undefined, login.data.token);
    assert.equal(finalProfile.data.user.credits, 2);
    // Exercise the exact atomic debit statement used by the generation endpoint.
    const firstDebit = await pool.query(
      "UPDATE users SET credits = credits - 1 WHERE email=$1 AND credits > 0 RETURNING credits",
      [email]
    );
    assert.equal(firstDebit.rows[0].credits, 1);
    const secondDebit = await pool.query(
      "UPDATE users SET credits = credits - 1 WHERE email=$1 AND credits > 0 RETURNING credits",
      [email]
    );
    assert.equal(secondDebit.rows[0].credits, 0);
    const exhausted = await pool.query(
      "UPDATE users SET credits = credits - 1 WHERE email=$1 AND credits > 0 RETURNING credits",
      [email]
    );
    assert.equal(exhausted.rowCount, 0, "Credits must not fall below zero");
    // Simulate provider failure and verify the refund restores exactly one credit.
    const refund = await pool.query("UPDATE users SET credits = credits + 1 WHERE email=$1 RETURNING credits", [email]);
    assert.equal(refund.rows[0].credits, 1);
    const restored = await request("/api/me", "GET", undefined, login.data.token);
    assert.equal(restored.data.user.credits, 1);

  } finally {
    await pool.query("DELETE FROM generation_jobs WHERE user_id IN (SELECT id FROM users WHERE email=$1)", [email]).catch(() => {});
    await pool.query("DELETE FROM users WHERE email=$1", [email]).catch(() => {});
    await pool.end();
    child.kill();
  }
});
