"use strict";
const jwt=require("jsonwebtoken");
function tokenFor(id,secret){
 if(!secret)throw Error("JWT secret not configured");
 return jwt.sign({userId:String(id)},secret,{algorithm:"HS256",expiresIn:"7d"});
}
function userIdFromToken(token,secret){
 if(typeof token!=="string"||!secret)return null;
 try{
  const claims=jwt.verify(token,secret,{algorithms:["HS256"]});
  const id=claims?.userId;
  if(typeof id!=="string"||!/^[1-9]\d*$/.test(id)||BigInt(id)>9223372036854775807n)return null;
  return id;
 }catch{return null;}
}
module.exports={tokenFor,userIdFromToken};
