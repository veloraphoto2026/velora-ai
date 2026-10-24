const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {createApp}=require('../server');
const {billingFromEnv,rubles,kopeks}=require('../billing');

test('YooKassa configuration fails closed and never rounds prices',()=>{
  assert.equal(billingFromEnv({}),null);
  assert.equal(rubles(12345),'123.45'); assert.equal(kopeks('123.45'),12345);
  assert.equal(kopeks('1.001'),null);
  assert.throws(()=>billingFromEnv({PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'other'}));
  assert.throws(()=>billingFromEnv({PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'yookassa',PUBLIC_APP_URL:'https://example.invalid',PAID_GENERATION_PRICE_KOPEKS:'0'}));
});

test('YooKassa transport keeps authorization on its fixed HTTPS destination',async()=>{
  const env={PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'yookassa',PAYMENTS_MODE:'test',
    PAID_GENERATION_PRICE_KOPEKS:'12345',PUBLIC_APP_URL:'https://example.invalid',
    YOOKASSA_SHOP_ID:'local-fixture',YOOKASSA_SECRET_KEY:'local-fixture-secret'};
  assert.throws(()=>billingFromEnv({...env,NODE_ENV:'production',ENABLE_GENERATION:'true'}));
  assert.throws(()=>billingFromEnv({...env,PUBLIC_APP_URL:'http://example.invalid'}));
  const billing=billingFromEnv(env);
  const saved=global.fetch;
  const calls=[];
  try {
    global.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({id:'fixture'}),{status:200});};
    await billing.client.createPayment({amount:{value:'123.45',currency:'RUB'}},randomUUID());
    assert.equal(calls[0].url,'https://api.yookassa.ru/v3/payments');
    assert.equal(calls[0].options.redirect,'error');
    assert.ok(calls[0].options.headers.Authorization.startsWith('Basic '));
    assert.ok(!calls[0].url.includes('local-fixture-secret'));
    assert.ok(!calls[0].options.body.includes('local-fixture-secret'));
    global.fetch=async()=>new Response('private provider details',{status:401});
    await assert.rejects(billing.client.getPayment(randomUUID()),/Payment provider request failed/);
  } finally {global.fetch=saved;}
});

