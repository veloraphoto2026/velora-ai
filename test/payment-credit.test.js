"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const {creditVerifiedPayment}=require("../src/payments/credit");

function mockPool(){
 const state={events:new Map(),wallets:new Map(),ledger:[],commits:0,rollbacks:0};
 const client={
  async query(sql,args=[]){
   if(sql==="BEGIN")return {rowCount:0,rows:[]};
   if(sql==="COMMIT"){state.commits++;return {rowCount:0,rows:[]};}
   if(sql==="ROLLBACK"){state.rollbacks++;return {rowCount:0,rows:[]};}
   if(sql.includes("INSERT INTO payment_events")){
    const [paymentId,userId,amount]=args;
    if(state.events.has(paymentId))return {rowCount:0,rows:[]};
    state.events.set(paymentId,{user_id:userId,amount_kopecks:amount,status:"confirmed"});
    return {rowCount:1,rows:[{provider_event_id:paymentId}]};
   }
   if(sql.includes("SELECT user_id,amount_kopecks,status FROM payment_events")){
    const e=state.events.get(args[0]);return {rowCount:e?1:0,rows:e?[e]:[]};
   }
   if(sql.includes("INSERT INTO wallets")){
    const [userId,amount]=args;state.wallets.set(userId,(state.wallets.get(userId)||0)+amount);
    return {rowCount:1,rows:[]};
   }
   if(sql.includes("INSERT INTO wallet_ledger")){
    state.ledger.push({userId:args[0],paymentId:args[1],amount:args[2]});
    return {rowCount:1,rows:[]};
   }
   throw new Error("Unexpected query: "+sql);
  },
  release(){}
 };
 return {state,connect:async()=>client};
}
test("verified payment credits wallet and ledger once on replay",async()=>{
 const pool=mockPool();
 const payment={providerPaymentId:"12345",userId:7,amountKopecks:12500};
 assert.deepEqual(await creditVerifiedPayment(pool,payment),{credited:true,replay:false});
 assert.deepEqual(await creditVerifiedPayment(pool,payment),{credited:false,replay:true});
 assert.equal(pool.state.wallets.get(7),12500);
 assert.equal(pool.state.ledger.length,1);
 assert.equal(pool.state.commits,2);
});
test("replayed payment cannot change owner or amount",async()=>{
 const pool=mockPool();
 const payment={providerPaymentId:"12345",userId:7,amountKopecks:12500};
 await creditVerifiedPayment(pool,payment);
 await assert.rejects(()=>creditVerifiedPayment(pool,{...payment,userId:8}),/replay mismatch/);
 await assert.rejects(()=>creditVerifiedPayment(pool,{...payment,amountKopecks:25000}),/replay mismatch/);
 assert.equal(pool.state.wallets.get(7),12500);
 assert.equal(pool.state.ledger.length,1);
 assert.equal(pool.state.rollbacks,2);
});
