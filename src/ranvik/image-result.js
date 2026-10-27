"use strict";
// Validate provider result before settlement. A malformed response must not be billed.
function extractImageUrl(response){
 const candidates=[
  response?.data?.[0]?.url,
  response?.data?.[0]?.image_url,
  response?.images?.[0]?.url,
  response?.output?.[0],
  response?.output?.url,
  response?.url
 ];
 for(const candidate of candidates){
  if(typeof candidate!=="string")continue;
  try{
   const parsed=new URL(candidate);
   if(parsed.protocol==="https:"&&parsed.hostname&&parsed.username===""&&parsed.password==="")return parsed.toString();
  }catch{}
 }
 throw new Error("Ranvik response has no valid HTTPS image URL");
}
module.exports={extractImageUrl};
