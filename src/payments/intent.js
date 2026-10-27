"use strict";
// Server-owned payment intent. This does not contact the acquiring bank.
async function createPaymentIntent(pool,{userId,amountKopecks}){
 if(!Number.isSafeInteger(userId)||userId<1)throw new Error("Invalid user");
 if(!Number.isSafeInteger(amountKopecks)||amountKopecks<10000||amountKopecks>10000000)throw new Error("Amount must be between 100 and 100000 RUB");
 const result=await pool.query(
  "INSERT INTO payment_intents(user_id,amount_kopecks,status,provider) VALUES($1,$2,'pending','tbank') RETURNING id,amount_kopecks,status,created_at",
  [userId,amountKopecks]
 );
 return result.rows[0];
}
module.exports={createPaymentIntent};
