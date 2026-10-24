const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(([,source]) => source);

test('all frontend scripts compile before registration or login is used', () => {
  assert.ok(scripts.length);
  for (const source of scripts) assert.doesNotThrow(() => new vm.Script(source));
});

test('registration and login handlers refresh two-credit profile; logout clears session', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'mode' ? 'real' : '', textContent:'', style:{}, listeners:{},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      appendChild() {}, removeAttribute() {}, files:[],
    });
    return elements.get(id);
  }
  const saved = new Map();
  const requests = [];
  const context = vm.createContext({
    document: {getElementById:element, createElement:()=>element('new-option')},
    sessionStorage: {getItem:key=>saved.get(key) || null, setItem:(key,value)=>saved.set(key,value), removeItem:key=>saved.delete(key)},
    URL, console,
    fetch: async (route, options={}) => {
      requests.push({route, options});
      if (route === '/api/me') {
        assert.equal(options.headers.Authorization, 'Bearer offline-ui-session');
        return {ok:true, json:async()=>({success:true,user:{email:'preview@example.test',credits:2}})};
      }
      assert.ok(['/api/register','/api/login'].includes(route));
      assert.deepEqual(JSON.parse(options.body), {email:'preview@example.test',password:'offline-ui-password'});
      return {ok:true, json:async()=>({success:true,token:'offline-ui-session'})};
    },
  });
  for (const source of scripts) new vm.Script(source).runInContext(context);
  element('authEmail').value=' preview@example.test ';
  element('authPassword').value='offline-ui-password';
  await element('registerButton').listeners.click();
  assert.match(element('creditsStatus').textContent,/preview@example.test.*2/);
  assert.equal(element('authPassword').value,'');
  assert.equal(saved.get('velora_token'),'offline-ui-session');
  element('logoutButton').listeners.click();
  assert.equal(saved.has('velora_token'),false);
  assert.equal(element('creditsStatus').textContent,'');
  element('authPassword').value='offline-ui-password';
  await element('loginButton').listeners.click();
  assert.match(element('creditsStatus').textContent,/Бесплатных генераций: 2/);
  assert.deepEqual(requests.map(r=>r.route),['/api/register','/api/me','/api/login','/api/me']);
});
