"use strict";
const {createAccountRouter}=require("../account/routes");
const catalogRouter=require("../catalog/routes");
const {createTopupRouter}=require("../payments/topup-routes");
const {createTbankWebhookRouter}=require("../payments/tbank-webhook");
function mountPaidPlatform(app,{pool,authenticate,env=process.env}){
 if(!app||typeof app.use!=="function")throw new Error("Express app required");
 app.use("/api/platform",catalogRouter);
 app.use("/api/platform",createAccountRouter({pool,authenticate}));
 // Explicit opt-in only AFTER migrations, real bank sandbox verification,
 // URL verification and a controlled deployment. Default: payments OFF.
 if(env.VELORA_TBANK_ENABLED!=="true")return {paymentsEnabled:false};
 const required=["TBANK_TERMINAL_KEY","TBANK_TERMINAL_PASSWORD","TBANK_NOTIFICATION_URL","TBANK_SUCCESS_URL","TBANK_FAIL_URL"];
 const missing=required.filter(name=>!env[name]);
 if(missing.length)throw new Error("T-Bank enabled but missing required server configuration: "+missing.join(", "));
 for(const key of ["TBANK_NOTIFICATION_URL","TBANK_SUCCESS_URL","TBANK_FAIL_URL"]){
  const url=new URL(env[key]);
  if(url.protocol!=="https:"||url.username||url.password)throw new Error("Invalid HTTPS payment URL: "+key);
 }
 app.use("/api/platform",createTopupRouter({pool,authenticate,terminalKey:env.TBANK_TERMINAL_KEY,password:env.TBANK_TERMINAL_PASSWORD,notificationURL:env.TBANK_NOTIFICATION_URL,successURL:env.TBANK_SUCCESS_URL,failURL:env.TBANK_FAIL_URL}));
 app.use("/api/platform/tbank",createTbankWebhookRouter({pool,terminalPassword:env.TBANK_TERMINAL_PASSWORD}));
 return {paymentsEnabled:true};
}
module.exports={mountPaidPlatform};
