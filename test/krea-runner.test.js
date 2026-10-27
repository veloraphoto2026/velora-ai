"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {extractImageUrl,runKreaGeneration}=require("../src/platform/krea-runner");
test("accepts only HTTPS provider image URL",()=>{
 assert.equal(extractImageUrl({data:[{url:"https://example.com/image.png"}]}),"https://example.com/image.png");
 for(const url of ["http://example.com/a.png","https://user:pass@example.com/a.png","file:///tmp/x"]){
  assert.throws(()=>extractImageUrl({data:[{url}]}),/Invalid image URL/);
 }
 assert.throws(()=>extractImageUrl({data:[]}),/verified image URL/);
});
test("refuses missing API key before reserving wallet",async()=>{
 let called=false;
 await assert.rejects(()=>runKreaGeneration({pool:{connect:async()=>{called=true;}},userId:1,prompt:"portrait"}),/Provider key missing/);
 assert.equal(called,false);
});
test("refuses invalid prompt before reserving wallet",async()=>{
 let called=false;
 await assert.rejects(()=>runKreaGeneration({pool:{connect:async()=>{called=true;}},apiKey:"test",userId:1,prompt:" "}),/Prompt/);
 assert.equal(called,false);
});
