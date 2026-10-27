"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildKreaRequest,SIZES}=require("../src/ranvik/krea-request");
test("Krea request matches documented required fields",()=>{
 const p=buildKreaRequest({prompt:"  Портрет при мягком свете  "});
 assert.equal(p.model,"krea-2-turbo");
 assert.equal(p.positivePrompt,"Портрет при мягком свете");
 assert.equal(p.width,1024);assert.equal(p.height,1024);
 assert.equal(p.numberResults,1);assert.equal(p.deliveryMethod,"sync");
});
test("Krea accepts exactly documented sizes",()=>{
 for(const [width,height] of SIZES)assert.equal(buildKreaRequest({prompt:"portrait",width,height}).width,width);
 assert.throws(()=>buildKreaRequest({prompt:"portrait",width:999,height:999}),/Unsupported/);
});
test("Krea rejects invalid prompt",()=>{
 assert.throws(()=>buildKreaRequest({prompt:" "}),/Prompt/);
 assert.throws(()=>buildKreaRequest({prompt:"x".repeat(10001)}),/Prompt/);
});
