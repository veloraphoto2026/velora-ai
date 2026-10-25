const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const port = 32000 + Math.floor(Math.random() * 1000);
const base = "http://127.0.0.1:" + port;
const databaseUrl = process.env.TEST_DATABASE_URL;

test("HTTP registration, login, balance and disabled generation with real PostgreSQL", { skip: !databaseUrl, timeout: 30000 }, async () => {
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      ENABLE_GENERATION: "false",
      REPLICATE_API_TOKEN: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const request = async (path, options = {}) => {
    const response = await fetch(base + path, options);
    return { status: response.status, body: await response.json() };
  };
  const post = (path, body, token) => request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body)
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error("Server exited: " + stderr);
      try {
        const health = await request("/api/health");
        if (health.body.databaseReady) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "PostgreSQL initialization failed: " + stderr);
    const email = "integration-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "@example.test";
    const password = "Test-password-123!";
    const registered = await post("/api/register", { email, password });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.credits, 2);
    assert.ok(registered.body.token);
    const duplicate = await post("/api/register", { email, password });
    assert.equal(duplicate.status, 409);
    const wrong = await post("/api/login", { email, password: "incorrect-password" });
    assert.equal(wrong.status, 401);
    const login = await post("/api/login", { email, password });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.credits, 2);
    const unauthorized = await request("/api/me");
    assert.equal(unauthorized.status, 401);
    const profile = await request("/api/me", { headers: { Authorization: "Bearer " + login.body.token } });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.credits, 2);
    const disabled = await post("/api/generate", { image: "invalid", prompt: "test" }, login.body.token);
    assert.equal(disabled.status, 503);
    const unchanged = await request("/api/me", { headers: { Authorization: "Bearer " + login.body.token } });
    assert.equal(unchanged.body.user.credits, 2);
  } finally {
    child.kill("SIGTERM");
  }
});
