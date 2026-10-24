const test = require('node:test');
const assert = require('node:assert/strict');
const { requireLocalTestDatabase } = require('./test-database.cjs');
test('integration tests reject production destinations before connection', () => {
  for (const value of [undefined, '', 'postgres://user:example@db.example.test/velora_test', 'postgres://localhost/production', 'postgres://db.example.test/velora_test?application_name=localhost', 'https://localhost/velora_test', 'postgres://localhost/velora_test?host=db.example.test', 'postgres://localhost/velora_test?hostaddr=192.0.2.1']) {
    assert.throws(() => requireLocalTestDatabase(value));
  }
  for (const value of ['postgres://localhost/velora_test', 'postgresql://postgres@127.0.0.1:5432/velora_test_preview']) {
    assert.doesNotThrow(() => requireLocalTestDatabase(value));
  }
});
