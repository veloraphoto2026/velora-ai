"use strict";
const {buildKreaRequest}=require("./krea-request");
// Staged provider adapter: NOT mounted as a public route and never called automatically.
// Paid job runner must reserve funds before invoking this function.
async function generateKreaImage({apiKey,prompt,width=1024,height=1024,fetchImpl=globalThis.fetch}){
 if(typeof apiKey!=="string"||!apiKey.trim())throw new Error("RANVIK_API_KEY missing");
 const payload=buildKreaRequest({prompt,width,height});
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),120000);
 try{
  const response=await fetchImpl("https://api.ranvik.ru/v1/images/generations",{
   method:"POST",headers:{"authorization":`Bearer ${apiKey}`,"content-type":"application/json"},
   body:JSON.stringify(payload),signal:controller.signal
  });
  if(!response.ok)throw new Error("Ranvik image request failed (HTTP "+response.status+")");
  const result=await response.json();
  if(!result||typeof result!=="object")throw new Error("Invalid Ranvik response");
  return result;
 }finally{clearTimeout(timeout);}
}
module.exports={generateKreaImage};
