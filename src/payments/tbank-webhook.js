"use strict";
const express=require("express");
const {verifyNotification}=require("./tbank-token");
const {creditVerifiedPayment}=require("./credit");
// Intentionally not mounted until bank sandbox verification and migrations.
function createTbankWebhookRouter({pool,terminalPassword}){
 if(!pool||!terminalPassword)throw new Error("Missing payment configuration");
 const router=express.Router();
 router.post("/notification",async(req,res)=>{
  const body=req.body;
  if(!body||!verifyNotification(body,terminalPassword))return res.status(403).send("INVALID TOKEN");
  // Only successful, bank-confirmed payments can increase balances.
  if(body.Status!=="CONFIRMED"||body.Success!==true)return res.status(200).send("OK");
  const paymentId=String(body.PaymentId??"");
  const orderId=String(body.OrderId??"");
  const amount=Number(body.Amount);
  if(!/^[0-9]{1,32}$/.test(paymentId)||!/^[0-9]{1,20}$/.test(orderId)||!Number.isSafeInteger(amount)||amount<=0)return res.status(400).send("INVALID PAYMENT");
  try{
   const found=await pool.query("SELECT id,user_id,amount_kopecks,status,provider_payment_id FROM payment_intents WHERE id=$1 AND provider='tbank'",[orderId]);
   if(found.rowCount!==1)return res.status(404).send("UNKNOWN ORDER");
   const intent=found.rows[0];
   if(String(intent.amount_kopecks)!==String(amount))return res.status(409).send("AMOUNT MISMATCH");
   if(intent.provider_payment_id!==null&&String(intent.provider_payment_id)!==paymentId)return res.status(409).send("PAYMENT MISMATCH");
   if(intent.status==="cancelled")return res.status(409).send("CANCELLED ORDER");
   await creditVerifiedPayment(pool,{providerPaymentId:paymentId,userId:Number(intent.user_id),amountKopecks:amount});
   await pool.query("UPDATE payment_intents SET status='confirmed',provider_payment_id=$2,confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1 AND status IN ('pending','confirmed') AND (provider_payment_id IS NULL OR provider_payment_id=$2)",[orderId,paymentId]);
   return res.status(200).send("OK");
  }catch(error){console.error("T-Bank notification processing failed",error.message);return res.status(503).send("RETRY");}
 });
 return router;
}
module.exports={createTbankWebhookRouter};
