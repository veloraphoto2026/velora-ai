"use strict";
const crypto=require("node:crypto");
// T-Bank acquiring notification token: SHA-256 of sorted top-level scalar fields
// including Password; Token itself and nested fields must be excluded.
function notificationToken(payload,password){
 if(!password||typeof password!=="string")throw new Error("Missing terminal password");
 if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("Invalid payload");
 const data={};
 for(const [key,value] of Object.entries(payload)){
  if(key==="Token"||key==="DATA"||value===null||typeof value==="object")continue;
  if(typeof value!=="string"&&typeof value!=="number"&&typeof value!=="boolean")continue;
  data[key]=String(value);
 }
 data.Password=password;
 return crypto.createHash("sha256").update(Object.keys(data).sort().map(key=>data[key]).join(""),"utf8").digest("hex");
}
function verifyNotification(payload,password){
 if(typeof payload?.Token!=="string"||!/^[a-f0-9]{64}$/i.test(payload.Token))return false;
 const expected=Buffer.from(notificationToken(payload,password),"hex");
 const supplied=Buffer.from(payload.Token,"hex");
 return expected.length===supplied.length&&crypto.timingSafeEqual(expected,supplied);
}
module.exports={notificationToken,verifyNotification};
