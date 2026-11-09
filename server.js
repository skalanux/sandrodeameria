import http from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { providerInfo, synthesize } from "./lib/voice.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const PHRASE_IDS = new Set();
try {
  const phrases = JSON.parse(readFileSync(path.join(ROOT, "phrases.json"), "utf8"));
  if (Array.isArray(phrases)) {
    for (const phrase of phrases) PHRASE_IDS.add(String(phrase.id));
  }
} catch (error) {
  console.warn(`No pude leer phrases.json: ${error.message}`);
}

const SPA_ROUTES = new Set(["/control", "/local", "/display"]);
const clients = new Set();
let nextClientId = 1;
let lastStatus = { state: "idle", label: "Listo", error: false, visual: "face" };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("El cuerpo de la petición es demasiado grande."));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON inválido."));
      }
    });

    req.on("error", reject);
  });
}

function presence() {
  let displays = 0;
  let controls = 0;
  let primaryDisplayId = null;
  for (const client of clients) {
    if (client.role === "display") {
      displays += 1;
      if (client.primary) primaryDisplayId = client.id;
    } else {
      controls += 1;
    }
  }
  return { displays, controls, primaryDisplayId };
}

function removeClient(client) {
  if (!clients.has(client)) return;
  const wasPrimary = client.role === "display" && client.primary;
  clients.delete(client);

  if (wasPrimary) {
    const next = [...clients].find((candidate) => candidate.role === "display");
    if (next) next.primary = true;
  }

  broadcast("presence", presence());
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data, role = null) {
  let delivered = 0;
  for (const client of clients) {
    if (role && client.role !== role) continue;
    try {
      sendEvent(client.res, event, data);
      delivered += 1;
    } catch {
      const wasPrimary = client.role === "display" && client.primary;
      clients.delete(client);
      if (wasPrimary) {
        const next = [...clients].find((candidate) => candidate.role === "display");
        if (next) next.primary = true;
      }
    }
  }
  return delivered;
}

function broadcastCommand(command) {
  const primary = [...clients].find(
    (client) => client.role === "display" && client.primary
  );
  if (!primary) return 0;

  try {
    sendEvent(primary.res, "command", command);
    return 1;
  } catch {
    removeClient(primary);
    return 0;
  }
}

function handleEvents(req, res, url) {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.end("Método no permitido");
    return;
  }

  const role = url.searchParams.get("role") === "display" ? "display" : "control";

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(": conectado\n\n");

  const client = {
    res,
    role,
    id: nextClientId++,
    primary: role === "display" && ![...clients].some((candidate) => candidate.role === "display" && candidate.primary),
  };
  clients.add(client);
  sendEvent(res, "hello", {
    role,
    clientId: client.id,
    primary: client.primary,
    ...presence(),
    status: lastStatus,
  });
  broadcast("presence", presence());

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(heartbeat);
      removeClient(client);
    }
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient(client);
  });
}

function normalizeCommand(body) {
  if (!body || typeof body !== "object") return null;

  if (body.type === "phrase") {
    const id = String(body.id || "");
    return PHRASE_IDS.has(id) ? { type: "phrase", id } : null;
  }

  if (body.type === "text") {
    const text = String(body.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length > 280) return null;
    return { type: "text", text };
  }

  if (body.type === "visual" && (body.mode === "face" || body.mode === "video")) {
    return { type: "visual", mode: body.mode };
  }

  if (body.type === "stop") return { type: "stop" };
  return null;
}

async function handleCommand(req, res) {
  try {
    const body = await readJson(req);
    const command = normalizeCommand(body);
    if (!command) {
      sendJson(res, 400, { error: "Comando inválido." });
      return;
    }
    const delivered =
      command.type === "visual"
        ? broadcast("command", command, "display")
        : broadcastCommand(command);
    if (command.type === "visual") {
      lastStatus = { ...lastStatus, visual: command.mode };
      broadcast("status", lastStatus, "control");
    }
    sendJson(res, 200, { ok: true, delivered });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Comando inválido." });
  }
}

async function handleStatus(req, res) {
  try {
    const body = await readJson(req);
    const state = ["idle", "generating", "speaking"].includes(body.state)
      ? body.state
      : "idle";
    const label = String(body.label || "").slice(0, 160);
    const error = Boolean(body.error);
    const visual =
      body.visual === "face" || body.visual === "video"
        ? body.visual
        : lastStatus.visual;
    lastStatus = { state, label, error, visual };
    broadcast("status", lastStatus, "control");
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Estado inválido." });
  }
}

