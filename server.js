const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));


// DATABASE

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined
});

// CREATE USERS TABLE

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

    await pool.query(`
    ALTER TABLE users
    ALTER COLUMN credits SET DEFAULT 0
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

// PUBLIC OFFER — serve the existing HTML document without exposing other files
app.get("/oferta.html", (req, res) => {
  res.sendFile(path.join(__dirname, "oferta.html"));
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
      password.length > 128
    ) {
      return res.status(400).json({
        success: false,
        error: "Проверь email и пароль (минимум 8 символов)"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

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

// Durable order ledger: pending orders do not grant generation access.
// This endpoint creates an unpaid order only. No payment URLs are issued yet.
async function initOrders() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      service TEXT NOT NULL CHECK (service IN ('photo','edit','video')),
      amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
      currency TEXT NOT NULL DEFAULT 'RUB' CHECK (currency = 'RUB'),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','processing','completed','failed','refunded')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC)");
}
const ordersReady = initOrders().then(() => true).catch(error => { console.error("Order table initialization failed:", error); return false; });

// Paid service catalog. All prices are in RUB; never trust client-supplied amounts.
const SERVICES = Object.freeze({
  photo: { name: "Генерация фотографии", priceRub: 99 },
  edit: { name: "Редактирование фотографии", priceRub: 149 },
  video: { name: "Генерация видео", priceRub: 299 }
});
app.get("/api/services", (_req, res) => res.json({success:true, currency:"RUB", services:SERVICES, paymentsEnabled:false, generationEnabled:false}));
app.post("/api/orders", authenticate, async (req, res) => {
  const service = req.body?.service;
  if (typeof service !== "string" || !Object.prototype.hasOwnProperty.call(SERVICES, service)) {
    return res.status(400).json({success:false, error:"Неизвестная услуга"});
  }
  try {
    if (!(await ordersReady)) return res.status(503).json({success:false, error:"Система заказов временно недоступна"});
    const order = await pool.query(
      "INSERT INTO orders (user_id, service, amount_kopecks) VALUES ($1,$2,$3) RETURNING id, service, amount_kopecks, currency, status, created_at",
      [req.userId, service, SERVICES[service].priceRub * 100]
    );
    return res.status(201).json({success:true, order:order.rows[0], paymentAvailable:false});
  } catch (error) {
    console.error("Order creation error:", error);
    return res.status(503).json({success:false, error:"Создание заказа временно недоступно"});
  }
});
app.get("/api/orders", authenticate, async (req, res) => {
  try {
    if (!(await ordersReady)) return res.status(503).json({success:false, error:"Система заказов временно недоступна"});
    const orders = await pool.query(
      "SELECT id, service, amount_kopecks, currency, status, created_at, paid_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [req.userId]
    );
    return res.json({success:true, orders:orders.rows});
  } catch (error) {
    console.error("Order list error:", error);
    return res.status(503).json({success:false, error:"История заказов временно недоступна"});
  }
});


// Individual order lookup is always scoped to the authenticated owner.
app.get("/api/orders/:id", authenticate, async (req, res) => {
  if (!/^[1-9][0-9]*$/.test(req.params.id)) {
    return res.status(400).json({success:false, error:"Некорректный номер заказа"});
  }
  try {
    if (!(await ordersReady)) return res.status(503).json({success:false, error:"Система заказов временно недоступна"});
    const result = await pool.query(
      "SELECT id, service, amount_kopecks, currency, status, created_at, paid_at FROM orders WHERE id=$1 AND user_id=$2",
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({success:false, error:"Заказ не найден"});
    return res.json({success:true, order:result.rows[0]});
  } catch (error) {
    console.error("Order lookup error:", error);
    return res.status(503).json({success:false, error:"Заказ временно недоступен"});
  }
});

// AI PHOTO GENERATION
// Only authenticated account requests are permitted.

// Paid-only safety gate: no free-credit generation on the production API.
// Payment and Ranvik processing will be enabled only after verified integration.
app.post("/api/generate", authenticate, (_req, res) => {
  res.status(402).json({success:false,error:"Бесплатные генерации отключены. Платная генерация пока недоступна."});
});
app.post("/api/edit", authenticate, (_req, res) => {
  res.status(402).json({success:false,error:"Редактирование будет доступно после подключения оплаты."});
});
app.post("/api/video", authenticate, (_req, res) => {
  res.status(402).json({success:false,error:"Генерация видео будет доступна после подключения оплаты."});
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Velora AI running on port ${PORT}`);
});
