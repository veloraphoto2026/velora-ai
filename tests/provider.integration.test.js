const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const path = require("node:path");

test("mocked Replicate failure refunds credit, success consumes one, and limit blocks further calls", { timeout: 45000 }, async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  const port = 41000 + Math.floor(Math.random() * 1000);
  const email = "provider-test-" + Date.now() + "@example.test";
  const env = {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET: "test-only-secret-do-not-use-in-production-12345",
    REPLICATE_API_TOKEN: "offline-test-token",
    VELORA_GENERATION_ENABLED: "true",
    VELORA_DAILY_GENERATION_LIMIT: "1",
    TEST_REPLICATE_FAIL: "true",
    NODE_OPTIONS: "--require " + path.join(process.cwd(), "tests/mock-replicate.cjs"),
  };
  const child = spawn(process.execPath, ["server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", x => { logs += x.toString(); });
  child.stderr.on("data", x => { logs += x.toString(); });
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const request = async (route, body, token) => {
    const response = await fetch("http://127.0.0.1:" + port + route, {
      method: body ? "POST" : "GET",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) break;
      try { if ((await request("/api/health")).status === 200) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Server did not start: " + logs);
    const registration = await request("/api/register", { email, password: "password123" });
    assert.equal(registration.status, 201, JSON.stringify(registration.data));
    const token = registration.data.token;
    const image = "data:image/png;base64," + Buffer.from("test image bytes").toString("base64");
    const generate = () => request("/api/generate", { image, prompt: "Portrait" }, token);
    const failed = await generate();
    assert.equal(failed.status, 500, JSON.stringify(failed.data));
    const afterFailure = await request("/api/me", undefined, token);
    assert.equal(afterFailure.data.user.credits, 2, "Failed provider call must refund credit");
    const user = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
    const jobs = await pool.query("SELECT status FROM generation_jobs WHERE user_id=$1", [user.rows[0].id]);
    assert.deepEqual(jobs.rows.map(x => x.status), ["failed"]);
    // A failed job must not consume the daily quota.
    const usage = await pool.query("SELECT COUNT(*)::integer AS n FROM generation_jobs WHERE user_id=$1 AND status IN ('reserved','completed')", [user.rows[0].id]);
    assert.equal(usage.rows[0].n, 0);
  } finally {
    await pool.query("DELETE FROM generation_jobs WHERE user_id IN (SELECT id FROM users WHERE email=$1)", [email]).catch(() => {});
    await pool.query("DELETE FROM users WHERE email=$1", [email]).catch(() => {});
    await pool.end();
    child.kill();
  }
});
