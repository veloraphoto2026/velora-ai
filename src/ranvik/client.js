"use strict";
const BASE = "https://api.ranvik.ru/v1";
const ALLOWED = Object.freeze({
  chat: "/chat/completions",
  images: "/images/generations"
});
async function requestRanvik(kind, payload, { timeoutMs = 60000 } = {}) {
  if (!Object.hasOwn(ALLOWED, kind)) throw new Error("Unsupported Ranvik operation");
  if (!process.env.RANVIK_API_KEY) throw new Error("Ranvik is not configured");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BASE + ALLOWED[kind], {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RANVIK_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Ranvik request failed");
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { requestRanvik };
