"use strict";
const emailOf=x=>typeof x==="string"?x.trim().toLowerCase():"";
const validEmail=x=>x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const validPassword=x=>typeof x==="string"&&x.length>=8&&x.length<=128;
module.exports={emailOf,validEmail,validPassword};
