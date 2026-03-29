/**
 * Videa Example App — Node.js Server
 *
 * Proxies API calls to the Videa server, keeping the API key server-side.
 * The frontend never sees the raw API key.
 *
 * Usage:
 *   npm install
 *   npm start                                          # defaults: localhost:3200, no API key
 *   VIDEA_URL=http://localhost:3200 VIDEA_API_KEY=videa_xxx VIDEA_API_KEY_ID=clxxx npm start
 *   PORT=4000 npm start
 */

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;
const VIDEA_URL = (process.env.VIDEA_URL || "http://localhost:3200").replace(
  /\/+$/,
  ""
);
const VIDEA_API_KEY = process.env.VIDEA_API_KEY || "";
const VIDEA_API_KEY_ID = process.env.VIDEA_API_KEY_ID || "";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Health / config endpoint (safe subset) ───────────────────────
app.get("/api/config", (_req, res) => {
  res.json({
    videaUrl: VIDEA_URL,
    hasApiKey: !!VIDEA_API_KEY,
    // Exposed for popup URLs which run on the Videa domain.
    // Both authorize and deposit popups use the DB ID (client_id=).
    apiKey: VIDEA_API_KEY,
    apiKeyId: VIDEA_API_KEY_ID,
  });
});

// ─── Payment Intent: create intent server-side (recommended) ──────
// POST /api/create-intent  { type, creatorUserId, revenuePlan, externalTransactionId, ...params }
// The client MUST provide externalTransactionId (required by Videa API).
// The server forwards it as-is — if omitted, Videa API validation will reject the request.
app.post("/api/create-intent", async (req, res) => {
  if (!VIDEA_API_KEY) {
    return res
      .status(500)
      .json({ error: "VIDEA_API_KEY not configured on server" });
  }

  const url = VIDEA_URL + "/api/v1/external/payment-intents";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": VIDEA_API_KEY,
      },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json().catch(() => ({}));
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Proxy error: " + err.message });
  }
});

// ─── Proxy: forward requests to Videa ─────────────────────────────
// POST /api/proxy  { method, endpoint, body?, bearerToken?, idempotencyKey? }
app.post("/api/proxy", async (req, res) => {
  const {
    method = "GET",
    endpoint,
    body,
    bearerToken,
    idempotencyKey,
  } = req.body;

  if (!endpoint) {
    return res.status(400).json({ error: "endpoint is required" });
  }
  if (!VIDEA_API_KEY) {
    return res
      .status(500)
      .json({ error: "VIDEA_API_KEY not configured on server" });
  }

  const url = VIDEA_URL + endpoint;
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": VIDEA_API_KEY,
  };

  if (bearerToken) {
    headers["Authorization"] = "Bearer " + bearerToken;
  }
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const fetchOpts = { method, headers };
  if (body && method !== "GET") {
    fetchOpts.body = JSON.stringify(body);
  }

  try {
    const resp = await fetch(url, fetchOpts);
    const data = await resp.json().catch(() => ({}));
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Proxy error: " + err.message });
  }
});

// ─── Fallback to index.html ───────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  Videa Example App running at http://localhost:${PORT}`);
  console.log(`  Proxying to Videa at ${VIDEA_URL}`);
  console.log(`  API Key: ${VIDEA_API_KEY ? "configured" : "NOT SET — use VIDEA_API_KEY env var"}`);
  console.log(`  API Key ID: ${VIDEA_API_KEY_ID ? VIDEA_API_KEY_ID : "NOT SET — use VIDEA_API_KEY_ID env var (needed for deposit popup)"}\n`);
});
