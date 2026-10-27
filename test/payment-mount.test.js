"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {mountPaidPlatform}=require("../src/platform/mount");
const fakePool={query:async()=>({rows:[]})},authenticate=(_req,_res,next)=>next();
test("payment routes stay disabled by default",()=>{
 const routes=[],app={use:(...args)=>routes.push(args[0])};
 const result=mountPaidPlatform(app,{pool:fakePool,authenticate,env:{}});
 assert.deepEqual(result,{paymentsEnabled:false});
 assert.equal(routes.length,2);
 assert.ok(!routes.some(p=>p.includes("tbank")));
});
test("explicit payment enablement fails without server secrets",()=>{
 const app={use:()=>{}};
 assert.throws(()=>mountPaidPlatform(app,{pool:fakePool,authenticate,env:{VELORA_TBANK_ENABLED:"true"}}),/missing required server configuration/);
});
