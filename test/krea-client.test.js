"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {generateKreaImage}=require("../src/ranvik/krea-client");
test("Krea sends bearer token only to configured Ranvik endpoint",async()=>{
 let called=0;
 const response=await generateKreaImage({apiKey:"test-secret",prompt:"Beautiful studio portrait",fetchImpl:async(url,options)=>{
  called++;
  assert.equal(url,"https://api.ranvik.ru/v1/images/generations");
  assert.equal(options.headers.authorization,"Bearer test-secret");
  const body=JSON.parse(options.body);
  assert.equal(body.model,"krea-2-turbo");
  assert.equal(body.positivePrompt,"Beautiful studio portrait");
  return {ok:true,json:async()=>({data:[{url:"https://example.com/image.png"}]})};
 }});
 assert.equal(called,1);assert.equal(response.data.length,1);
});
test("Krea refuses request without key",async()=>{
 await assert.rejects(()=>generateKreaImage({prompt:"portrait"}),/RANVIK_API_KEY/);
});
test("Krea fails closed on provider HTTP errors",async()=>{
 await assert.rejects(()=>generateKreaImage({apiKey:"test",prompt:"portrait",fetchImpl:async()=>({ok:false,status:402})}),/HTTP 402/);
});
