import { readFile, rename, mkdir, stat, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { ROOT, loadEnv } from "./env.js";

loadEnv();

const CACHE_DIR = path.join(ROOT, "assets", "cache");

const PROVIDER = (process.env.VOICE_PROVIDER || "demo").toLowerCase();
const EDGE_VOICE = process.env.EDGE_VOICE || "es-AR-TomasNeural";

const FISH_BASE = process.env.FISH_API_BASE || "https://api.fish.audio";
const FISH_API_KEY = process.env.FISH_API_KEY || "";
const FISH_VOICE_ID = process.env.FISH_VOICE_ID || "";
const FISH_MODEL = process.env.FISH_MODEL || "s2.1-pro-free";
const FISH_LANGUAGE = process.env.FISH_LANGUAGE || "es-MX";

export function providerInfo() {
  if (PROVIDER === "fish") {
    const configured = Boolean(FISH_API_KEY && FISH_VOICE_ID);
    return {
      provider: "fish",
      cloned: configured,
      configured,
      voice: FISH_VOICE_ID || undefined,
      model: FISH_MODEL,
    };
  }

  if (PROVIDER === "demo") {
    return {
      provider: "demo",
      cloned: false,
      configured: true,
      voice: EDGE_VOICE,
    };
  }

  return { provider: PROVIDER, cloned: false, configured: false };
}

export async function synthesize(text) {
  if (PROVIDER === "demo") return synthesizeDemo(text);
  if (PROVIDER === "fish") return synthesizeFish(text);
  throw new Error(
    `El proveedor de voz “${PROVIDER}” no está configurado. Usá VOICE_PROVIDER=demo o VOICE_PROVIDER=fish.`
  );
}

async function synthesizeFish(text) {
  if (!FISH_API_KEY) {
    throw new Error("Falta FISH_API_KEY en .env. Sacala de https://fish.audio y volvé a intentar.");
  }
  if (!FISH_VOICE_ID) {
    throw new Error(
      "Falta FISH_VOICE_ID en .env. Creá la voz clonada con: npm run clone -- assets/voz-amigo.wav \"Voz de mi amigo\"."
    );
  }

  const response = await fetch(`${FISH_BASE}/v1/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FISH_API_KEY}`,
      "Content-Type": "application/json",
      model: FISH_MODEL,
    },
    body: JSON.stringify({
      text,
      reference_id: FISH_VOICE_ID,
      format: "mp3",
      language: FISH_LANGUAGE,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Fish Audio respondió ${response.status}: ${truncate(detail, 300)}`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length) throw new Error("Fish Audio devolvió un audio vacío.");

  return {
    data,
    mime: response.headers.get("content-type") || "audio/mpeg",
  };
}

async function synthesizeDemo(text) {
  const hash = createHash("sha1")
    .update(`demo:${EDGE_VOICE}:${text}`)
    .digest("hex")
    .slice(0, 24);
  const file = path.join(CACHE_DIR, `${hash}.mp3`);

  try {
    const data = await readFile(file);
    if (data.length > 0) return { data, mime: "audio/mpeg" };
  } catch {
    /* todavía no está en caché */
  }

  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;

  try {
    await new Promise((resolve, reject) => {
      execFile(
        "uvx",
        ["edge-tts", "--voice", EDGE_VOICE, "--text", text, "--write-media", tmp],
        { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          if (error) {
            const detail =
              error.code === "ENOENT"
                ? "No se encontró “uvx”. Instalá uv o usá VOICE_PROVIDER=fish."
                : (stderr || error.message || "").trim();
            reject(new Error(`No se pudo generar la voz de prueba: ${detail}`));
            return;
          }
          resolve();
        }
      );
    });

    const info = await stat(tmp);
    if (!info.size) throw new Error("La voz de prueba salió vacía.");
    await rename(tmp, file);
    const data = await readFile(file);
    return { data, mime: "audio/mpeg" };
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
