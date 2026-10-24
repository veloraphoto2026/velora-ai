const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { requireLocalTestDatabase } = require("./test-database.cjs");

test("mock Replicate: success consumes a credit, provider failure refunds it, no paid calls", {
  timeout: 60000,
  skip: !process.env.TEST_DATABASE_URL ? "Requires isolated TEST_DATABASE_URL" : false
}, async () => {
  requireLocalTestDatabase(process.env.TEST_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const emails = [];
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const request = async (base, route, method = "GET", body, token) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  };
  async function scenario(mode, expectedStatus, expectedCredits, expectedJobStatus) {
    const port = 41000 + Math.floor(Math.random() * 10000);
    const base = "http://127.0.0.1:" + port;
    const env = {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      JWT_SECRET: "test-only-secret-do-not-use-in-production-12345",
      REPLICATE_API_TOKEN: "mock-token-no-real-provider-access",
      VELORA_GENERATION_ENABLED: "true",
      VELORA_DAILY_GENERATION_LIMIT: "1000",
      VELORA_MOCK_REPLICATE: mode,
      NODE_OPTIONS: "--require=" + path.join(__dirname, "replicate-stub.cjs")
    };
    const child = spawn(process.execPath, ["server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    child.stdout.on("data", chunk => { logs += chunk.toString(); });
    child.stderr.on("data", chunk => { logs += chunk.toString(); });
    const email = "mock-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "@example.test";
    emails.push(email);
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) break;
        try {
          if ((await request(base, "/api/health")).status === 200) { ready = true; break; }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(ready, "Server did not start: " + logs);
      const registered = await request(base, "/api/register", "POST", { email, password: "safe-password-123" });
      assert.equal(registered.status, 201, JSON.stringify(registered.data));
      assert.equal(registered.data.user.credits, 2);
      const generated = await request(base, "/api/generate", "POST", { image, prompt: "Studio portrait" }, registered.data.token);
      assert.equal(generated.status, expectedStatus, JSON.stringify(generated.data));
      if (mode === "success") assert.equal(generated.data.image, "https://example.test/velora-mock-image.jpg");
      const profile = await request(base, "/api/me", "GET", undefined, registered.data.token);
      assert.equal(profile.data.user.credits, expectedCredits);
      const jobs = await pool.query(
        "SELECT status FROM generation_jobs WHERE user_id = (SELECT id FROM users WHERE email = $1)",
        [email]
      );
      assert.equal(jobs.rowCount, 1);
      assert.equal(jobs.rows[0].status, expectedJobStatus);
    } finally {
      child.kill();
    }
  }
  try {
    await scenario("success", 200, 1, "completed");
    await scenario("fail", 500, 2, "failed");
  } finally {
    for (const email of emails) {
      await pool.query("DELETE FROM generation_jobs WHERE user_id IN (SELECT id FROM users WHERE email=$1)", [email]).catch(() => {});
      await pool.query("DELETE FROM users WHERE email=$1", [email]).catch(() => {});
    }
    await pool.end();
  }
});
