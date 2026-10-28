"use strict";
const API="https://api.ranvik.ru/v1/images/generations";
const MODELS=Object.freeze({"krea-2-turbo":{width:832,height:1248},"reve-2-1":{width:3328,height:4864}});
function config(){
 const model=process.env.RANVIK_IMAGE_MODEL||"krea-2-turbo";
 return {enabled:!!process.env.RANVIK_API_KEY&&!!MODELS[model],model};
}
async function generateImage({prompt,referenceImages=[]}){
 const {enabled,model}=config();
 if(!enabled)throw Error("Ranvik not configured");
 if(typeof prompt!=="string"||prompt.trim().length<2||prompt.length>4000)throw Error("Invalid prompt");
 if(!Array.isArray(referenceImages)||referenceImages.length>4)throw Error("Invalid reference images");
 if(referenceImages.some(item=>!item||typeof item!=="object"||Array.isArray(item)||typeof item.image!=="string"||!item.image.trim()||item.strength!==undefined&&(typeof item.strength!=="number"||item.strength<0||item.strength>1)))throw Error("Invalid reference image object");
 const {width,height}=MODELS[model];
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),120000);
 try{
  const response=await fetch(API,{method:"POST",signal:controller.signal,headers:{"Authorization":"Bearer "+process.env.RANVIK_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model,positivePrompt:prompt,width,height,numberResults:1,deliveryMethod:"sync",inputs:{referenceImages}})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error("Ranvik request failed: HTTP "+response.status);
  return data;
 }finally{clearTimeout(timeout)}
}
module.exports={config,generateImage};
