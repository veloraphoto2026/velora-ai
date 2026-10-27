# Ranvik API — verified integration notes (2026-10-27)

Official references:
- https://api.ranvik.ru/
- https://api.ranvik.ru/models
- https://api.ranvik.ru/docs/models/krea-2-turbo
- https://api.ranvik.ru/docs/models/reve-2-1

Confirmed public documentation:
- OpenAI-compatible base URL: `https://api.ranvik.ru/v1`.
- Chat example uses `chat.completions.create`.
- Image example uses `images.generate`; model-specific fields differ from standard OpenAI image payloads.
- `krea-2-turbo` supports image generation and editing; sample required fields: `positivePrompt`, `width`, `height`; allowed square size `1024×1024`; advertised provider price 1.98 RUB per image at time of review.
- `reve-2-1` supports image generation and editing; advertised provider price 26.41 RUB per image at time of review.
- Catalog advertises text, image, video, audio and 3D categories; availability, parameters, asynchronous delivery and pricing must be verified per model.

Safety / launch constraints:
1. These are provider prices, NOT Velora AI retail prices. Do not expose them as customer quotes or debit wallets until a retail pricing policy and cost margins are approved.
2. The existing Ranvik adapter is a scaffold. Verify endpoints and response shapes with sandbox calls using a server-side key, never in browser.
3. Never run a paid provider request until the wallet reserve, provider retry semantics and settlement are tested end to end.
4. Keep model catalog unavailable for purchases until exact server-side quotes are configured.
5. Do not place any API key, terminal password, JWT secret or credentials in GitHub.
