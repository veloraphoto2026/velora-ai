const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createApp}=require('../server');
const secret=require('crypto').randomBytes(48).toString('hex');

async function serve(t,options={}){
  const {app}=createApp({pool:{query:async()=>({rows:[]})},jwtSecret:secret,...options});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.on('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return 'http://127.0.0.1:'+server.address().port;
}

test('security headers prevent framing, script injection and API caching',async t=>{
  const base=await serve(t);
  const r=await fetch(base);
  assert.equal(r.headers.get('x-powered-by'),null);
  assert.equal(r.headers.get('x-frame-options'),'DENY');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  const csp=r.headers.get('content-security-policy');
  assert.match(csp,/script-src 'self' 'sha256-/);
  assert.match(csp,/frame-ancestors 'none'/);
  assert.match(csp,/connect-src 'self'/);
  const scriptPolicy=csp.split(';').find(p=>p.trim().startsWith('script-src '));
  assert.ok(!scriptPolicy.includes('unsafe-inline'));
  const profile=await fetch(base+'/api/me');
  assert.equal(profile.headers.get('cache-control'),'no-store');
  assert.equal(profile.headers.get('access-control-allow-origin'),null);
});

test('auth and generation throttles cannot be bypassed by spoofed forwarded addresses',async t=>{
  const base=await serve(t,{rateLimits:{register:1,login:1,generate:1}});
  for(const path of ['/api/register','/api/login','/api/generate']){
    const first=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'198.51.100.1'},body:'{}'});
    assert.ok([400,401].includes(first.status));
    const second=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'198.51.100.2'},body:'{}'});
    assert.equal(second.status,429);
    assert.equal((await second.json()).success,false);
    assert.ok(second.headers.get('retry-after'));
  }
});

test('invalid JSON is handled and database outage changes health to unavailable',async t=>{
  const base=await serve(t,{pool:{query:async()=>{throw new Error('private database details')}}});
  const health=await fetch(base+'/api/health');
  assert.equal(health.status,503);
  assert.equal((await health.json()).status,'unavailable');
  const bad=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:'{bad'});
  assert.equal(bad.status,400);
  assert.ok(!(await bad.text()).includes('SyntaxError'));
});

test('production rejects a weak signing key before connecting to any database',()=>{
  const env={...process.env,NODE_ENV:'production',JWT_SECRET:'short'};
  const result=spawnSync(process.execPath,['server.js'],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);
  assert.match(result.stderr,/at least 32 bytes/);
});
