"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {extractImageUrl}=require("../src/ranvik/image-result");
test("extracts standard image URL",()=>assert.equal(extractImageUrl({data:[{url:"https://images.example.test/1.png"}]}),"https://images.example.test/1.png"));
test("extracts alternate output URL",()=>assert.equal(extractImageUrl({output:["https://images.example.test/2.png"]}),"https://images.example.test/2.png"));
test("rejects malformed and unsafe responses",()=>{
 for(const response of [{},{data:[{url:"http://example.com/x"}]},{output:["javascript:alert(1)"]}])assert.throws(()=>extractImageUrl(response),/no valid HTTPS/);
});
