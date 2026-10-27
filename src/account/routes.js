"use strict";
// Read-only endpoints for a paid platform. Safe to mount without enabling paid operations.
const express = require("express");
function createAccountRouter({pool,authenticate}) {
  if (!pool || typeof authenticate !== "function") throw new Error("Missing dependencies");
  const router=express.Router();
  router.use(authenticate);
  router.get("/wallet",async(req,res)=>{
    try {
      const result=await pool.query("SELECT balance_kopecks,reserved_kopecks FROM wallets WHERE user_id=$1",[req.userId]);
      if(!result.rows.length) return res.json({success:true,balanceKopecks:"0",reservedKopecks:"0",availableKopecks:"0",currency:"RUB"});
      const {balance_kopecks,reserved_kopecks}=result.rows[0];
      res.json({success:true,balanceKopecks:String(balance_kopecks),reservedKopecks:String(reserved_kopecks),availableKopecks:(BigInt(balance_kopecks)-BigInt(reserved_kopecks)).toString(),currency:"RUB"});
    } catch(e) {res.status(503).json({success:false,error:"Кошелёк временно недоступен"});}
  });
  router.get("/jobs",async(req,res)=>{
    try {
      const result=await pool.query("SELECT id,modality,model_id,quoted_price_kopecks,status,created_at FROM generation_jobs WHERE user_id=$1 ORDER BY id DESC LIMIT 50",[req.userId]);
      res.json({success:true,jobs:result.rows});
    } catch(e) {res.status(503).json({success:false,error:"История временно недоступна"});}
  });
  return router;
}
module.exports={createAccountRouter};
