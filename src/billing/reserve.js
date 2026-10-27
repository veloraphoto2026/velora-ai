"use strict";
/**
 * Wallet reservation for a paid generation.
 * Caller must pass a trusted server-side quote (kopecks) and a validated model.
 * Requires db/paid-platform.sql. No provider calls are made here.
 */
async function reserveGeneration(pool, { userId, idempotencyKey, modality, modelId, priceKopecks }) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error("Invalid user");
  if (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{12,100}$/.test(idempotencyKey)) throw new Error("Invalid idempotency key");
  if (!["chat", "image", "video", "audio", "3d"].includes(modality)) throw new Error("Invalid modality");
  if (typeof modelId !== "string" || !/^[a-zA-Z0-9._/-]{1,120}$/.test(modelId)) throw new Error("Invalid model");
  if (!Number.isSafeInteger(priceKopecks) || priceKopecks <= 0) throw new Error("Invalid quote");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    // Serializes all reservations for this user, including retries.
    const wallet = await client.query("SELECT balance_kopecks, reserved_kopecks FROM wallets WHERE user_id=$1 FOR UPDATE", [userId]);
    const existing = await client.query("SELECT id, status, quoted_price_kopecks, modality, model_id FROM generation_jobs WHERE user_id=$1 AND idempotency_key=$2", [userId, idempotencyKey]);
    if (existing.rows.length) {
      const job = existing.rows[0];
      if (Number(job.quoted_price_kopecks) !== priceKopecks || job.modality !== modality || job.model_id !== modelId) throw new Error("Idempotency key conflict");
      await client.query("COMMIT");
      return { jobId: job.id, status: job.status, replay: true };
    }
    const available = BigInt(wallet.rows[0].balance_kopecks) - BigInt(wallet.rows[0].reserved_kopecks);
    if (available < BigInt(priceKopecks)) {
      await client.query("ROLLBACK");
      return { insufficientFunds: true };
    }
    const inserted = await client.query(
      "INSERT INTO generation_jobs (user_id,idempotency_key,modality,model_id,quoted_price_kopecks,status) VALUES ($1,$2,$3,$4,$5,'reserved') RETURNING id",
      [userId,idempotencyKey,modality,modelId,priceKopecks]
    );
    await client.query("UPDATE wallets SET reserved_kopecks=reserved_kopecks+$2 WHERE user_id=$1", [userId,priceKopecks]);
    await client.query("COMMIT");
    return { jobId: inserted.rows[0].id, status: "reserved", replay: false };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { reserveGeneration };
