"use strict";
// First supported model request builder. Pure function: no API calls or charges.
const SIZES=Object.freeze([[1024,1024],[1184,896],[1248,832],[1376,768],[1568,672],[928,1152],[832,1248],[768,1376]]);
function buildKreaRequest({prompt,width=1024,height=1024}={}){
 if(typeof prompt!=="string"||prompt.trim().length<2||prompt.trim().length>10000)throw new Error("Prompt length must be 2..10000");
 if(!SIZES.some(([w,h])=>w===width&&h===height))throw new Error("Unsupported Krea size");
 return {model:"krea-2-turbo",positivePrompt:prompt.trim(),width,height,numberResults:1,deliveryMethod:"sync",inputs:{referenceImages:[]}};
}
module.exports={buildKreaRequest,SIZES};
