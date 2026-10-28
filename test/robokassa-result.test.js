"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const test=require("node:test");
const {verifyResult}=require("../robokassa-result");
const password="test-password-2";
function payload(sum="129.50",invoice="42",extra={}){
 const fields=Object.keys(extra).sort().map(k=>k+"="+extra[k]);
 const sig=crypto.createHash("md5").update([sum,invoice,password,...fields].join(":"),"utf8").digest("hex");
 return {OutSum:sum,InvId:invoice,SignatureValue:sig,...extra};
}
test("accepts signed notification and converts rubles to kopecks",()=>{
 assert.deepEqual(verifyResult(payload(),password),{invoiceId:"42",kopecks:12950n});
});
test("rejects forged signature",()=>{
 const p=payload();p.SignatureValue="0".repeat(32);assert.equal(verifyResult(p,password),null);
});
test("rejects altered amount",()=>{
 const p=payload();p.OutSum="1290.50";assert.equal(verifyResult(p,password),null);
});
test("rejects sub-kopeck amounts",()=>{
 assert.equal(verifyResult(payload("12.345"),password),null);
});
test("rejects zero invoice and missing secret",()=>{
 assert.equal(verifyResult(payload("10.00","0"),password),null);
 assert.equal(verifyResult(payload(),""),null);
});
test("verifies sorted custom Shp_ fields",()=>{
 const p=payload("100.00","7",{Shp_user:"8",Shp_order:"7"});
 assert.deepEqual(verifyResult(p,password),{invoiceId:"7",kopecks:10000n});
});
test("rejects tampered custom field",()=>{
 const p=payload("100.00","7",{Shp_user:"8"});p.Shp_user="9";
 assert.equal(verifyResult(p,password),null);
});

test("rejects array payloads and invoice IDs outside PostgreSQL BIGINT",()=>{
 assert.equal(verifyResult([],password),null);
 assert.equal(verifyResult(payload("10.00","9223372036854775808"),password),null);
});
test("accepts largest signed PostgreSQL BIGINT invoice",()=>{
 assert.deepEqual(verifyResult(payload("10.00","9223372036854775807"),password),{invoiceId:"9223372036854775807",kopecks:1000n});
});
