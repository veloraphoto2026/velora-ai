"use strict";
// Atomic confirmation: order lock, payment-event deduplication, wallet credit,
// ledger entry and order status commit together. Requires both SQL migrations.
async function confirmTbankOrder(pool,{orderId,paymentId,amountKopecks}){
 if(!/^[0-9]{1,20}$/.test(String(orderId))||!/^[0-9]{1,32}$/.test(String(paymentId)))throw new Error("Invalid payment identifiers");
 if(!Number.isSafeInteger(amountKopecks)||amountKopecks<=0)throw new Error("Invalid amount");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const found=await client.query("SELECT id,user_id,amount_kopecks,status,provider_payment_id FROM payment_intents WHERE id=$1 AND provider='tbank' FOR UPDATE",[String(orderId)]);
  if(found.rowCount!==1)throw new Error("Unknown order");
  const order=found.rows[0],userId=String(order.user_id);
  if(String(order.amount_kopecks)!==String(amountKopecks))throw new Error("Amount mismatch");
  if(order.provider_payment_id!=null&&String(order.provider_payment_id)!==String(paymentId))throw new Error("Payment mismatch");
  if(!["pending","confirmed"].includes(order.status))throw new Error("Order not payable");
  const inserted=await client.query("INSERT INTO payment_events(provider,provider_event_id,user_id,amount_kopecks,status) VALUES ('tbank',$1,$2,$3,'confirmed') ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id",[String(paymentId),userId,amountKopecks]);
  if(inserted.rowCount){
   await client.query("INSERT INTO wallets(user_id,balance_kopecks,reserved_kopecks) VALUES($1,$2,0) ON CONFLICT(user_id) DO UPDATE SET balance_kopecks=wallets.balance_kopecks+EXCLUDED.balance_kopecks",[userId,amountKopecks]);
   await client.query("INSERT INTO wallet_ledger(user_id,payment_event_id,delta_kopecks,reason) VALUES($1,$2,$3,'tbank_topup')",[userId,inserted.rows[0].id,amountKopecks]);
  }else{
   const previous=await client.query("SELECT user_id,amount_kopecks,status FROM payment_events WHERE provider='tbank' AND provider_event_id=$1",[String(paymentId)]);
   if(previous.rowCount!==1||String(previous.rows[0].user_id)!==userId||String(previous.rows[0].amount_kopecks)!==String(amountKopecks)||previous.rows[0].status!=="confirmed")throw new Error("Payment replay mismatch");
   // A payment cannot be bound to two different orders, even for the same user.
   const linked=await client.query("SELECT id FROM payment_intents WHERE provider='tbank' AND provider_payment_id=$1 AND id<>$2",[String(paymentId),String(orderId)]);
   if(linked.rowCount)throw new Error("Payment belongs to another order");
  }
  const updated=await client.query("UPDATE payment_intents SET status='confirmed',provider_payment_id=$2,confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1 AND status IN ('pending','confirmed') RETURNING id",[String(orderId),String(paymentId)]);
  if(updated.rowCount!==1)throw new Error("Order confirmation failed");
  await client.query("COMMIT");
  return {credited:!!inserted.rowCount,replay:!inserted.rowCount};
 }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
 finally{client.release();}
}
module.exports={confirmTbankOrder};
