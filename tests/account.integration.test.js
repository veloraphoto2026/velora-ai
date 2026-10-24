const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createApp, initDatabase, databaseOptions } = require('../server');

// Intentionally cannot consume DATABASE_URL or use a remote DB. Each run creates
// its own database and retains it for inspection; no production data or deletes.
const database = `velora_test_${randomBytes(8).toString('hex')}`;
const connection = {host:'127.0.0.1', port: Number(process.env.VELORA_TEST_PGPORT || 5432), user:'postgres'};
let pool, admin, server, base, calls = 0, behavior;
const secret = randomBytes(48).toString('hex');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const photo = {image, prompt:'Test portrait'};
const output = 'https://example.test/generated.jpg';
const replicate = {async run(model, options, progress) { calls++; return behavior ? behavior(progress) : output; }};
async function api(path, {body, token, key, headers, method} = {}) {
 const response = await fetch(base + path, {method:method || (body ? 'POST' : 'GET'), headers:{'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`} : {}), ...(key?{'Idempotency-Key':key}:{}), ...headers}, ...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status, body:await response.json(), headers:response.headers};
}
async function account(email=`${randomUUID()}@example.test`) {
 const response = await api('/api/register', {body:{email,password:'test-password-123'}});
 assert.equal(response.status,201); assert.equal(response.body.user.credits,2);
 return {...response.body, email};
}
const balance = async user => (await api('/api/me',{token:user.token})).body.user.credits;
const generate = (user,key=randomUUID(),body=photo) => api('/api/generate/account',{token:user.token, key, body});
before(async()=>{
 admin = new Pool({...connection,database:'postgres'});
 await admin.query(`CREATE DATABASE ${database}`);
 pool = new Pool({...connection,database});
 await initDatabase(pool);
 const app = createApp({pool,replicate,jwtSecret:secret,authLimit:1000});
 server = app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 base=`http://127.0.0.1:${server.address().port}`;
 console.log(`Isolated test database retained: ${database}`);
});
after(async()=>{if(server) await new Promise(resolve=>server.close(resolve)); if(pool) await pool.end(); if(admin) await admin.end();});

test('two credits once; case variants, login and startup cannot grant again',async()=>{
 const user=await account();
 assert.equal((await generate(user)).status,200);
 assert.equal(await balance(user),1);
 const duplicate=await api('/api/register',{body:{email:user.email.toUpperCase(),password:'test-password-123',credits:999}});
 assert.equal(duplicate.status,409);
 const login=await api('/api/login',{body:{email:user.email.toUpperCase(),password:'test-password-123'}});
 assert.equal(login.status,200); assert.equal(login.body.user.credits,1);
 await initDatabase(pool); assert.equal(await balance(user),1);
 const stored=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[user.user.id])).rows[0];
 assert.notEqual(stored.password_hash,'test-password-123');
 assert.ok(await bcrypt.compare('test-password-123',stored.password_hash));
 assert.equal(login.body.user.password_hash,undefined);
});
test('concurrent duplicate registration grants only one account',async()=>{
 const email=`${randomUUID()}@example.test`;
 const responses=await Promise.all(Array.from({length:4},()=>api('/api/register',{body:{email,password:'test-password-123'}})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409,409,409]);
 const result=await pool.query('SELECT credits FROM users WHERE email=$1',[email]);
 assert.equal(result.rowCount,1); assert.equal(result.rows[0].credits,2);
});
test('parallel requests spend exactly two; third never invokes provider',async()=>{
 const user=await account(), start=calls;
 const results=await Promise.all(Array.from({length:6},()=>generate(user)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,200,402,402,402,402]);
 assert.equal(calls-start,2); assert.equal(await balance(user),0);
 assert.equal((await generate(user)).status,402); assert.equal(calls-start,2);
});
test('same request key replays successful result without debit or provider call',async()=>{
 const user=await account(), key=randomUUID(), start=calls;
 const first=await generate(user,key); const second=await generate(user,key);
 assert.equal(first.status,200); assert.deepEqual(second.body,first.body);
 assert.equal(calls-start,1); assert.equal(await balance(user),1);
 assert.equal((await generate(user,key,{...photo,prompt:'Different'})).status,409);
 assert.equal(calls-start,1);
});
test('concurrent duplicate in-flight request is not sent twice',async()=>{
 const user=await account(), key=randomUUID(), start=calls;
 let entered, release;
 const waiting=new Promise(resolve=>entered=resolve);
 behavior=()=>new Promise(resolve=>{release=()=>resolve(output);entered();});
 try {
  const first=generate(user,key); await waiting;
  const second=await generate(user,key);
  assert.equal(second.status,409); assert.equal(second.body.code,'GENERATION_PROCESSING');
  release(); assert.equal((await first).status,200);
  assert.equal(await balance(user),1); assert.equal(calls-start,1);
 } finally { if(release) release(); behavior=null; }
});
test('provider failure refunds once; replay cannot double refund',async()=>{
 const user=await account(), key=randomUUID(), start=calls;
 behavior=progress=>{progress({status:'failed'});throw new Error('Mock provider failure');};
 try {
  assert.equal((await generate(user,key)).status,502);
  assert.equal(await balance(user),2);
  assert.equal((await generate(user,key)).status,409);
  assert.equal(await balance(user),2); assert.equal(calls-start,1);
 } finally {behavior=null;}
 assert.equal((await generate(user)).status,200); assert.equal(await balance(user),1);
});
test('invalid provider output refunds and is never shown as image URL',async()=>{
 const user=await account(); behavior=()=> 'javascript:alert(1)';
 try {assert.equal((await generate(user)).status,502); assert.equal(await balance(user),2);}
 finally {behavior=null;}
});
test('failed reservation transaction never spends or invokes provider',async()=>{
 const user=await account(), start=calls;
 // Failure before the reservation commit, using a deterministic DB exception.
 await pool.query(`CREATE FUNCTION reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insert failure'; END $$`);
 await pool.query('CREATE TRIGGER reject_test_job BEFORE INSERT ON generation_requests FOR EACH ROW EXECUTE FUNCTION reject_test_job()');
 try { assert.equal((await generate(user)).status,503); assert.equal(await balance(user),2); assert.equal(calls,start); }
 finally {await pool.query('ALTER TABLE generation_requests DISABLE TRIGGER reject_test_job');}
});
test('missing, forged, expired, wrong-algorithm and invalid-subject JWTs are rejected',async()=>{
 const user=await account(), start=calls;
 for(const token of [null,'invalid', jwt.sign({userId:user.user.id},'incorrect-secret'), jwt.sign({userId:user.user.id},secret,{expiresIn:-1}), jwt.sign({userId:user.user.id},secret,{algorithm:'HS384'}), jwt.sign({userId:'not-an-id'},secret),jwt.sign({userId:'9999999999999999999'},secret)]) {
  assert.equal((await api('/api/me',{token})).status,401);
  assert.equal((await api('/api/generate/account',{token,body:photo,key:randomUUID()})).status,401);
 }
 assert.equal(calls,start); assert.equal(await balance(user),2);
});
test('request-supplied identity and balance cannot charge another user',async()=>{
 const first=await account(), second=await account();
 assert.equal((await generate(first,randomUUID(),{...photo,userId:second.user.id,credits:999})).status,200);
 assert.equal(await balance(first),1);assert.equal(await balance(second),2);
});
test('invalid passwords, SQL input and duplicate accounts cannot bypass authentication',async()=>{
 const user=await account();
 for(const body of [{email:user.email,password:'wrong-password'}, {email:"' OR 1=1 --",password:'test-password-123'},{email:'missing@example.test',password:'test-password-123'}]) {
  const response=await api('/api/login',{body}); assert.equal(response.status,401);assert.equal(response.body.token,undefined);
 }
 for(const password of ['short','a'.repeat(73),'я'.repeat(37)]) {
  assert.equal((await api('/api/register',{body:{email:`${randomUUID()}@example.test`,password}})).status,400);
 }
 assert.equal((await api('/api/login',{body:{email:user.email,password:'a'.repeat(73)}})).status,400);
});
test('invalid generation, missing idempotency key and legacy bypass do not spend',async()=>{
 const user=await account(), start=calls;
 assert.equal((await generate(user,randomUUID(),{image:'bad',prompt:'test'})).status,400);
 assert.equal((await api('/api/generate/account',{token:user.token,body:photo})).status,400);
 assert.equal((await api('/api/generate',{body:photo,headers:{'x-velora-key':'anything'}})).status,503);
 assert.equal(await balance(user),2); assert.equal(calls,start);
});
test('authentication is rate limited and forwarded IP cannot bypass it',async()=>{
 const limited = createApp({pool,replicate,jwtSecret:secret,authLimit:2});
 const listener=limited.listen(0,'127.0.0.1');await new Promise(resolve=>listener.once('listening',resolve));
 try {
  for(let i=0;i<3;i++) {
   const response=await fetch(`http://127.0.0.1:${listener.address().port}/api/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`192.0.2.${i}`},body:'{}'});
   assert.equal(response.status,i===2?429:400);
   if(i===2) assert.ok(response.headers.get('retry-after'));
  }
 } finally {await new Promise(resolve=>listener.close(resolve));}
});
test('short or missing JWT secret fails before serving or writing data',()=>{
 for(const jwtSecret of [undefined,'short']) assert.throws(()=>createApp({pool,replicate,jwtSecret}),/JWT_SECRET/);
});

test('ambiguous provider timeout holds reservation and cannot invoke it again',async()=>{
 const user=await account(), key=randomUUID(), start=calls;
 behavior=()=>{throw new Error('network timeout after acceptance');};
 try {
  const first=await generate(user,key); assert.equal(first.status,503); assert.equal(first.body.code,'GENERATION_UNCERTAIN');
  assert.equal(await balance(user),1);
  assert.equal((await generate(user,key)).status,409);
  assert.equal(calls-start,1); assert.equal(await balance(user),1);
 } finally {behavior=null;}
});
test('result persistence failure never refunds a completed paid prediction',async()=>{
 const user=await account(), key=randomUUID(), start=calls;
 const original=pool.query;
 pool.query=function(sql,...args) {
  if(sql.startsWith("UPDATE generation_requests SET status='succeeded'")) return Promise.reject(new Error('test persistence failure'));
  return original.call(this,sql,...args);
 };
 try {assert.equal((await generate(user,key)).status,503);}
 finally {pool.query=original;}
 assert.equal(await balance(user),1); assert.equal((await generate(user,key)).status,409);assert.equal(calls-start,1);
});

test('remote PostgreSQL TLS verification cannot be bypassed through URL parameters',()=>{
 const remote=databaseOptions({DATABASE_URL:'postgres://user:example@db.example.test/db?sslmode=no-verify&ssl=false&application_name=localhost'});
 assert.deepEqual(remote.ssl,{rejectUnauthorized:true});
 assert.equal(new URL(remote.connectionString).searchParams.has('sslmode'),false);
 assert.equal(new URL(remote.connectionString).searchParams.has('ssl'),false);
 assert.equal(databaseOptions({DATABASE_URL:'postgres://postgres@127.0.0.1/velora'}).ssl,undefined);
 assert.deepEqual(databaseOptions({PGHOST:'db.example.test',DATABASE_SSL_CA:'test-ca'}).ssl,{ca:'test-ca',rejectUnauthorized:true});
});

test('existing smoke suite passes against this isolated local app (no preview or Render)',async()=>{
 const {execFile}=require('node:child_process');
 const {promisify}=require('node:util');
 const childEnv={...process.env,VELORA_API_BASE:base};
 delete childEnv.NODE_TEST_CONTEXT;
 const {stdout}=await promisify(execFile)(process.execPath,['--test','--test-reporter=tap',require.resolve('./smoke.test.js')],{env:childEnv});
 assert.match(stdout,/pass 5/);assert.match(stdout,/skipped 0/);
 console.log('Local smoke suite: 5 passed, 0 skipped');
});

test('new-account grant is explicit even with a stale database default or forged balance',async()=>{
 await pool.query('ALTER TABLE users ALTER COLUMN credits SET DEFAULT 99');
 try {
  const response=await api('/api/register',{body:{email:`${randomUUID()}@example.test`,password:'test-password-123',credits:999}});
  assert.equal(response.status,201);assert.equal(response.body.user.credits,2);
 } finally {await pool.query('ALTER TABLE users ALTER COLUMN credits SET DEFAULT 2');}
});
test('idempotency survives application restart using persisted request records',async()=>{
 const user=await account(), key=randomUUID(), start=calls;
 assert.equal((await generate(user,key)).status,200);
 const fresh=createApp({pool,replicate,jwtSecret:secret});
 const listener=fresh.listen(0,'127.0.0.1');await new Promise(resolve=>listener.once('listening',resolve));
 try {
  const response=await fetch(`http://127.0.0.1:${listener.address().port}/api/generate/account`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.token}`,'Idempotency-Key':key},body:JSON.stringify(photo)});
  assert.equal(response.status,200);assert.equal((await response.json()).image,output);
  assert.equal(await balance(user),1);assert.equal(calls-start,1);
 } finally {await new Promise(resolve=>listener.close(resolve));}
});
