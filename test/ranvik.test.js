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
