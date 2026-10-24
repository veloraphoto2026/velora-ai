require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const Replicate = require("replicate");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

function validImage(image) {
  if (typeof image !== "string") return false;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) return false;
  const data = Buffer.from(match[2], "base64");
  if (data.length > 8 * 1024 * 1024 || data.toString("base64") !== match[2]) return false;
  return match[1] === "png"
    ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
}

function createApp({ pool, replicate, jwtSecret, generationEnabled = false, rateLimits = {}, trustProxyHops = 0 }) {
  if (!jwtSecret) throw new Error("JWT_SECRET is required");
  const app = express();

  if (![0, 1].includes(trustProxyHops)) throw new Error("TRUST_PROXY_HOPS must be 0 or 1");
  app.set("trust proxy", trustProxyHops);
  const html = readFileSync(path.join(__dirname, "index.html"), "utf8");
  const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match =>
    "'sha256-" + createHash("sha256").update(match[1]).digest("base64") + "'"
  );
  app.use(helmet({
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    contentSecurityPolicy: { directives: {
      scriptSrc: ["'self'", ...scriptHashes],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    } }
  }));
  app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const limiter = (limit, windowMs) => rateLimit({
    limit, windowMs, standardHeaders: "draft-8", legacyHeaders: false,
    message: { success: false, error: "Слишком много запросов. Попробуйте позже" }
  });
  // Applied before JSON parsing and bcrypt to bound repeated expensive requests.
  app.use("/api/register", limiter(rateLimits.register ?? 10, 60 * 60 * 1000));
  app.use("/api/login", limiter(rateLimits.login ?? 20, 15 * 60 * 1000));
  app.use("/api/generate", limiter(rateLimits.generate ?? 20, 60 * 1000));
  app.use(express.json({ limit: "12mb" }));

  // CREATE USERS TABLE

  async function initDatabase() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        credits INTEGER NOT NULL DEFAULT 2 CHECK (credits >= 0),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      ALTER TABLE users
      ALTER COLUMN credits SET DEFAULT 2
    `);

    console.log("Velora AI database ready");
  }

  // WEBSITE

  app.get("/", (req, res) => {
    res.type("html").send(html);
  });

  // HEALTH CHECK

  app.get("/api/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ success: true, service: "Velora AI", status: "running" });
    } catch {
      res.status(503).json({ success: false, status: "unavailable" });
    }
  });

  // REGISTER

  app.post("/api/register", async (req, res) => {
    try {
      const { email, password } = req.body || {};

      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        email.trim().length > 254 ||
        password.length < 8 ||
        password.length > 128 ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        return res.status(400).json({
          success: false,
          error: "Проверь email и пароль (от 8 символов, до 72 байт UTF-8)"
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
        jwtSecret,
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
      console.error("Register error:", error.code || "request_failed");

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
        jwtSecret,
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
      console.error("Login error:", error.code || "request_failed");

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
        jwtSecret,
        { algorithms: ["HS256"] }
      );
      if (!/^[1-9][0-9]*$/.test(String(decoded.userId))) throw new Error("Invalid user ID");

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
      console.error("Profile error:", error.code || "request_failed");

      res.status(500).json({
        success: false,
        error: "Ошибка загрузки профиля"
      });
    }
  });

  // Generation is authenticated; test keys cannot bypass the user's balance.
  app.post("/api/generate", authenticate, async (req, res) => {
    const { image, prompt } = req.body || {};
    if (!validImage(image) ||
        typeof prompt !== "string" || !prompt.trim() || prompt.length > 1500) {
      return res.status(400).json({ success: false, error: "Нужны фотография JPEG/PNG до 8 МБ и описание до 1500 символов" });
    }
    if (!generationEnabled) {
      return res.status(503).json({ success: false, error: "Генерация временно недоступна" });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      // Serialize requests for one account so simultaneous requests cannot overspend.
      const { rows } = await client.query("SELECT credits FROM users WHERE id=$1 FOR UPDATE", [req.userId]);
      if (!rows.length || rows[0].credits <= 0) {
        await client.query("ROLLBACK");
        return res.status(rows.length ? 402 : 404).json({ success: false, error: rows.length ? "Бесплатные генерации закончились" : "Пользователь не найден" });
      }
      const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
        signal: AbortSignal.timeout(120000),
        input: { prompt: prompt.trim(), input_image: image, output_format: "jpg", aspect_ratio: "match_input_image" }
      });
      const imageUrl = typeof output === "string" ? output : typeof output?.url === "function" ? String(output.url()) : null;
      if (!imageUrl || new URL(imageUrl).protocol !== "https:") throw new Error("Invalid generation output");
      const result = await client.query("UPDATE users SET credits=credits-1 WHERE id=$1 RETURNING credits", [req.userId]);
      await client.query("COMMIT");
      res.json({ success: true, image: imageUrl, credits: result.rows[0].credits });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      console.error("Generation failed:", error.code || "provider_or_database_error");
      res.status(502).json({ success: false, error: "Ошибка генерации. Баланс не списан" });
    } finally {
      if (client) client.release();
    }
  });

  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large") return res.status(413).json({ success: false, error: "Фотография слишком большая" });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ success: false, error: "Некорректный JSON" });
    console.error(error.message);
    res.status(500).json({ success: false, error: "Ошибка сервера" });
  });
  return { app, initDatabase };
}

async function start() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(process.env.JWT_SECRET, "utf8") < 32) {
    throw new Error("Production JWT_SECRET must contain at least 32 bytes");
  }
  const database = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  const { app, initDatabase } = createApp({
    pool: database,
    jwtSecret: process.env.JWT_SECRET,
    replicate: new Replicate({ auth: process.env.REPLICATE_API_TOKEN }),
    generationEnabled: process.env.ENABLE_GENERATION === "true" && Boolean(process.env.REPLICATE_API_TOKEN),
    trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0)
  });
  try {
    await initDatabase();
  } catch (error) {
    await database.end();
    throw error;
  }
  return app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("Velora AI running"));
}
if (require.main === module) start().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createApp };
