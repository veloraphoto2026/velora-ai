const express = require("express");

const app = express();

app.use(express.json({ limit: "15mb" }));

app.post("/api/generate", async (req, res) => {
  try {
    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return res.status(500).json({
        error: "API token is not configured"
      });
    }

    res.json({
      message: "Velora AI server is ready"
    });

  } catch (error) {
    res.status(500).json({
      error: "Generation failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Velora AI running on port ${PORT}`);
});
