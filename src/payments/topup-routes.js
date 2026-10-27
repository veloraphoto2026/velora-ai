"use strict";
const express=require("express");
const {createPaymentIntent}=require("./intent");
const {initializeTbankPayment}=require("./tbank-init");
// Mounted only after database migration, credentials and sandbox verification.
// The server determines user identity; the browser supplies only an amount.
function createTopupRouter({pool,authenticate,terminalKey,password,notificationURL,successURL,failURL}){
 if(!pool||typeof authenticate!=="function"||!terminalKey||!password)throw new Error("Missing top-up dependencies");
 const router=express.Router();
 router.post("/topups",authenticate,async(req,res)=>{
  const amount=req.body?.amountKopecks;
  if(!Number.isSafeInteger(amount)||amount<10000||amount>10000000)return res.status(400).json({error:"Сумма от 100 до 100 000 ₽"});
  try{
   const intent=await createPaymentIntent(pool,{userId:req.userId,amountKopecks:amount});
   const payment=await initializeTbankPayment({terminalKey,password,orderId:intent.id,amountKopecks:amount,notificationURL,successURL,failURL});
   const updated=await pool.query("UPDATE payment_intents SET provider_payment_id=$2 WHERE id=$1 AND status='pending' AND provider_payment_id IS NULL RETURNING id",[intent.id,payment.paymentId]);
   if(updated.rowCount!==1)throw new Error("Payment intent update failed");
   return res.status(201).json({orderId:String(intent.id),paymentURL:payment.paymentURL});
  }catch(error){
   console.error("Top-up initialization failed",error.message);
   return res.status(503).json({error:"Не удалось создать платёж. Попробуйте позже."});
  }
 });
 return router;
}
module.exports={createTopupRouter};
