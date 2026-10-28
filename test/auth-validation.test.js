"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {emailOf,validEmail,validPassword}=require("../auth-validation");
test("normalizes email before registration and login",()=>{
 assert.equal(emailOf("  User@Example.COM "),"user@example.com");
 assert.equal(emailOf(null),"");
});
test("rejects malformed and oversized emails",()=>{
 for(const value of ["","no-at-sign","x@domain","x @domain.com","x@domain.com ".repeat(20)])assert.equal(validEmail(value),false);
 assert.equal(validEmail("user@example.com"),true);
});
test("password boundaries are enforced for new registrations",()=>{
 assert.equal(validPassword("1234567"),false);
 assert.equal(validPassword("12345678"),true);
 assert.equal(validPassword("a".repeat(128)),true);
 assert.equal(validPassword("a".repeat(129)),false);
 assert.equal(validPassword(null),false);
});
