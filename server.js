const express = require("express");
const cors = require("cors");
const Replicate = require("replicate");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

// Replicate AI
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

// Database
let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

// Website
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "Velora AI",
    status: "running"
  });
});

// AI photo generation
app.post("/api/generate", async (req, res) => {
  try {
    const secret = process.env.VELORA_TEST_KEY;

    if (!secret) {
      return res.status(503).json({
        success: false,
        error: "Test access is not configured"
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

    // Validate image
    if (
      typeof image !== "string" ||
      !(
        image.startsWith("data:image/jpeg;base64,") ||
        image.startsWith("data:image/png;base64,")
      )
    ) {
      return res.status(400).json({
        success: false,
        error: "Загрузи фотографию JPEG или PNG"
      });
    }

    // Validate prompt
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

    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(503).json({
        success: false,
        error: "Replicate API не подключён"
      });
    }

    console.log("Velora AI: generation started");

    // Generate image
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

    // Extract image URL
    let imageUrl = null;

    if (typeof output === "string") {
      imageUrl = output;
    } else if (typeof output?.url === "function") {
      imageUrl = output.url();
    } else if (Array.isArray(output) && output.length) {
      const first = output[0];

      imageUrl =
        typeof first === "string"
          ? first
          : typeof first?.url === "function"
            ? first.url()
            : null;
    }

    if (!imageUrl) {
      throw new Error("No image URL returned");
    }

    console.log("Velora AI: generation completed");

    return res.json({
      success: true,
      image: String(imageUrl)
    });

  } catch (error) {
    console.error("Velora AI generation error:", error);

    return res.status(500).json({
      success: false,
      error: "Ошибка генерации. Проверь настройки Replicate."
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Velora AI running on port ${PORT}`);
});
