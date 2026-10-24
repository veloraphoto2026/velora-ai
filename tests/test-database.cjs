// These integration suites create and remove disposable test rows. Never use a
// production URL: reject unsafe destinations before starting a server or a pool.
function requireLocalTestDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('TEST_DATABASE_URL is required for an isolated local test database'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || !local || !/^velora_test(?:_[a-z0-9_]+)?$/.test(name)) {
    throw new Error('Tests require a local velora_test database; production and remote databases are forbidden');
  }
}
module.exports = { requireLocalTestDatabase };
