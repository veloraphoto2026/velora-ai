"use strict";
const crypto=require("node:crypto");
const {notificationToken}=require("./tbank-token");
// T-Bank Init API. Caller must use a persisted server-created payment intent.
async function initializeTbankPayment({terminalKey,password,orderId,amountKopecks,description="Пополнение Velora AI",notificationURL,successURL,failURL,fetchImpl=globalThis.fetch}){
 if(!terminalKey||!password)throw new Error("T-Bank credentials are missing");
 if(!/^[0-9]{1,20}$/.test(String(orderId)))throw new Error("Invalid order ID");
 if(!Number.isSafeInteger(amountKopecks)||amountKopecks<=0)throw new Error("Invalid amount");
 if(typeof fetchImpl!=="function")throw new Error("Fetch is unavailable");
 const payload={TerminalKey:terminalKey,Amount:amountKopecks,OrderId:String(orderId),Description:description};
 for(const [key,value] of Object.entries({NotificationURL:notificationURL,SuccessURL:successURL,FailURL:failURL})){
  if(value!==undefined){
   const url=new URL(value);
   if(url.protocol!=="https:")throw new Error("HTTPS URL required");
   payload[key]=url.toString();
  }
 }
 payload.Token=notificationToken(payload,password);
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetchImpl("https://securepay.tinkoff.ru/v2/Init",{
   method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:controller.signal
  });
  if(!response.ok)throw new Error("Bank init HTTP "+response.status);
  const result=await response.json();
  if(result.Success!==true||typeof result.PaymentURL!=="string"||!/^[0-9]+$/.test(String(result.PaymentId)))throw new Error("Bank rejected payment initialization");
  const paymentURL=new URL(result.PaymentURL);
  if(paymentURL.protocol!=="https:")throw new Error("Unsafe bank payment URL");
  return {paymentId:String(result.PaymentId),paymentURL:paymentURL.toString(),status:result.Status};
 }finally{clearTimeout(timer);}
}
module.exports={initializeTbankPayment};
