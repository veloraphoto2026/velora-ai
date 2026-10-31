const crypto = require("crypto");
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

const databaseReady = initDatabase().then(() => true).catch(error => {
  console.error("Database initialization failed:", error);
  return false;
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
const ordersReady = databaseReady.then(async ready => {
  if (!ready) return false;
  await initOrders();
  return true;
}).catch(error => { console.error("Order table initialization failed:", error); return false; });

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

// Test checkout links are only generated for the authenticated owner of a pending order.
// Never expose the merchant password, and never issue a live-payment URL here.
app.post("/api/orders/:id/test-payment", authenticate, async (req, res) => {
  if (!/^[1-9][0-9]*$/.test(req.params.id)) return res.status(400).json({success:false,error:"Некорректный номер заказа"});
  const merchant = process.env.ROBOKASSA_MERCHANT_LOGIN || "veloraai";
  const password = process.env.ROBOKASSA_TEST_PASSWORD1;
  const algorithm = (process.env.ROBOKASSA_HASH_ALGORITHM || "").toLowerCase();
  if (!password || !["md5","sha256","sha512"].includes(algorithm)) {
    return res.status(503).json({success:false,error:"Тестовая оплата не настроена"});
  }
  try {
    if (!(await ordersReady)) return res.status(503).json({success:false,error:"Система заказов недоступна"});
    const result = await pool.query(
      "SELECT id, service, amount_kopecks, status FROM orders WHERE id=$1 AND user_id=$2",
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({success:false,error:"Заказ не найден"});
    const order = result.rows[0];
    if (order.status !== "pending") return res.status(409).json({success:false,error:"Заказ уже обработан"});
    const outSum = (order.amount_kopecks / 100).toFixed(2);
    const invId = String(order.id);
    const signature = crypto.createHash(algorithm)
      .update(`${merchant}:${outSum}:${invId}:${password}`, "utf8").digest("hex");
    const params = new URLSearchParams({
      MerchantLogin:merchant, OutSum:outSum, InvId:invId,
      Description:"Velora AI - test order " + invId,
      SignatureValue:signature, IsTest:"1", Culture:"ru"
    });
    return res.json({success:true,testMode:true,paymentUrl:"https://auth.robokassa.ru/Merchant/Index.aspx?"+params.toString()});
  } catch (error) {
    console.error("Test checkout link error:",error);
    return res.status(503).json({success:false,error:"Тестовая оплата временно недоступна"});
  }
});

// Robokassa ResultURL (legacy form callback). No browser redirect can mark an order paid.
// Production callbacks use ROBOKASSA_PASSWORD2; test callbacks use ROBOKASSA_TEST_PASSWORD2.
// Verified test notifications never mark an order paid or enable generation.
// Payment initiation stays disabled until fiscal receipt settings are verified.
app.post("/api/payments/robokassa/result", express.urlencoded({extended:false,limit:"16kb"}), async (req, res) => {
  const { OutSum, InvId, SignatureValue } = req.body || {};
  const productionPassword = process.env.ROBOKASSA_PASSWORD2;
  const testPassword = process.env.ROBOKASSA_TEST_PASSWORD2;
  const algorithm = (process.env.ROBOKASSA_HASH_ALGORITHM || "").toLowerCase();
  if ((!productionPassword && !testPassword) || !["md5","sha256","sha512"].includes(algorithm)) return res.sendStatus(503);
  if (typeof OutSum !== "string" || !/^\\d+\\.\\d{2}$/.test(OutSum) ||
      typeof InvId !== "string" || !/^[1-9]\\d*$/.test(InvId) ||
      typeof SignatureValue !== "string" || !/^[0-9a-fA-F]+$/.test(SignatureValue)) return res.sendStatus(400);
  // Reject optional Shp_* until the signed custom-parameter contract is implemented.
  if (Object.keys(req.body).some(k => /^shp_/i.test(k))) return res.sendStatus(400);
  const supplied = Buffer.from(SignatureValue, "hex");
  const matches = (password) => {
    if (!password) return false;
    const expected = crypto.createHash(algorithm).update(`${OutSum}:${InvId}:${password}`, "utf8").digest();
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  };
  const isProduction = matches(productionPassword);
  const isTest = !isProduction && matches(testPassword);
  if (!isProduction && !isTest) return res.sendStatus(403);
  const [rub, fraction] = OutSum.split(".");
  const amount = BigInt(rub) * 100n + BigInt((fraction + "000000").slice(0,6)) / 10000n;
  // Fractions of a kopeck cannot be reconciled.
  if (BigInt((fraction + "000000").slice(0,6)) % 10000n !== 0n || amount > 2147483647n) return res.sendStatus(400);
  try {
    if (!(await ordersReady)) return res.sendStatus(503);
    if (isTest) {
      const check = await pool.query("SELECT id, amount_kopecks, status FROM orders WHERE id=$1", [InvId]);
      if (!check.rows.length || check.rows[0].amount_kopecks !== Number(amount)) return res.sendStatus(409);
      console.info("Robokassa TEST notification verified for order", InvId);
      return res.type("text/plain").send("OK" + InvId);
    }
    const result = await pool.query(
      `UPDATE orders SET status='paid', paid_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND amount_kopecks=$2 AND currency='RUB' AND status='pending'
       RETURNING id`,
      [InvId, Number(amount)]
    );
    if (!result.rowCount) {
      const existing = await pool.query("SELECT status, amount_kopecks FROM orders WHERE id=$1", [InvId]);
      if (!existing.rows.length || existing.rows[0].amount_kopecks !== Number(amount) ||
          !["paid","processing","completed"].includes(existing.rows[0].status)) return res.sendStatus(409);
    }
    return res.type("text/plain").send("OK" + InvId);
  } catch (error) {
    console.error("Robokassa callback error:", error);
    return res.sendStatus(503);
  }
});

// Ranvik paid image generation. The server never exposes the provider API key.
// Orders must be verified paid before any chargeable provider request.
app.post("/api/orders/:id/generate-photo", authenticate, async (req, res) => {
  if (!/^[1-9][0-9]*$/.test(req.params.id)) return res.status(400).json({success:false,error:"Некорректный заказ"});
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length < 5 || prompt.length > 2000) {
    return res.status(400).json({success:false,error:"Опишите фотографию (5–2000 символов)"});
  }
  const key = process.env.RANVIK_API_KEY;
  if (!key) return res.status(503).json({success:false,error:"Ranvik ещё не настроен"});
  try {
    if (!(await ordersReady)) return res.status(503).json({success:false,error:"Заказы недоступны"});
    // Atomic claim prevents parallel/repeated calls charging for the same order.
    const claimed = await pool.query(
      `UPDATE orders SET status='processing', updated_at=NOW()
       WHERE id=$1 AND user_id=$2 AND service='photo' AND status='paid'
       RETURNING id`,
      [req.params.id, req.userId]
    );
    if (!claimed.rowCount) return res.status(409).json({success:false,error:"Нужен оплаченный заказ на генерацию фото"});
    let response;
    try {
      response = await fetch("https://api.ranvik.ru/v1/images/generations", {
        method:"POST",
        headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"krea-2-turbo",positivePrompt:prompt.trim(),
          width:832,height:1248,numberResults:1,deliveryMethod:"sync"
        }),
        signal:AbortSignal.timeout(120000)
      });
    } catch (err) {
      // Network timeout may happen after the provider accepted a charge.
      // Keep the order in processing for manual reconciliation, never retry automatically.
      console.error("Ranvik network failure for order",req.params.id,err?.name);
      return res.status(502).json({success:false,error:"Не удалось получить ответ нейросети. Повторная отправка заблокирована до проверки."});
    }
    if (!response.ok) {
      console.error("Ranvik rejected request for order",req.params.id,"HTTP",response.status);
      // Provider may have charged even if it returned an error; do not auto-retry.
      return res.status(502).json({success:false,error:"Ranvik вернул ошибку. Заказ отправлен на проверку."});
    }
    const payload = await response.json().catch(()=>null);
    const item = payload?.data?.[0] || payload?.images?.[0] || payload?.output?.[0];
    const image = typeof item === "string" ? item :
      item?.url || item?.b64_json && ("data:image/png;base64,"+item.b64_json) ||
      payload?.image || payload?.imageUrl;
    if (typeof image !== "string" || !(image.startsWith("https://") || image.startsWith("data:image/"))) {
      console.error("Unexpected Ranvik response shape for order",req.params.id);
      return res.status(502).json({success:false,error:"Нестандартный ответ Ranvik. Заказ отправлен на проверку."});
    }
    await pool.query("UPDATE orders SET status='completed', updated_at=NOW() WHERE id=$1 AND status='processing'",[req.params.id]);
    return res.json({success:true,orderId:req.params.id,image});
  } catch (err) {
    console.error("Paid image generation error:",err?.message);
    return res.status(503).json({success:false,error:"Ошибка генерации. Обратитесь в поддержку с номером заказа."});
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
