"use strict";
// Atomic, idempotent credit of a verified T-Bank payment.
// Caller MUST verify notification signature and reconcile payment with its
// own server-created order before invoking this function.
async function creditVerifiedPayment(pool,{providerPaymentId,userId,amountKopecks}){
 if(!/^[0-9]{1,32}$/.test(String(providerPaymentId)))throw new Error("Invalid payment id");
 if(!Number.isSafeInteger(userId)||userId<1)throw new Error("Invalid user id");
 if(!Number.isSafeInteger(amountKopecks)||amountKopecks<=0)throw new Error("Invalid amount");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const inserted=await client.query(
   "INSERT INTO payment_events(provider,provider_event_id,user_id,amount_kopecks,status) VALUES ('tbank',$1,$2,$3,'confirmed') ON CONFLICT (provider,provider_event_id) DO NOTHING RETURNING provider_event_id",
   [String(providerPaymentId),userId,amountKopecks]
  );
  if(!inserted.rowCount){
   const existing=await client.query("SELECT user_id,amount_kopecks,status FROM payment_events WHERE provider='tbank' AND provider_event_id=$1",[String(providerPaymentId)]);
   if(!existing.rowCount||String(existing.rows[0].user_id)!==String(userId)||String(existing.rows[0].amount_kopecks)!==String(amountKopecks)||existing.rows[0].status!=="confirmed")throw new Error("Payment replay mismatch");
   await client.query("COMMIT");
   return {credited:false,replay:true};
  }
  await client.query("INSERT INTO wallets(user_id,balance_kopecks,reserved_kopecks) VALUES($1,$2,0) ON CONFLICT(user_id) DO UPDATE SET balance_kopecks=wallets.balance_kopecks+EXCLUDED.balance_kopecks",[userId,amountKopecks]);
  await client.query("INSERT INTO wallet_ledger(user_id,payment_event_id,delta_kopecks,reason) SELECT $1,id,$3,'tbank_topup' FROM payment_events WHERE provider='tbank' AND provider_event_id=$2",[userId,String(providerPaymentId),amountKopecks]);
  await client.query("COMMIT");
  return {credited:true,replay:false};
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
module.exports={creditVerifiedPayment};
