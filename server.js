const express = require("express");
const cors = require("cors");
const Replicate = require("replicate");

const app = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

app.get("/", (req, res) => {
  res.json({
    message: "Velora AI server is running"
  });
});

app.post("/api/generate", async (req, res) => {
  try {
    const secret = process.env.VELORA_TEST_KEY;

    if (!secret) {
      return res.status(503).json({
        error: "Test access is not configured"
      });
    }

    if (req.get("x-velora-key") !== secret) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { image, prompt } = req.body;

    if (
      typeof image !== "string" ||
      !image.startsWith("data:image/jpeg;base64,") &&
      !image.startsWith("data:image/png;base64,")
    ) {
      return res.status(400).json({
        error: "A JPEG or PNG image is required"
      });
    }

    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 1500
    ) {
      return res.status(400).json({
        error: "Invalid prompt"
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

    const imageUrl =
      typeof output === "string"
        ? output
        : typeof output?.url === "function"
          ? output.url()
          : null;

    if (!imageUrl) {
      throw new Error("No image URL returned");
    }

    res.json({
      success: true,
      image: imageUrl
    });

  } catch (error) {
    console.error("Generation error:", error);

    res.status(500).json({
      error: "Generation failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Velora AI running on port ${PORT}`);
});