async function serveFile(filePath, req, res) {
  const info = await stat(filePath);
  if (info.isDirectory()) {
    return serveFile(path.join(filePath, "index.html"), req, res);
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const range = req.headers.range;

  if (range && /^bytes=/.test(range)) {
    const [startValue, endValue] = range.replace(/^bytes=/, "").split("-");
    const start = Number.parseInt(startValue, 10);
    const end = endValue ? Number.parseInt(endValue, 10) : info.size - 1;

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start >= info.size
    ) {
      res.writeHead(416, {
        "Content-Range": `bytes */${info.size}`,
        "Accept-Ranges": "bytes",
      });
      res.end();
      return;
    }

    const safeEnd = Math.min(end, info.size - 1);
    res.writeHead(206, {
      "Content-Type": contentType,
      "Content-Length": safeEnd - start + 1,
      "Content-Range": `bytes ${start}-${safeEnd}/${info.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath, { start, end: safeEnd }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": info.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Método no permitido");
    return;
  }

  let rel = decodeURIComponent(pathname);
  const clean = rel.replace(/\/+$/, "") || "/";

  // No servir archivos ocultos (.env, .git, etc.) ni carpetas privadas.
  const privatePrefixes = ["/certs", "/models", "/vendor", "/scripts", "/venv"];
  if (
    clean.split("/").some((part) => part.startsWith(".")) ||
    privatePrefixes.some(
      (prefix) => clean === prefix || clean.startsWith(`${prefix}/`)
    )
  ) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
    return;
  }

  if (clean === "/" || SPA_ROUTES.has(clean)) {
    rel = "/index.html";
  } else {
    rel = clean;
  }

  const filePath = path.resolve(ROOT, `.${rel}`);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(res, 403, { error: "Prohibido." });
    return;
  }

  try {
    await serveFile(filePath, req, res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/events") {
    handleEvents(req, res, url);
    return;
  }

  if (url.pathname === "/api/command") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end("Método no permitido");
      return;
    }
    await handleCommand(req, res);
    return;
  }

  if (url.pathname === "/api/status") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end("Método no permitido");
      return;
    }
    await handleStatus(req, res);
    return;
  }

  if (url.pathname === "/api/state") {
    sendJson(res, 200, { ok: true, ...presence(), status: lastStatus });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, ...providerInfo() });
    return;
  }

  if (url.pathname === "/api/tts") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST" });
      res.end("Método no permitido");
      return;
    }

    try {
      const body = await readJson(req);
      const text = String(body.text || "")
        .replace(/\s+/g, " ")
        .trim();

      if (!text) {
        sendJson(res, 400, { error: "Escribí un texto para el avatar." });
        return;
      }
      if (text.length > 280) {
        sendJson(res, 400, { error: "El texto no puede superar los 280 caracteres." });
        return;
      }

      const { data, mime } = await synthesize(text);
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": data.length,
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch (error) {
      const status = /JSON inválido|demasiado grande/i.test(error.message || "") ? 400 : 502;
      sendJson(res, status, {
        error: error.message || "No se pudo generar la voz.",
      });
    }
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "API no encontrada." });
    return;
  }

  await serveStatic(req, res, url.pathname);
}

function handler(req, res) {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Error interno del servidor." });
    } else {
      res.end();
    }
  });
}

function logServerError(serverName, error) {
  if (error.code === "EADDRINUSE") {
    console.error(`${serverName}: el puerto ya está en uso. Cambiá PORT en .env.`);
  } else {
    console.error(`${serverName}:`, error);
  }
  process.exit(1);
}

const httpServer = http.createServer(handler);
httpServer.on("error", (error) => logServerError("HTTP", error));

const shownHost = HOST === "0.0.0.0" ? "localhost" : HOST;
const info = providerInfo();

httpServer.listen(PORT, HOST, () => {
  console.log(`Avatar listo en http://${shownHost}:${PORT}`);
  console.log(`  Pantalla (solo avatar): http://${shownHost}:${PORT}/`);
  console.log(`  Control remoto: http://${shownHost}:${PORT}/control`);
  console.log(`  Setup y calibración: http://${shownHost}:${PORT}/local`);

  if (info.provider === "demo") {
    console.log(`Voz de prueba: ${info.voice} (no clonada).`);
  } else if (info.provider === "fish") {
    console.log(
      info.configured
        ? `Fish Audio listo con la voz ${info.voice}.`
        : "Fish Audio sin configurar: agregá FISH_API_KEY y FISH_VOICE_ID en .env."
    );
  } else {
    console.log(`Proveedor de voz: ${info.provider}.`);
  }

  console.log(
    HOST === "0.0.0.0"
      ? "Escuchando en todas las interfaces. En producción, Traefik provee HTTPS."
      : "Para control remoto en la LAN, poné HOST=0.0.0.0 en .env y reiniciá."
  );
});

function shutdown() {
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