test('paid continuation on real local PostgreSQL with a fake YooKassa API',async t=>{
  const url=new URL(process.env.TEST_DATABASE_URL || 'invalid');
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname.startsWith('/velora_accounts_test_'));
  const pool=new Pool({connectionString:url.href});
  const payments=new Map(); const keys=new Map();
  let providerReads=0, generationCalls=0, failGeneration=false, failPaymentRead=false;
  const client={
    createPayment:async(body,key)=>{
      if(keys.has(key))return payments.get(keys.get(key));
      const id=randomUUID();
      const payment={id,status:'pending',paid:false,test:true,amount:body.amount,metadata:body.metadata,
        confirmation:{confirmation_url:'https://yoomoney.ru/checkout/payments/v2/contract?orderId='+id}};
      payments.set(id,payment);keys.set(key,id);return payment;
    },
    getPayment:async id=>{providerReads++;if(failPaymentRead)throw new Error('API unavailable');return payments.get(id);}
  };
  const billing={client,amount:12345,currency:'RUB',origin:'https://example.invalid',testMode:true};
  const replicate={run:async()=>{generationCalls++;if(failGeneration)throw new Error('Simulated failure');return 'https://example.invalid/result.png';}};
  const {app,initDatabase}=createApp({pool,replicate,jwtSecret:randomBytes(48).toString('hex'),generationEnabled:true,billing});
  await initDatabase();
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(path,body,token,headers={})=>{
    const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json()};
  };
  const registered=await request('/api/register',{email:`billing-${Date.now()}@example.invalid`,password:'test-password-123'});
  assert.equal(registered.status,201);
  const token=registered.data.token; const userId=registered.data.user.id;
  const profile=async()=> (await request('/api/me',null,token)).data.user;
  const image={image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',prompt:'Local test'};
  const notify=id=>request('/api/billing/webhook',{type:'notification',event:'payment.succeeded',object:{id,status:'succeeded',paid:true}});
  let payment,requestKey;
  await t.test('only an authenticated account can open checkout; tariff comes from server',async()=>{
    assert.equal((await request('/api/billing/checkout',{},null)).status,401);
    assert.equal((await request('/api/billing/checkout',{},token)).status,400);
    const data=(await request('/api/billing',null,token)).data;
    assert.equal(data.amount,12345); assert.equal(data.currency,'RUB'); assert.equal(data.test_mode,true);
    requestKey=randomUUID();
    const headers={'idempotency-key':requestKey};
    const attempts=await Promise.all([request('/api/billing/checkout',{amount:1,credits:999},token,headers),request('/api/billing/checkout',{},token,headers)]);
    assert.ok(attempts.every(r=>r.status===200));assert.equal(attempts[0].data.url,attempts[1].data.url);
    assert.equal(payments.size,1);
    payment=[...payments.values()][0];assert.equal(payment.amount.value,'123.45');
    assert.equal((await profile()).paid_credits,0);
  });
  await t.test('forged success body and a return URL do not credit unpaid orders',async()=>{
    assert.equal((await notify(payment.id)).status,503);
    assert.equal((await profile()).paid_credits,0);
    assert.equal((await fetch(base+'/?payment=success')).status,200);
    assert.equal((await profile()).paid_credits,0);
    const reads=providerReads;
    assert.equal((await notify(randomUUID())).status,200);assert.equal(providerReads,reads);
    const original=payment.amount;
    payment.status='succeeded';payment.paid=true;payment.amount={value:'0.01',currency:'RUB'};
    assert.equal((await notify(payment.id)).status,503);assert.equal((await profile()).paid_credits,0);
    payment.amount=original;
  });
  await t.test('provider outage requests a retry without changing balance',async()=>{
    failPaymentRead=true;
    assert.equal((await notify(payment.id)).status,503);
    failPaymentRead=false;assert.equal((await profile()).paid_credits,0);
  });
  await t.test('concurrent confirmed notifications add exactly one paid generation',async()=>{
    const r=await Promise.all([notify(payment.id),notify(payment.id),notify(payment.id)]);
    assert.ok(r.every(x=>x.status===200));
    assert.equal((await profile()).paid_credits,1);
    assert.equal((await profile()).credits,2);
    const status=await request('/api/billing?request_key='+requestKey,null,token);
    assert.equal(status.data.last_order_paid,true);
  });
  await t.test('free credits are spent first, failed paid generation is refunded, then limit is enforced',async()=>{
    for(const remaining of [1,0]){
      const r=await request('/api/generate',image,token);
      assert.equal(r.status,200);assert.equal(r.data.credits,remaining);assert.equal(r.data.paid_credits,1);
    }
    failGeneration=true;assert.equal((await request('/api/generate',image,token)).status,502);
    assert.equal((await profile()).paid_credits,1);failGeneration=false;
    const key=randomUUID(),before=generationCalls;
    const attempts=await Promise.all([request('/api/generate',image,token,{'idempotency-key':key}),request('/api/generate',image,token,{'idempotency-key':key})]);
    assert.ok(attempts.every(r=>r.status===200));assert.equal(generationCalls-before,1);
    assert.equal((await profile()).paid_credits,0);
    const conflict=await request('/api/generate',{...image,prompt:'different'},token,{'idempotency-key':key});
    assert.equal(conflict.status,409);
    assert.equal((await request('/api/generate',image,token)).status,402);
    await initDatabase();assert.equal((await profile()).paid_credits,0);assert.equal((await profile()).credits,0);
    assert.equal((await notify(payment.id)).status,200);assert.equal((await profile()).paid_credits,0);
  });
  await t.test('payment status is scoped to account and never exposes user password or card data',async()=>{
    const other=await request('/api/register',{email:`other-${Date.now()}@example.invalid`,password:'test-password-123'});
    const scoped=await request('/api/billing?request_key='+requestKey,null,other.data.token);
    assert.equal(scoped.data.last_order_paid,false);
    const me=await profile();assert.equal(me.password_hash,undefined);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM billing_orders WHERE user_id=$1',[userId])).rows[0].count,1);
  });  await t.test('return flow recovers a confirmed payment even if notification was lost',async()=>{
    const key=randomUUID();
    const order=await request('/api/billing/checkout',{},token,{'idempotency-key':key});
    assert.equal(order.status,200);
    const recovered=[...payments.values()].at(-1);recovered.status='succeeded';recovered.paid=true;
    const results=await Promise.all([request('/api/billing/reconcile',{request_key:key},token),notify(recovered.id)]);
    assert.ok(results.every(r=>r.status===200));assert.equal((await profile()).paid_credits,1);
    assert.equal((await request('/api/billing/reconcile',{request_key:randomUUID()},token)).status,404);
  });

});
