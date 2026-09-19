import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://b8wzw0-h3.myshopify.com",
  "http://127.0.0.1:9293",
  "http://localhost:9293",
];

loadLocalEnv();

const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const allowedOrigins = getAllowedOrigins();

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    sendCors(response, request);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, request, 200, {
      ok: true,
      service: "bazaar-chat",
      model,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    sendJson(response, request, 200, {
      ok: true,
      service: "bazaar-chat",
      routes: ["POST /api/chat", "GET /health"],
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    try {
      const payload = await readJson(request);
      const message = String(payload.message || "").trim();

      if (!message) {
        sendJson(response, request, 400, { error: "message is required" });
        return;
      }

      const reply = await askGemini({
        message,
        shopperId: stringOrNull(payload.shopperId),
        pageUrl: stringOrNull(payload.pageUrl),
        product: publicObjectOrNull(payload.product),
        products: publicArray(payload.products),
      });

      sendJson(response, request, 200, { reply });
    } catch (error) {
      console.error("[api/chat]", error);
      sendJson(response, request, 500, {
        reply: fallbackReply(),
        error: "chat_failed",
      });
    }
    return;
  }

  sendJson(response, request, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`Bazaar chat server listening on :${port}`);
});

function loadLocalEnv() {
  const startDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(startDir, "../../../.env"),
    join(startDir, "../../.env"),
    join(process.cwd(), ".env"),
  ];

  for (const candidate of candidates) {
    try {
      const envText = readFileSync(resolve(candidate), "utf8");
      for (const line of envText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

        const index = trimmed.indexOf("=");
        const key = trimmed.slice(0, index).trim();
        const rawValue = trimmed.slice(index + 1).trim();
        const value = rawValue.replace(/^["']|["']$/g, "");

        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      return;
    } catch {
      // Try the next likely repo/app location.
    }
  }
}

function getAllowedOrigins() {
  const configured = process.env.ALLOWED_ORIGINS;
  if (!configured) return DEFAULT_ALLOWED_ORIGINS;

  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function sendCors(response, request) {
  const origin = request.headers.origin;
  const isShopifyPreview = origin && /^https:\/\/[a-z0-9-]+\.shopifypreview\.com$/i.test(origin);
  const allowed = origin && (allowedOrigins.includes(origin) || isShopifyPreview);

  if (allowed) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(response, request, status, body) {
  sendCors(response, request);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolveJson, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        request.destroy(new Error("Request body too large"));
      }
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolveJson(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function askGemini(context) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fallbackReply();
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const geminiResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt() }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt(context) }],
        },
      ],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 350,
      },
    }),
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    throw new Error(`Gemini ${geminiResponse.status}: ${errorText.slice(0, 500)}`);
  }

  const data = await geminiResponse.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || fallbackReply();
}

function systemPrompt() {
  return [
    "You are Bazaar's AI shopkeeper for a Shopify clothing store.",
    "Use only the public product context supplied by the storefront.",
    "Help shoppers with outfit ideas, sizing, shipping, returns, and product discovery.",
    "You may mention visible storefront prices if supplied.",
    "Do not claim a discount, checkout link, inventory guarantee, policy, private cost, or binding offer unless the context explicitly supplies it.",
    "If the shopper asks to haggle, make an offer, or get a deal, explain that the real offer engine is being connected and invite them to ask about products meanwhile.",
    "Keep replies concise, warm, and useful: 1 to 4 short sentences.",
  ].join(" ");
}

function buildUserPrompt(context) {
  return JSON.stringify(
    {
      shopperMessage: context.message,
      shopperId: context.shopperId,
      pageUrl: context.pageUrl,
      currentProduct: context.product,
      visibleProducts: context.products,
    },
    null,
    2,
  );
}

function fallbackReply() {
  return "I can help with outfits, sizing, shipping, and the visible products on this storefront. The real AI endpoint is still warming up, so ask me about a product and I will keep it practical.";
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function publicObjectOrNull(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function publicArray(value) {
  return Array.isArray(value) ? value.slice(0, 12) : [];
}
