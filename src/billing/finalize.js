"use strict";
// Atomically settle or release an existing reservation. Safe to retry.
async function finalizeGeneration(pool, {userId, jobId, outcome, resultUrl = null}) {
  if (!["succeeded","failed"].includes(outcome)) throw new Error("Invalid outcome");
  if (!Number.isSafeInteger(Number(userId)) || !Number.isSafeInteger(Number(jobId))) throw new Error("Invalid IDs");
  if (outcome === "succeeded" && (typeof resultUrl !== "string" || !resultUrl.startsWith("https://"))) throw new Error("Invalid result URL");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock wallet first to maintain same lock order as reserveGeneration.
    const wallet = await client.query("SELECT balance_kopecks,reserved_kopecks FROM wallets WHERE user_id=$1 FOR UPDATE",[userId]);
    if (!wallet.rows.length) throw new Error("Wallet not found");
    const result = await client.query("SELECT id,status,quoted_price_kopecks FROM generation_jobs WHERE id=$1 AND user_id=$2 FOR UPDATE",[jobId,userId]);
    if (!result.rows.length) throw new Error("Job not found");
    const job = result.rows[0];
    if (job.status === "succeeded" || job.status === "failed") {
      await client.query("COMMIT");
      return {jobId,status:job.status,replay:true};
    }
    if (job.status !== "reserved") throw new Error("Job is not reserved");
    const amount = BigInt(job.quoted_price_kopecks);
    if (BigInt(wallet.rows[0].reserved_kopecks) < amount) throw new Error("Inconsistent reservation");
    if (outcome === "succeeded") {
      const debited = await client.query("UPDATE wallets SET balance_kopecks=balance_kopecks-$2,reserved_kopecks=reserved_kopecks-$2 WHERE user_id=$1 AND balance_kopecks >= $2 RETURNING user_id",[userId,amount.toString()]);
      if (!debited.rows.length) throw new Error("Inconsistent balance");
      await client.query("INSERT INTO wallet_ledger(user_id,job_id,delta_kopecks,reason) VALUES($1,$2,$3,'generation_charge')",[userId,jobId,(-amount).toString()]);
    } else {
      await client.query("UPDATE wallets SET reserved_kopecks=reserved_kopecks-$2 WHERE user_id=$1",[userId,amount.toString()]);
    }
    await client.query("UPDATE generation_jobs SET status=$3,result_url=$4 WHERE id=$1 AND user_id=$2",[jobId,userId,outcome,outcome==="succeeded"?resultUrl:null]);
    await client.query("COMMIT");
    return {jobId,status:outcome,replay:false};
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {client.release();}
}
module.exports={finalizeGeneration};
