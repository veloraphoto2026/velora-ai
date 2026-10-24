const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/);

test('server JavaScript parses', () => {
  assert.doesNotThrow(() => new Function(server));
});
test('website JavaScript parses', () => {
  assert.ok(script, 'inline website script missing');
  assert.doesNotThrow(() => new Function(script[1]));
});
test('generation requires login', () => {
  assert.match(server, /app\.post\("\/api\/generate", authenticate,/);
  assert.match(script[1], /sessionStorage\.getItem\("veloraToken"\)/);
  assert.doesNotMatch(script[1], /if \(!key\)/);
});
test('new users receive two credits by default', () => {
  assert.match(server, /credits INTEGER NOT NULL DEFAULT 2/);
});
test('credit reservation is atomic and requires a positive balance', () => {
  assert.match(server, /UPDATE users SET credits = credits - 1 WHERE id = \$1 AND credits > 0 RETURNING credits/);
  assert.match(server, /res\.status\(402\)/);
});
test('provider errors trigger refund attempt', () => {
  assert.match(server, /if \(reserved\)/);
  assert.match(server, /UPDATE users SET credits = credits \+ 1 WHERE id = \$1/);
});
test('server does not expose provider token in frontend', () => {
  assert.doesNotMatch(html, /REPLICATE_API_TOKEN|JWT_SECRET|DATABASE_URL/);
});

test('frontend sends requests to dedicated Render API', () => {
  assert.match(script[1], /const API_BASE = "https:\/\/velora-ai-api-4rra\.onrender\.com"/);
  assert.match(script[1], /fetch\(apiUrl\(endpoint\)/);
  assert.match(script[1], /fetch\(apiUrl\("\/api\/me"\)/);
  assert.match(script[1], /fetch\(apiUrl\("\/api\/generate"\)/);
});
test('browser CORS is limited to official website', () => {
  assert.match(server, /allowedOrigins/);
  assert.match(server, /velora-ai-wyp6\.onrender\.com/);
  assert.doesNotMatch(server, /app\.use\(cors\(\)\)/);
});
test('generation resolves image URL and releases reserved credit on errors', () => {
  assert.match(server, /await candidate\.url\(\)/);
  assert.match(server, /await pool\.query\("UPDATE users SET credits = credits \+ 1/);
});
