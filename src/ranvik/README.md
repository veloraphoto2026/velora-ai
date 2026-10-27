# Ranvik adapter (not deployed)
- Requires server-side RANVIK_API_KEY.
- Supports allowlisted chat and image endpoints as a private module only.
- NOT exposed as an HTTP route. No unbilled provider calls are possible from the browser through this module.
- Model IDs, payload validation and quote/reserve/settle must be implemented before wiring to routes.
- Video/audio/3D require separate validated adapters and async task lifecycle.
- Do not log keys or raw personal images.
