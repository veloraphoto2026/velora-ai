const express = require("express");
const Replicate = require("replicate");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const crypto = require("crypto");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for account storage");
}
const app = express();

// Only the official separately hosted website may call the API from browsers.
const allowedOrigin = "https://velora-ai-wyp6.onrender.com";
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin === allowedOrigin ? 204 : 403);
  next();
});
app.use(express.json({ limit: "12mb" }));
app.disable("x-powered-by");
app.use((req,res,next) => {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","no-referrer");
  next();
});
// Per-process throttling for the preview. Production needs a shared store.
const attempts = new Map();
function limitRequests(req,res,next) {
  const key = req.ip + ":" + req.path;
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until < now) {
    attempts.set(key,{count:1,until:now+15*60*1000});
    return next();
  }
  if (++entry.count > 12) return res.status(429).json({success:false,error:"Слишком много запросов. Попробуй позже"});
  next();
}
setInterval(() => {
  const now=Date.now();
  for (const [key,value] of attempts) if(value.until<now) attempts.delete(key);
},15*60*1000).unref();

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

// DATABASE

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") || process.env.DATABASE_URL.includes("127.0.0.1") || process.env.PGSSLMODE === "disable"
    ? false
    : { rejectUnauthorized: true }
});

// CREATE USERS TABLE

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 2,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

    await pool.query(`
    ALTER TABLE users
    ALTER COLUMN credits SET DEFAULT 2
  `);

  await pool.query(`CREATE TABLE IF NOT EXISTS generation_jobs (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('reserved','completed','failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS one_reserved_job_per_user ON generation_jobs (user_id) WHERE status = 'reserved'");
  console.log("Velora AI database ready");
}



// WEBSITE

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// HEALTH CHECK

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "Velora AI",
    status: "running"
  });
});

// REGISTER

app.post("/api/register", limitRequests, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      password.length < 8 ||
      password.length > 128
    ) {
      return res.status(400).json({
        success: false,
        error: "Проверь email и пароль (минимум 8 символов)"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length > 254) return res.status(400).json({success:false,error:"Слишком длинный email"});

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.rows.length) {
      return res.status(409).json({
        success: false,
        error: "Этот email уже зарегистрирован"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, credits`,
      [normalizedEmail, passwordHash]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      success: true,
      token,
      user
    });

  } catch (error) {
    console.error("Register error:", error);

    if (error.code === "23505") {
      return res.status(409).json({success:false,error:"Этот email уже зарегистрирован"});
    }
    res.status(500).json({
      success: false,
      error: "Ошибка регистрации"
    });
  }
});

// LOGIN

app.post("/api/login", limitRequests, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 254 || password.length > 128
    ) {
      return res.status(400).json({
        success: false,
        error: "Введите email и пароль"
      });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Неверный email или пароль"
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: "Неверный email или пароль"
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        credits: user.credits
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка входа"
    });
  }
});

// AUTH MIDDLEWARE

function authenticate(req, res, next) {
  const authorization = req.headers.authorization || "";

  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Необходим вход в аккаунт"
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.userId = decoded.userId;

    next();

  } catch (error) {
    res.status(401).json({
      success: false,
      error: "Сессия истекла"
    });
  }
}

// USER PROFILE

