const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { createApp } = require('../server');

test('accounts and two free generations against isolated local PostgreSQL', async t => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'Set TEST_DATABASE_URL to an isolated local database named velora_accounts_test_*');
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
  assert.ok(target.pathname.startsWith('/velora_accounts_test_'));
  const pool = new Pool({ connectionString: url });
  let calls = 0;
  let failure = false;
  let invalidOutput = false;
  const replicate = { run: async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 25));
    if (failure) throw new Error('Simulated provider failure');
    return invalidOutput ? null : 'https://example.invalid/generated.jpg';
  }};
  const secret = require('crypto').randomBytes(48).toString('hex');
  const { app, initDatabase } = createApp({ pool, replicate, jwtSecret: secret, generationEnabled: true });
  await initDatabase();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, body, token) => {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
      'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  };
  const email = `account-${Date.now()}@example.invalid`;
  const password = 'test-password-123';
  let token;
  const input = { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', prompt: 'Test portrait' };
  await t.test('registration normalizes email and returns exactly two credits without password hash', async () => {
    const r = await request('/api/register', { email: '  '+email.toUpperCase()+'  ', password });
    assert.equal(r.status, 201); assert.equal(r.data.user.email, email);
    assert.equal(r.data.user.credits, 2); assert.equal(r.data.user.password_hash, undefined);
    token = r.data.token;
  });
  await t.test('invalid registration and simultaneous duplicate registrations', async () => {
    assert.equal((await request('/api/register', { email: 'bad', password: 'short' })).status, 400);
    assert.equal((await request('/api/register', { email: 'long@example.invalid', password: 'я'.repeat(40) })).status, 400);
    const duplicate = { email: `race-${Date.now()}@example.invalid`, password };
    const results = await Promise.all([request('/api/register', duplicate), request('/api/register', duplicate)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
    assert.equal((await request('/api/register', { email, password })).status,409);
  });
  await t.test('login and profile persist initial balance; reject invalid sessions', async () => {
    const r = await request('/api/login', { email, password });
    assert.equal(r.status,200); assert.equal(r.data.user.credits,2);
    assert.equal((await request('/api/login', { email, password: 'wrong' })).status,401);
    assert.equal((await request('/api/me', null, token)).data.user.email,email);
    assert.equal((await request('/api/me')).status,401);
    assert.equal((await request('/api/me', null, 'bad')).status,401);
    assert.equal((await request('/api/me', null, jwt.sign({userId:'1'},secret,{expiresIn:-1}))).status,401);
    assert.equal((await request('/api/me', null, jwt.sign({userId:{}},secret))).status,401);
  });
  await t.test('unauthenticated generation and invalid payload never call provider', async () => {
    assert.equal((await request('/api/generate',input)).status,401);
    assert.equal((await request('/api/generate',{image:'bad',prompt:'x'},token)).status,400);
    assert.equal((await request('/api/generate',{image:'data:image/png;base64,aGVsbG8=',prompt:'test'},token)).status,400);
    assert.equal(calls,0);
  });
  await t.test('missing provider configuration does not spend credits', async () => {
    const disabled=createApp({pool,jwtSecret:secret,replicate}).app.listen(0,'127.0.0.1');
    await new Promise(resolve=>disabled.on('listening',resolve));
    try {
      const r=await fetch('http://127.0.0.1:'+disabled.address().port+'/api/generate',{
        method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(input)
      });
      assert.equal(r.status,503);
      assert.equal((await request('/api/me',null,token)).data.user.credits,2);
      assert.equal(calls,0);
    } finally {await new Promise(resolve=>disabled.close(resolve));}
  });
  await t.test('provider failure or missing image leaves balance unchanged', async () => {
    failure=true;
    assert.equal((await request('/api/generate',input,token)).status,502);
    failure=false; invalidOutput=true;
    assert.equal((await request('/api/generate',input,token)).status,502);
    invalidOutput=false;
    assert.equal((await request('/api/me',null,token)).data.user.credits,2);
  });
  await t.test('three concurrent requests produce only two generations and cannot overdraw', async () => {
    const before=calls;
    const results=await Promise.all(Array.from({length:3},()=>request('/api/generate',input,token)));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,200,402]);
    assert.deepEqual(results.filter(r=>r.status===200).map(r=>r.data.credits).sort(),[0,1]);
    assert.equal(calls-before,2);
    assert.equal((await request('/api/me',null,token)).data.user.credits,0);
    await initDatabase();
    assert.equal((await request('/api/login',{email,password})).data.user.credits,0);
    assert.equal((await request('/api/generate',input,token)).status,402);
  });
  await t.test('HTML interface registers, shows profile, restores session and logs out', async () => {
    const {JSDOM}=require('jsdom');
    const html=await (await fetch(base)).text();
    const errors=[];
    const dom=new JSDOM(html,{url:base,runScripts:'dangerously',beforeParse(window){
      window.fetch=(path,options)=>fetch(new URL(path,base),options);
      window.addEventListener('error',e=>errors.push(e.message));
    }});
    t.after(()=>dom.window.close());
    const doc=dom.window.document;
    const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}assert.fail('UI did not reach expected state');};
    doc.getElementById('email').value=`browser-${Date.now()}@example.invalid`;
    doc.getElementById('password').value=password;
    doc.getElementById('register').click();
    await wait(()=>!doc.getElementById('account').hidden);
    assert.equal(doc.getElementById('credits').textContent,'2');
    assert.equal(doc.getElementById('password').value,'');
    assert.ok(dom.window.sessionStorage.getItem('veloraToken'));
    doc.getElementById('logout').click();
    assert.equal(doc.getElementById('account').hidden,true);
    assert.equal(dom.window.sessionStorage.getItem('veloraToken'),null);
    doc.getElementById('password').value=password;
    doc.getElementById('authForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await wait(()=>!doc.getElementById('account').hidden);
    await dom.window.refreshAccount();
    assert.equal(doc.getElementById('credits').textContent,'2');
    const photo=doc.getElementById('photo');
    Object.defineProperty(photo,'files',{value:[new dom.window.File([Buffer.from(input.image.split(',')[1],'base64')],'test.png',{type:'image/png'})]});
    for (const remaining of ['1','0']) {
      doc.getElementById('generate').click();
      await wait(()=>doc.getElementById('credits').textContent===remaining && !doc.getElementById('generate').disabled);
    }
    const before=calls;
    doc.getElementById('generate').click();
    await wait(()=>doc.getElementById('status').textContent.includes('закончились'));
    assert.equal(calls,before);
    const savedToken=dom.window.sessionStorage.getItem('veloraToken');
    const restored=new JSDOM(html,{url:base,runScripts:'dangerously',beforeParse(window){
      window.sessionStorage.setItem('veloraToken',savedToken);
      window.fetch=(path,options)=>fetch(new URL(path,base),options);
    }});
    t.after(()=>restored.window.close());
    await wait(()=>restored.window.document.getElementById('credits').textContent==='0');
    assert.equal(restored.window.document.getElementById('account').hidden,false);
    assert.deepEqual(errors,[]);
  });
});
