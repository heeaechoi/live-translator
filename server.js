// Live Translator server: serves the iPad web app and streams Claude translations.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Translator } from "./translator.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no extra dependency).
const envFile = path.join(here, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const PUBLIC_DIR = path.join(here, "public");
const MAX_TEXT = 2000;

const translator = new Translator();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function errorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않아요. .env의 ANTHROPIC_API_KEY를 확인하세요.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 너무 많아요. 잠시 후 다시 시도됩니다.";
  if (err instanceof Anthropic.NotFoundError) return "모델을 찾을 수 없어요. TRANSLATOR_MODEL 값을 확인하세요.";
  if (err instanceof Anthropic.APIConnectionError) return "Claude API에 연결할 수 없어요. 인터넷 연결을 확인하세요.";
  if (err instanceof Anthropic.APIError) return `번역 서버 오류 (${err.status ?? "?"})`;
  return "번역 중 오류가 발생했어요.";
}

async function handleTranslate(req, res) {
  if (APP_PASSWORD && req.headers["x-app-password"] !== APP_PASSWORD) {
    return sendJson(res, 401, { error: "비밀번호가 틀렸어요." });
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: "잘못된 요청" });
  }
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return sendJson(res, 400, { error: "text가 비어 있어요." });
  const context = Array.isArray(body.context)
    ? body.context
        .filter((c) => c && typeof c.en === "string")
        .slice(-8)
        .map((c) => ({ en: c.en.slice(0, MAX_TEXT), ko: typeof c.ko === "string" ? c.ko.slice(0, MAX_TEXT) : "" }))
    : [];
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : "";

  // Server-Sent Events over a POST response.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  const started = Date.now();
  try {
    const result = await translator.translate({
      text,
      context,
      notes,
      signal: abort.signal,
      onDelta: (d) => send("delta", { text: d }),
    });
    if (result.stopReason === "refusal") {
      send("error", { error: "이 문장은 번역이 거절되었어요." });
    } else {
      send("done", { text: result.text, ms: Date.now() - started, model: result.model });
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("[translate]", err?.status ?? "", err?.message ?? err);
      send("error", { error: errorMessage(err) });
    }
  } finally {
    res.end();
  }
}

async function handler(req, res) {
  try {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname === "/api/translate" && req.method === "POST") return await handleTranslate(req, res);
    if (pathname === "/api/config" && req.method === "GET") {
      return sendJson(res, 200, { model: translator.model, passwordRequired: Boolean(APP_PASSWORD) });
    }
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    sendJson(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "server error" });
    else res.end();
  }
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

http.createServer(handler).listen(PORT, () => {
  console.log(`\n🎧 Live Translator  (model: ${translator.model}, effort: ${translator.effort})`);
  console.log(`   HTTP : http://localhost:${PORT}`);
});

const keyFile = path.join(here, "certs", "key.pem");
const certFile = path.join(here, "certs", "cert.pem");
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  https
    .createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler)
    .listen(HTTPS_PORT, () => {
      for (const ip of lanAddresses()) console.log(`   iPad : https://${ip}:${HTTPS_PORT}   ← 아이패드 Safari에서 열기`);
    });
} else {
  console.log("   (아이패드에서 쓰려면 HTTPS가 필요해요: `npm run cert` 실행 후 다시 시작하세요)");
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("⚠️  ANTHROPIC_API_KEY가 없어요. .env 파일에 키를 넣어주세요 (.env.example 참고).");
}
