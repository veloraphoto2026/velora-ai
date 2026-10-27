"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const {notificationToken,verifyNotification}=require("../src/payments/tbank-token");
const {initializeTbankPayment}=require("../src/payments/tbank-init");

test("T-Bank token excludes Token and nested DATA",()=>{
 const p={TerminalKey:"test",Amount:10000,OrderId:"123",DATA:{secret:"ignored"}};
 const t=notificationToken(p,"password");
 assert.match(t,/^[a-f0-9]{64}$/);
 assert.equal(t,notificationToken({...p,Token:"x",DATA:{secret:"different"}},"password"));
 assert.ok(verifyNotification({...p,Token:t},"password"));
 assert.equal(verifyNotification({...p,Amount:10001,Token:t},"password"),false);
});
test("T-Bank Init builds signed payload without exposing password",async()=>{
 let sent;
 const result=await initializeTbankPayment({
  terminalKey:"test",password:"password",orderId:"123",amountKopecks:10000,
  fetchImpl:async(_url,opts)=>{
   sent=JSON.parse(opts.body);
   return {ok:true,json:async()=>({Success:true,PaymentId:"456",PaymentURL:"https://securepay.tinkoff.ru/payment/456"})};
  }
 });
 assert.equal(result.paymentId,"456");
 assert.equal(sent.Amount,10000);
 assert.equal(sent.OrderId,"123");
 assert.equal(sent.Password,undefined);
 assert.equal(sent.Token,notificationToken(sent,"password"));
});
test("T-Bank Init rejects non-HTTPS redirect",async()=>{
 await assert.rejects(()=>initializeTbankPayment({
  terminalKey:"test",password:"password",orderId:"123",amountKopecks:10000,
  fetchImpl:async()=>({ok:true,json:async()=>({Success:true,PaymentId:"456",PaymentURL:"http://example.com"})})
 }),/Unsafe bank payment URL/);
});
