"use strict";
const {reserveGeneration}=require("../billing/reserve");
const {finalizeGeneration}=require("../billing/finalize");
const {generateKreaImage}=require("../ranvik/krea-client");

// Fail closed: this orchestrator is NOT mounted as an HTTP route.
// Caller must authenticate the user and provide a trusted, server-owned retail quote.
// On uncertain provider failures (timeouts, 5xx, malformed response), hold the
// reservation for reconciliation rather than risk charging twice on retry.
function extractImageUrl(data){
 const url=data?.data?.[0]?.url;
 if(typeof url!=="string")throw new Error("Provider response has no verified image URL");
 let parsed;
 try{parsed=new URL(url);}catch{throw new Error("Invalid image URL");}
 if(parsed.protocol!=="https:"||!parsed.hostname||parsed.username||parsed.password)throw new Error("Invalid image URL");
 return url;
}
async function runKreaGeneration({pool,userId,idempotencyKey,prompt,width=1024,height=1024,priceKopecks,apiKey,provider=generateKreaImage}){
 if(!pool||typeof pool.connect!=="function")throw new Error("Database pool required");
 if(typeof provider!=="function")throw new Error("Provider required");
 if(typeof apiKey!=="string"||!apiKey.trim())throw new Error("Provider key missing");
 // Validate provider payload before any wallet operation.
 const {buildKreaRequest}=require("../ranvik/krea-request");
 buildKreaRequest({prompt,width,height});
 const reserved=await reserveGeneration(pool,{userId,idempotencyKey,modality:"image",modelId:"krea-2-turbo",priceKopecks});
 if(reserved.insufficientFunds)return {status:"insufficient_funds"};
 // A replay is never re-sent to provider, including when prior result is uncertain.
 if(reserved.replay)return {jobId:reserved.jobId,status:reserved.status,replay:true};
 const jobId=reserved.jobId;
 try{
  const raw=await provider({apiKey,prompt,width,height});
  const resultUrl=extractImageUrl(raw);
  const finalized=await finalizeGeneration(pool,{userId,jobId,outcome:"succeeded",resultUrl});
  return {jobId,status:finalized.status,resultUrl};
 }catch(error){
  // The provider may have generated/billed an image despite a network failure.
  // Leave funds reserved until a separate reconciliation path can prove outcome.
  return {jobId,status:"requires_reconciliation"};
 }
}
module.exports={runKreaGeneration,extractImageUrl};
