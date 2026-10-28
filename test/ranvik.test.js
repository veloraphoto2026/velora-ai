"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const ranvik=require("../ranvik");
test("Ranvik disabled without API key",()=>{
 const prior=process.env.RANVIK_API_KEY;delete process.env.RANVIK_API_KEY;
 try{assert.equal(ranvik.config().enabled,false);}
 finally{if(prior!==undefined)process.env.RANVIK_API_KEY=prior;}
});
test("Ranvik refuses invalid prompt before sending requests",async()=>{
 const old=process.env.RANVIK_API_KEY;process.env.RANVIK_API_KEY="test-placeholder";
 try{await assert.rejects(ranvik.generateImage({prompt:""}),/Invalid prompt/);}
 finally{if(old===undefined)delete process.env.RANVIK_API_KEY;else process.env.RANVIK_API_KEY=old;}
});
test("Ranvik refuses more than four reference images",async()=>{
 const old=process.env.RANVIK_API_KEY;process.env.RANVIK_API_KEY="test-placeholder";
 try{await assert.rejects(ranvik.generateImage({prompt:"portrait",referenceImages:[{},{},{},{},{}]}),/Invalid reference images/);}
 finally{if(old===undefined)delete process.env.RANVIK_API_KEY;else process.env.RANVIK_API_KEY=old;}
});

test("Ranvik sends Bearer auth and a single image request",async()=>{
 const oldKey=process.env.RANVIK_API_KEY,oldFetch=global.fetch;
 process.env.RANVIK_API_KEY="test-placeholder";
 let called=false;
 global.fetch=async(url,options)=>{
  called=true;
  assert.equal(url,"https://api.ranvik.ru/v1/images/generations");
  assert.equal(options.headers.Authorization,"Bearer test-placeholder");
  const body=JSON.parse(options.body);
  assert.equal(body.positivePrompt,"golden studio portrait");
  assert.equal(body.numberResults,1);
  return {ok:true,status:200,json:async()=>({data:[{url:"https://example.invalid/test.png"}]})};
 };
 try{
  const result=await ranvik.generateImage({prompt:"golden studio portrait"});
  assert.equal(called,true);
  assert.equal(result.data[0].url,"https://example.invalid/test.png");
 }finally{
  global.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.RANVIK_API_KEY;
  else process.env.RANVIK_API_KEY=oldKey;
 }
});
test("Ranvik reports upstream errors without revealing API token",async()=>{
 const oldKey=process.env.RANVIK_API_KEY,oldFetch=global.fetch;
 process.env.RANVIK_API_KEY="private-test-token";
 global.fetch=async()=>({ok:false,status:401,json:async()=>({error:"invalid key"})});
 try{
  await assert.rejects(ranvik.generateImage({prompt:"portrait"}),e=>e.message==="Ranvik request failed: HTTP 401"&&!e.message.includes("private-test-token"));
 }finally{
  global.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.RANVIK_API_KEY;
  else process.env.RANVIK_API_KEY=oldKey;
 }
});

test("Ranvik rejects malformed reference image without calling provider",async()=>{
 const oldKey=process.env.RANVIK_API_KEY,oldFetch=global.fetch;
 process.env.RANVIK_API_KEY="test-placeholder";
 global.fetch=()=>{throw Error("Provider must not be called")};
 try{
  await assert.rejects(ranvik.generateImage({prompt:"portrait",referenceImages:[{}]}),/Invalid reference image object/);
  await assert.rejects(ranvik.generateImage({prompt:"portrait",referenceImages:[{image:"https://example.invalid/p.png",strength:2}]}),/Invalid reference image object/);
 }finally{
  global.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.RANVIK_API_KEY;
  else process.env.RANVIK_API_KEY=oldKey;
 }
});