app.get("/api/me", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, credits, created_at
       FROM users
       WHERE id = $1`,
      [req.userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Пользователь не найден"
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Profile error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка загрузки профиля"
    });
  }
});

// GENERATION: disabled by default until owner explicitly enables paid API usage.
// Reserve exactly one credit atomically. On provider failure restore the credit.
app.post("/api/generate", limitRequests, authenticate, async (req, res) => {
  if (process.env.VELORA_GENERATION_ENABLED !== "true") {
    return res.status(503).json({success:false,error:"Генерация временно отключена до завершения настройки"});
  }
  if (!process.env.REPLICATE_API_TOKEN || !process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    return res.status(503).json({success:false,error:"Сервис пока не настроен"});
  }
  // Require an explicit owner-configured global daily cap before any paid provider call.
  const dailyLimit = Number(process.env.VELORA_DAILY_GENERATION_LIMIT || 0);
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) {
    return res.status(503).json({success:false,error:"Дневной лимит генераций не настроен"});
  }
  const {image,prompt} = req.body || {};
  if (typeof image !== "string" || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      image.length > 11 * 1024 * 1024 || typeof prompt !== "string" ||
      !prompt.trim() || prompt.length > 1500) {
    return res.status(400).json({success:false,error:"Проверь фотографию и описание"});
  }
  const jobId = crypto.randomUUID();
  let reserved = false;
  let providerSucceeded = false;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(861729, 1)");
      const dailyUsage = await client.query(
        "SELECT COUNT(*)::integer AS total FROM generation_jobs WHERE created_at >= CURRENT_DATE AND status IN ('reserved','completed')"
      );
      if (dailyUsage.rows[0].total >= dailyLimit) {
        await client.query("ROLLBACK");
        return res.status(429).json({success:false,error:"Дневной лимит генераций достигнут"});
      }
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[req.userId]);
      const active = await client.query("SELECT id FROM generation_jobs WHERE user_id=$1 AND status='reserved' LIMIT 1 FOR UPDATE",[req.userId]);
      if (active.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({success:false,error:"Дождись завершения предыдущей генерации"});
      }
      const debit = await client.query(
        "UPDATE users SET credits = credits - 1 WHERE id = $1 AND credits > 0 RETURNING credits",
        [req.userId]
      );
      if (!debit.rowCount) {
        await client.query("ROLLBACK");
        return res.status(402).json({success:false,error:"Бесплатные генерации закончились"});
      }
      await client.query(
        "INSERT INTO generation_jobs (id,user_id,status) VALUES ($1,$2,'reserved')",
        [jobId,req.userId]
      );
      await client.query("COMMIT");
      reserved = true;
    } catch(e) {
      await client.query("ROLLBACK").catch(()=>{});
      throw e;
    } finally { client.release(); }

    const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
      input:{prompt:prompt.trim(),input_image:image,output_format:"jpg",aspect_ratio:"match_input_image"}
    });
    const candidate = Array.isArray(output) ? output[0] : output;
    const imageUrl = typeof candidate === "string" ? candidate :
      typeof candidate?.url === "function" ? candidate.url() :
      typeof candidate?.url === "string" ? candidate.url : null;
    if (!imageUrl || !/^https:\/\//i.test(String(imageUrl))) throw new Error("Provider did not return a secure image URL");
    providerSucceeded = true;
    await pool.query("UPDATE generation_jobs SET status='completed' WHERE id=$1",[jobId]);
    return res.json({success:true,image:imageUrl});
  } catch(e) {
    console.error("Generation failed:",e);
    if (reserved && !providerSucceeded) {
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const restored = await client.query(
            "UPDATE generation_jobs SET status='failed' WHERE id=$1 AND status='reserved' RETURNING user_id",
            [jobId]
          );
          if (restored.rowCount) await client.query(
            "UPDATE users SET credits=credits+1 WHERE id=$1",[req.userId]
          );
          await client.query("COMMIT");
        } catch(refundError) {
          await client.query("ROLLBACK").catch(()=>{});
          console.error("Credit refund needs manual reconciliation for job",jobId,refundError);
        } finally { client.release(); }
      } catch(refundError) { console.error("Refund connection failed for job",jobId,refundError); }
    }
    return res.status(500).json({success:false,error:providerSucceeded ? "Фотография создана, но произошла ошибка сохранения статуса. Обратитесь в поддержку; кредит не возвращён автоматически." : "Не удалось создать фотографию. Проверь баланс в личном кабинете"});
  }
});

// START SERVER

const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Velora AI running on port ${PORT}`);
  });
}).catch(error => {
  console.error("Database initialization failed:", error);
  process.exitCode = 1;
  pool.end().catch(() => {});
});
