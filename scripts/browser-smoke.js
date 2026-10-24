const { chromium } = require('playwright');
const { Pool } = require('pg');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { createApp } = require('../server');

(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL || 'invalid');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.startsWith('/velora_accounts_test_'), 'An isolated local TEST_DATABASE_URL is required');
  const pool = new Pool({ connectionString: url.toString() });
  let server, browser;
  let calls = 0;
  try {
    const { app, initDatabase } = createApp({
      pool, jwtSecret: require('crypto').randomBytes(48).toString('hex'), generationEnabled: true,
      replicate: { run: async () => { calls++; return 'https://example.invalid/generated.png'; } }
    });
    await initDatabase();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error' && /content security policy/i.test(msg.text())) errors.push(msg.text()); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() :
      route.request().url() === 'https://example.invalid/generated.png' ? route.fulfill({ contentType: 'image/png', body: png }) : route.abort());
    await page.goto(base);
    const email = `chromium-${Date.now()}@example.invalid`;
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('test-password-123');
    await page.locator('#register').click();
    await page.locator('#account').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#credits').textContent(), '2');
    await page.locator('#photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    for (const remaining of ['1', '0']) {
      await page.locator('#generate').click();
      await page.waitForFunction(value => document.getElementById('credits').textContent === value && !document.getElementById('generate').disabled, remaining);
    }
    await page.locator('#generate').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('закончились'));
    assert.equal(calls, 2);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('credits').textContent === '0');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.locator('#logout').click();
    await page.locator('#authForm').waitFor({ state: 'visible' });
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('test-password-123');
    await page.locator('#login').click();
    await page.locator('#account').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#credits').textContent(), '0');
    assert.deepEqual(errors, []);
    console.log('Chromium: registration, login/logout, two generations, balance persistence, mobile width and CSP passed. No external provider calls.');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
