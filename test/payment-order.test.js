"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {paymentAction}=require("../payment-order");
test("first paid callback credits order",()=>assert.equal(paymentAction("created"),"credit"));
test("repeated paid callback only acknowledges",()=>assert.equal(paymentAction("paid"),"acknowledge"));
test("cancelled and unknown orders cannot credit",()=>{
 for(const status of ["cancelled","refunded","failed",null,undefined,""])assert.equal(paymentAction(status),"reject");
});
test("replaying a callback cannot trigger second credit",()=>{
 let status="created",credits=0;
 for(let i=0;i<3;i++){
  const action=paymentAction(status);
  if(action==="credit"){credits++;status="paid";}
  else assert.equal(action,"acknowledge");
 }
 assert.equal(credits,1);
});
