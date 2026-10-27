"use strict";
const express=require("express");
const {verifyNotification}=require("./tbank-token");
const {confirmTbankOrder}=require("./confirm-order");
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
   await confirmTbankOrder(pool,{orderId,paymentId,amountKopecks:amount});
   return res.status(200).send("OK");
  }catch(error){console.error("T-Bank notification processing failed",error.message);return res.status(503).send("RETRY");}
 });
 return router;
}
module.exports={createTbankWebhookRouter};
