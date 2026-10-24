const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const server = fs.readFileSync(require("node:path").join(__dirname,"..","server.js"),"utf8");
const html = fs.readFileSync(require("node:path").join(__dirname,"..","index.html"),"utf8");
test("registration and profile endpoints are present",()=>{
  assert.match(server,/app\.post\("\/api\/register"/);
  assert.match(server,/app\.post\("\/api\/login"/);
  assert.match(server,/app\.get\("\/api\/me", authenticate/);
});
test("default free credits and atomic debit",()=>{
  assert.match(server,/credits INTEGER NOT NULL DEFAULT 2/);
  assert.match(server,/credits = credits - 1 WHERE id = \$1 AND credits > 0/);
  assert.match(server,/BEGIN/);
  assert.match(server,/generation_jobs/);
});
test("generation is disabled by default and requires authentication",()=>{
  assert.match(server,/VELORA_GENERATION_ENABLED !== "true"/);
  assert.match(server,/app\.post\("\/api\/generate", limitRequests, authenticate/);
  assert.doesNotMatch(server,/x-velora-key/);
});
test("mobile UI contains registration, login and balance",()=>{
  assert.match(html,/id="registerButton"/);
  assert.match(html,/id="loginButton"/);
  assert.match(html,/id="creditsStatus"/);
  assert.match(html,/Authorization": "Bearer " \+ authToken/);
});

test("database initialization must finish before server starts",()=>{
  assert.match(server,/initDatabase\(\)\.then\(\(\) =>/);
});
test("provider response supports array output",()=>{
  assert.match(server,/Array\.isArray\(output\) \? output\[0\] : output/);
});
test("only one in-flight generation per user is allowed",()=>{
  assert.match(server,/SELECT id FROM users WHERE id=\$1 FOR UPDATE/);
  assert.match(server,/status='reserved' LIMIT 1 FOR UPDATE/);
});

test("daily generation cap must be explicitly configured and enforced inside a transaction",()=>{
  assert.match(server,/VELORA_DAILY_GENERATION_LIMIT \|\| 0/);
  assert.match(server,/Number\.isSafeInteger\(dailyLimit\)/);
  assert.match(server,/pg_advisory_xact_lock\(861729, 1\)/);
  assert.match(server,/dailyUsage\.rows\[0\]\.total >= dailyLimit/);
  assert.match(server,/Дневной лимит генераций достигнут/);
});

test("database enforces one pending generation per user",()=>{
  assert.match(server,/CREATE UNIQUE INDEX IF NOT EXISTS one_reserved_job_per_user/);
  assert.match(server,/ON generation_jobs \(user_id\) WHERE status = 'reserved'/);
});

test("iPhone photo picker matches accepted server formats and privacy notice",()=>{
  assert.match(html,/<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(html,/id="photo" accept="image\/jpeg,image\/png"/);
  assert.doesNotMatch(html,/accept="[^"]*image\/heic/);
  assert.match(html,/сервису Replicate для обработки/);
  assert.match(html,/HEIC/);
});
