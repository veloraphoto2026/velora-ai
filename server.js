const express = require("express");
const Replicate = require("replicate");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

for (const key of ["DATABASE_URL", "JWT_SECRET"]) {
  if (!process.env[key]) {
    console.error("Missing required configuration:", key);
    process.exit(1);
  }
}
if (process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters");
  process.exit(1);
}
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// No wildcard CORS: frontend and API are served from the same origin.
app.use(express.json({ limit: "15mb" }));

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

// DATABASE

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: true } : undefined
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

  console.log("Velora AI database ready");
}

initDatabase().catch(error => {
  console.error("Database initialization failed:", error);
});

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

app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 8 ||
      password.length > 128 ||
      email.trim().length > 254
    ) {
      return res.status(400).json({
        success: false,
        error: "Проверь email и пароль (минимум 8 символов)"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

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
    if (error.code === "23505") {
      return res.status(409).json({ success: false, error: "Этот email уже зарегистрирован" });
    }
    console.error("Register error:", error);

    res.status(500).json({
      success: false,
      error: "Ошибка регистрации"
    });
  }
});

// LOGIN

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string"
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

// Authenticated generation: disabled until explicitly enabled on isolated staging.
app.post("/api/generate", authenticate, async (req, res) => {
  if (process.env.ENABLE_GENERATION !== "true" || !process.env.REPLICATE_API_TOKEN) {
    return res.status(503).json({ success: false, error: "Генерация пока отключена" });
  }
  const { image, prompt } = req.body || {};
  if (typeof image !== "string" ||
      !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      Buffer.byteLength(image) > 12 * 1024 * 1024 ||
      typeof prompt !== "string" || !prompt.trim() || prompt.length > 1500) {
    return res.status(400).json({ success: false, error: "Некорректные данные фотографии" });
  }
  let reserved = false;
  try {
    const debit = await pool.query(
      "UPDATE users SET credits = credits - 1 WHERE id = $1 AND credits > 0 RETURNING credits",
      [req.userId]
    );
    if (!debit.rows.length) {
      return res.status(402).json({ success: false, error: "Бесплатные генерации закончились. Оплата ещё не подключена." });
    }
    reserved = true;
    const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
      input: { prompt: prompt.trim(), input_image: image, output_format: "jpg", aspect_ratio: "match_input_image" }
    });
    const value = Array.isArray(output) ? output[0] : output;
    const result = typeof value === "string" ? value :
      typeof value?.url === "function" ? await value.url() : value?.url;
    const imageUrl = result instanceof URL ? result.toString() : result;
    if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
      throw new Error("Invalid image URL");
    }
    reserved = false;
    return res.json({ success: true, image: imageUrl, credits: debit.rows[0].credits });
  } catch (error) {
    console.error("Generation error:", error);
    if (reserved) {
      try {
        await pool.query("UPDATE users SET credits = credits + 1 WHERE id = $1", [req.userId]);
      } catch (refundError) {
        console.error("CRITICAL: refund failed for user", req.userId, refundError);
      }
    }
    return res.status(500).json({ success: false, error: "Ошибка генерации. Проверь баланс в кабинете." });
  }
});

// START SERVER

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Velora AI running on port ${PORT}`);
});
