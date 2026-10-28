"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const jwt=require("jsonwebtoken");
const {tokenFor,userIdFromToken}=require("../auth-token");
const secret="local-test-only-secret";
test("session round trip preserves PostgreSQL BIGINT user ID",()=>{
 const id="9223372036854775807";
 assert.equal(userIdFromToken(tokenFor(id,secret),secret),id);
});
test("rejects missing, tampered, and expired sessions",()=>{
 assert.equal(userIdFromToken(null,secret),null);
 const token=tokenFor("12",secret);
 assert.equal(userIdFromToken(token+"x",secret),null);
 const expired=jwt.sign({userId:"12",exp:1},secret,{algorithm:"HS256"});
 assert.equal(userIdFromToken(expired,secret),null);
});
test("rejects invalid or out-of-range user identifiers",()=>{
 for(const id of [0,-1,"0","-1","abc","9223372036854775808"]){
  const token=jwt.sign({userId:id},secret,{algorithm:"HS256"});
  assert.equal(userIdFromToken(token,secret),null);
 }
});
test("rejects tokens signed with a different secret",()=>{
 assert.equal(userIdFromToken(tokenFor("2","another-secret"),secret),null);
});
