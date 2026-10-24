const express = require("express");
const cors = require("cors");
const Replicate = require("replicate");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");

const { createHash } = require("crypto");

function createApp({ pool, replicate, jwtSecret, generationEnabled = true, testKey,
  enableLegacyGeneration = false, authLimit = 30 }) {
  if (typeof jwtSecret !== "string" || Buffer.byteLength(jwtSecret) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  }
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  // Per-process guard. A shared limiter is required before running multiple replicas.
  const attempts = new Map();
  const limiter = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.ip; // Do not trust arbitrary X-Forwarded-For headers.
    const entry = attempts.get(key) || { count: 0, until: now + 60000 };
    attempts.set(key, entry);
    if (++entry.count > authLimit) {
      res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
      return res.status(429).json({ success: false, error: "Слишком много попыток. Подожди минуту." });
    }
    next();
  };
  app.use(["/api/register", "/api/login", "/api/generate"], limiter);
  const dummyHash = bcrypt.hashSync("unmatched-local-password", 12);

  // Restrict cross-origin requests to the separate Velora static website.
  app.use(cors({ origin: "https://velora-ai-wyp6.onrender.com" }));
  app.use(express.json({ limit: "15mb" }));

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
        Buffer.byteLength(password, "utf8") > 72
      ) {
        return res.status(400).json({
          success: false,
          error: "Проверь email и пароль (минимум 8 символов, максимум 72 байта UTF-8)"
        });
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail.length > 254) return res.status(400).json({success:false,error:"Слишком длинный email"});

      const existing = await pool.query(
        "SELECT id FROM users WHERE lower(btrim(email)) = $1",
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
        `INSERT INTO users (email, password_hash, credits)
         VALUES ($1, $2, 2)
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
      if (error.code === "23505") return res.status(409).json({ success: false, error: "Этот email уже зарегистрирован" });
      console.error("Registration failed");

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
        typeof password !== "string" || email.length > 254 || Buffer.byteLength(password, "utf8") > 72
      ) {
        return res.status(400).json({
          success: false,
          error: "Введите email и пароль"
        });
      }

      const result = await pool.query(
        "SELECT * FROM users WHERE lower(btrim(email)) = $1",
        [email.trim().toLowerCase()]
      );

      const user = result.rows[0];

      const validPassword = await bcrypt.compare(
        password,
        user ? user.password_hash : dummyHash
      );

      if (!user || !validPassword) {
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
      console.error("Login failed");

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
      if (!/^[1-9][0-9]{0,18}$/.test(String(decoded.userId)) ||
          BigInt(decoded.userId) > 9223372036854775807n) throw new Error("Invalid subject");
      req.userId = String(decoded.userId);

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
      console.error("Profile lookup failed");

      res.status(500).json({
        success: false,
        error: "Ошибка загрузки профиля"
      });
    }
  });


  function validPhotoRequest(body) {
    const { image, prompt } = body || {};
    return typeof image === "string" &&
      /^(data:image\/(jpeg|png);base64,)/.test(image) &&
      image.length <= 12 * 1024 * 1024 &&
      typeof prompt === "string" &&
      !!prompt.trim() &&
      prompt.length <= 1500;
  }

  function imageUrlFromOutput(output) {
    const candidate = Array.isArray(output) ? output[0] : output;
    const value = typeof candidate === "string" ? candidate
      : typeof candidate?.url === "function" ? String(candidate.url()) : candidate?.url;
    try { return new URL(value).protocol === "https:" ? value : null; }
    catch { return null; }
  }

  // A durable idempotency record and credit reservation are committed together.
  app.post("/api/generate/account", authenticate, async (req, res) => {
    if (!validPhotoRequest(req.body)) return res.status(400).json({ success: false, error: "Проверь фото и описание" });
    const key = req.get("Idempotency-Key");
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
      return res.status(400).json({ success: false, error: "Нужен уникальный Idempotency-Key" });
    }
    if (!generationEnabled) return res.status(503).json({ success: false, error: "Генерация временно недоступна" });
    const fingerprint = createHash("sha256").update(JSON.stringify([req.body.image, req.body.prompt.trim()])).digest("hex");
    let client;
    let reserved = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      // Serialize requests for this account, including concurrent duplicate keys.
      const user = await client.query("SELECT credits FROM users WHERE id=$1 FOR UPDATE", [req.userId]);
      if (!user.rowCount) {
        await client.query("ROLLBACK");
        return res.status(401).json({ success: false, error: "Аккаунт не найден" });
      }
      const previous = await client.query("SELECT * FROM generation_requests WHERE user_id=$1 AND request_key=$2", [req.userId, key]);
      if (previous.rowCount) {
        await client.query("ROLLBACK");
        const job = previous.rows[0];
        if (job.fingerprint !== fingerprint) return res.status(409).json({ success: false, error: "Ключ уже использован для другого запроса" });
        if (job.status === "succeeded") return res.json({ success: true, image: job.image_url, credits: user.rows[0].credits });
        return res.status(409).json({ success: false, code: job.status === "processing" ? "GENERATION_PROCESSING" : "GENERATION_FAILED", error: job.status === "processing" ? "Запрос уже выполняется" : "Запрос завершился ошибкой. Создай новый запрос." });
      }
      const debit = await client.query("UPDATE users SET credits=credits-1 WHERE id=$1 AND credits>0 RETURNING credits", [req.userId]);
      if (!debit.rowCount) {
        await client.query("ROLLBACK");
        return res.status(402).json({ success: false, error: "Бесплатные генерации закончились" });
      }
      await client.query("INSERT INTO generation_requests (user_id, request_key, fingerprint, status) VALUES ($1,$2,$3,'processing')", [req.userId, key, fingerprint]);
      await client.query("COMMIT");
      reserved = true;
      client.release(); client = null;

      let imageUrl;
      let providerCompleted = false;
      let providerFailed = false;
      try {
        const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
          input: { prompt: req.body.prompt.trim(), input_image: req.body.image, output_format: "jpg", aspect_ratio: "match_input_image" }
        }, prediction => { providerFailed = ["failed", "canceled"].includes(prediction.status); });
        providerCompleted = true;
        imageUrl = imageUrlFromOutput(output);
        if (!imageUrl) throw new Error("Invalid provider output");
      } catch {
        if (!providerCompleted && !providerFailed) {
          // A timeout may hide a successful paid prediction. Do not refund or retry it.
          return res.status(503).json({ success: false, code: "GENERATION_UNCERTAIN", error: "Результат провайдера пока не подтверждён. Не создавай повторный запрос." });
        }
        // Refund and terminal status change are atomic; retries cannot refund twice.
        client = await pool.connect();
        await client.query("BEGIN");
        const failed = await client.query("UPDATE generation_requests SET status='failed' WHERE user_id=$1 AND request_key=$2 AND status='processing' RETURNING user_id", [req.userId, key]);
        if (failed.rowCount) await client.query("UPDATE users SET credits=credits+1 WHERE id=$1", [req.userId]);
        await client.query("COMMIT");
        return res.status(502).json({ success: false, error: "Не удалось создать фото. Баланс восстановлен." });
      }
      // If final persistence fails, keep processing state: never refund a successful paid call.
      await pool.query("UPDATE generation_requests SET status='succeeded', image_url=$3 WHERE user_id=$1 AND request_key=$2 AND status='processing'", [req.userId, key, imageUrl]);
      const balance = await pool.query("SELECT credits FROM users WHERE id=$1", [req.userId]);
      return res.json({ success: true, image: imageUrl, credits: balance.rows[0].credits });
    } catch {
      if (client) await client.query("ROLLBACK").catch(() => {});
      console.error("Account generation persistence failure; reserved:", reserved);
      return res.status(503).json({ success: false, error: "Не удалось подтвердить результат. Повтори запрос с тем же ключом." });
    } finally {
      if (client) client.release();
    }
  });

  // AI PHOTO GENERATION
  // Existing test access remains available.

  app.post("/api/generate", async (req, res) => {
    try {
      const secret = enableLegacyGeneration && testKey;

      if (!secret) {
        return res.status(503).json({
          success: false,
          error: "Тестовый доступ не настроен"
        });
      }

      const providedKey = req.get("x-velora-key");

      if (providedKey !== secret) {
        return res.status(401).json({
          success: false,
          error: "Неверный тестовый ключ"
        });
      }

      const { image, prompt } = req.body || {};

      if (
        typeof image !== "string" ||
        !(
          image.startsWith("data:image/jpeg;base64,") ||
          image.startsWith("data:image/png;base64,")
        )
      ) {
        return res.status(400).json({
          success: false,
          error: "Необходима фотография JPEG или PNG"
        });
      }

      if (
        typeof prompt !== "string" ||
        !prompt.trim() ||
        prompt.length > 1500
      ) {
        return res.status(400).json({
          success: false,
          error: "Некорректное описание фотографии"
        });
      }

      const output = await replicate.run(
        "black-forest-labs/flux-kontext-pro",
        {
          input: {
            prompt: prompt.trim(),
            input_image: image,
            output_format: "jpg",
            aspect_ratio: "match_input_image"
          }
        }
      );

      const imageUrl = imageUrlFromOutput(output);

      if (!imageUrl) {
        throw new Error("No image URL returned");
      }

      res.json({
        success: true,
        image: imageUrl
      });

    } catch (error) {
      console.error("Legacy generation failed");

      res.status(500).json({
        success: false,
        error: "Ошибка генерации фотографии"
      });
    }
  });

  return app;
}

async function initDatabase(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 2, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_normalized_email_unique ON users (lower(btrim(email)))");
  // Never reset existing balances during startup. New accounts explicitly receive two.
  await pool.query(`CREATE TABLE IF NOT EXISTS generation_requests (
    user_id BIGINT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('processing','succeeded','failed')),
    image_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, request_key)
  )`);
}

function databaseOptions(settings = process.env) {
  const url = settings.DATABASE_URL ? new URL(settings.DATABASE_URL) : null;
  const host = url ? url.hostname : (settings.PGHOST || "localhost");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || host.startsWith("/");
  if (url && !local) {
    // pg URL SSL parameters can override an explicit ssl object. Prevent downgrades.
    for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat", "ssl"]) url.searchParams.delete(name);
  }
  return {
    connectionString: url ? url.toString() : undefined,
    ssl: settings.DATABASE_SSL_CA
      ? { ca: settings.DATABASE_SSL_CA, rejectUnauthorized: true }
      : local ? undefined : { rejectUnauthorized: true }
  };
}

async function start() {
  const jwtSecret = process.env.JWT_SECRET;
  // Validate configuration before touching a database or opening a listener.
  if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) throw new Error("JWT_SECRET must contain at least 32 bytes");
  const pool = new Pool(databaseOptions());
  await initDatabase(pool);
  const app = createApp({ pool, jwtSecret,
    replicate: new Replicate({ auth: process.env.REPLICATE_API_TOKEN }),
    generationEnabled: !!process.env.REPLICATE_API_TOKEN,
    testKey: process.env.VELORA_TEST_KEY,
    enableLegacyGeneration: process.env.ENABLE_LEGACY_GENERATION === "true"
  });
  return app.listen(process.env.PORT || 3000, "0.0.0.0", () => console.log("Velora AI database and server ready"));
}
if (require.main === module) start().catch(() => { console.error("Startup failed: check database and JWT configuration"); process.exitCode = 1; });
module.exports = { createApp, initDatabase, databaseOptions };
