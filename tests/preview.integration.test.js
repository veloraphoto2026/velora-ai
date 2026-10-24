const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {previewSettings,createPreview}=require('../preview/server');
const {initDatabase}=require('../server');
const database=`velora_preview_test_${randomBytes(8).toString('hex')}`;
const settings={PREVIEW_MODE:'mock',JWT_SECRET:randomBytes(48).toString('hex'),DATABASE_URL:`postgres://postgres@127.0.0.1:${process.env.VELORA_TEST_PGPORT||5432}/${database}`,RENDER_EXTERNAL_URL:'https://velora-account-preview.onrender.com',RENDER_SERVICE_NAME:'velora-account-preview'};
let admin,pool,server,base,preview;
before(async()=>{
 admin=new Pool({host:'127.0.0.1',port:Number(process.env.VELORA_TEST_PGPORT||5432),user:'postgres',database:'postgres'});
 await admin.query(`CREATE DATABASE ${database}`);
 pool=new Pool({connectionString:settings.DATABASE_URL});await initDatabase(pool);
 preview=createPreview({pool,settings});server=preview.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
 console.log(`Preview test database retained: ${database}`);
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();if(admin)await admin.end();});
async function api(path,body,token,key){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
test('preview guard rejects production service, production DB and provider credentials before queries',()=>{
 for(const patch of [{PREVIEW_MODE:'live'},{RENDER_SERVICE_NAME:'velora-ai'},{RENDER_SERVICE_NAME:'velora-ai-api'},{REPLICATE_API_TOKEN:'not-a-real-token'},{VELORA_TEST_KEY:'not-a-real-key'},{DATABASE_URL:'postgres://postgres@127.0.0.1/production'},{JWT_SECRET:'short'},{RENDER_EXTERNAL_URL:'https://velora-ai-api-4rra.onrender.com'},{RENDER_EXTERNAL_URL:'http://example.test'}]){
  let queries=0;
  assert.throws(()=>createPreview({pool:{query(){queries++;throw new Error('must never query');}},settings:{...settings,...patch}}));
  assert.equal(queries,0);
 }
 assert.equal(previewSettings(settings).origin,settings.RENDER_EXTERNAL_URL);
});
test('preview is visibly labelled and serves a clearly simulated result',async()=>{
 const home=await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/ТЕСТОВАЯ СРЕДА/);assert.equal(home.headers.get('x-velora-preview'),'mock-no-replicate');
 const result=await fetch(base+'/preview-result.svg');assert.equal(result.status,200);assert.match(await result.text(),/MOCK RESULT/);
 assert.equal((await api('/api/health')).body.success,true);
});
test('register, login, profile, mock refund, two free generations, and exhausted balance',async()=>{
 const email=`${randomUUID()}@example.test`,password='preview-test-password';
 const registered=await api('/api/register',{email,password});assert.equal(registered.status,201);assert.equal(registered.body.user.credits,2);
 const login=await api('/api/login',{email,password});assert.equal(login.status,200);const token=login.body.token;
 assert.equal((await api('/api/me',null,token)).body.user.credits,2);
 const photo={image:'data:image/png;base64,iVBORw0KGgo=',prompt:'mock portrait'};
 const failed=await api('/api/generate/account',{...photo,prompt:'[mock:fail]'},token,randomUUID());assert.equal(failed.status,502);assert.equal((await api('/api/me',null,token)).body.user.credits,2);
 const key=randomUUID();
 const first=await api('/api/generate/account',photo,token,key);assert.equal(first.status,200);assert.equal(first.body.credits,1);assert.equal(first.body.image,settings.RENDER_EXTERNAL_URL+'/preview-result.svg');
 assert.equal((await api('/api/generate/account',photo,token,key)).body.credits,1);
 const second=await api('/api/generate/account',photo,token,randomUUID());assert.equal(second.status,200);assert.equal(second.body.credits,0);
 const calls=preview.mockCalls();assert.equal(calls,3);
 assert.equal((await api('/api/generate/account',photo,token,randomUUID())).status,402);assert.equal(preview.mockCalls(),calls);
 assert.equal((await api('/api/register',{email:email.toUpperCase(),password})).status,409);
 assert.equal((await api('/api/login',{email,password})).body.user.credits,0);
 await initDatabase(pool);assert.equal((await api('/api/me',null,token)).body.user.credits,0);
 assert.equal((await api('/api/generate',photo)).status,503);
});
