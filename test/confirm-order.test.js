"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {confirmTbankOrder}=require("../src/payments/confirm-order");
function fixture({orderStatus="pending",amount=10000,previousPayment=null}={}){
 const state={order:{id:"17",user_id:"9",amount_kopecks:amount,status:orderStatus,provider_payment_id:null},events:new Map(),balance:0,ledger:[],commits:0,rollbacks:0};
 if(previousPayment)state.events.set(previousPayment.id,previousPayment);
 const client={release(){},async query(sql,args=[]){
  if(sql==="BEGIN")return {};
  if(sql==="COMMIT"){state.commits++;return {};}
  if(sql==="ROLLBACK"){state.rollbacks++;return {};}
  if(sql.includes("FROM payment_intents")&&sql.includes("FOR UPDATE"))return {rowCount:1,rows:[state.order]};
  if(sql.startsWith("INSERT INTO payment_events")){
   if(state.events.has(args[0]))return {rowCount:0,rows:[]};
   state.events.set(args[0],{id:33,user_id:args[1],amount_kopecks:args[2],status:"confirmed"});
   return {rowCount:1,rows:[{id:33}]};
  }
  if(sql.startsWith("INSERT INTO wallets")){state.balance+=args[1];return {rowCount:1,rows:[]};}
  if(sql.startsWith("INSERT INTO wallet_ledger")){state.ledger.push(args);return {rowCount:1,rows:[]};}
  if(sql.startsWith("SELECT user_id,amount_kopecks,status FROM payment_events")){const e=state.events.get(args[0]);return {rowCount:e?1:0,rows:e?[e]:[]};}
  if(sql.startsWith("SELECT id FROM payment_intents"))return {rowCount:0,rows:[]};
  if(sql.startsWith("UPDATE payment_intents")){state.order.status="confirmed";state.order.provider_payment_id=args[1];return {rowCount:1,rows:[{id:17}]};}
  throw Error("Unexpected SQL: "+sql);
 }};
 return {state,pool:{connect:async()=>client}};
}
test("confirmation credits once and replays without duplicate ledger",async()=>{
 const {pool,state}=fixture();
 assert.deepEqual(await confirmTbankOrder(pool,{orderId:"17",paymentId:"321",amountKopecks:10000}),{credited:true,replay:false});
 assert.deepEqual(await confirmTbankOrder(pool,{orderId:"17",paymentId:"321",amountKopecks:10000}),{credited:false,replay:true});
 assert.equal(state.balance,10000);assert.equal(state.ledger.length,1);assert.equal(state.commits,2);
});
test("amount mismatch fails before wallet update",async()=>{
 const {pool,state}=fixture();
 await assert.rejects(()=>confirmTbankOrder(pool,{orderId:"17",paymentId:"321",amountKopecks:20000}),/Amount mismatch/);
 assert.equal(state.balance,0);assert.equal(state.rollbacks,1);
});
test("cancelled order cannot be credited",async()=>{
 const {pool,state}=fixture({orderStatus:"cancelled"});
 await assert.rejects(()=>confirmTbankOrder(pool,{orderId:"17",paymentId:"321",amountKopecks:10000}),/not payable/);
 assert.equal(state.balance,0);
});
