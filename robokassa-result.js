"use strict";
const crypto = require("crypto");
function verifyResult(payload, password, algorithm = "md5") {
  if (!password || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { OutSum, InvId, SignatureValue } = payload;
  if (typeof OutSum !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(OutSum)) return null;
  if (typeof InvId !== "string" || !/^[1-9]\d*$/.test(InvId) || BigInt(InvId) > 9223372036854775807n) return null;
  if (typeof SignatureValue !== "string" || !/^[a-f\d]+$/i.test(SignatureValue)) return null;
  if (!["md5", "sha256", "sha512"].includes(algorithm)) return null;
  const extra = Object.keys(payload).filter(k => k.startsWith("Shp_")).sort();
  if (extra.some(k => typeof payload[k] !== "string")) return null;
  const base = [OutSum, InvId, password, ...extra.map(k => k + "=" + payload[k])].join(":");
  const expected = crypto.createHash(algorithm).update(base, "utf8").digest();
  const supplied = Buffer.from(SignatureValue, "hex");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  const [rubles, fraction = ""] = OutSum.split(".");
  const padded = fraction.padEnd(6, "0");
  if (Number(padded.slice(2)) !== 0) return null;
  return { invoiceId: InvId, kopecks: BigInt(rubles) * 100n + BigInt(padded.slice(0, 2)) };
}
module.exports = { verifyResult };
