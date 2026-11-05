import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../lib/env.js";

loadEnv();

const API_KEY = process.env.FISH_API_KEY || "";
const BASE = process.env.FISH_API_BASE || "https://api.fish.audio";

const samplePath = process.argv[2];
const title = process.argv[3] || "Voz de mi amigo";

const MIME = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".opus": "audio/ogg",
};

function usage() {
  console.error('Uso: npm run clone -- assets/voz-amigo.wav "Voz de mi amigo"');
  console.error("El audio debe ser una sola persona, limpio, sin música, de 10 s a 2 min.");
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

if (!API_KEY) {
  console.error("Falta FISH_API_KEY. Copiá .env.example a .env y pegá tu clave de https://fish.audio");
  process.exit(1);
}

if (!samplePath) {
  usage();
  process.exit(1);
}

const filePath = path.resolve(process.cwd(), samplePath);
const info = await stat(filePath).catch(() => null);
if (!info?.isFile()) {
  console.error(`No encontré el archivo: ${filePath}`);
  usage();
  process.exit(1);
}
if (!info.size) {
  console.error("El archivo está vacío.");
  process.exit(1);
}

const ext = path.extname(filePath).toLowerCase();
const mime = MIME[ext];
if (!mime) {
  console.error(`Formato no soportado: ${ext || "(sin extensión)"}. Usá .wav, .mp3, .m4a u .opus.`);
  process.exit(1);
}

console.log(
  `Subiendo ${path.basename(filePath)} (${formatSize(info.size)})...`
);
console.log(`Título: ${title}`);
console.log("Visibilidad: private");

const buffer = await readFile(filePath);
const form = new FormData();
form.append("type", "tts");
form.append("title", title);
form.append("visibility", "private");
form.append("train_mode", "fast");
form.append("enhance_audio_quality", "true");
form.append("voices", new Blob([buffer], { type: mime }), path.basename(filePath));

const response = await fetch(`${BASE}/model`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}` },
  body: form,
  signal: AbortSignal.timeout(180_000),
});

const responseText = await response.text();
if (!response.ok) {
  console.error(`Fish Audio respondió ${response.status}:`);
  console.error(responseText);
  process.exit(1);
}

let created;
try {
  created = JSON.parse(responseText);
} catch {
  console.error("Fish Audio devolvió una respuesta que no es JSON:");
  console.error(responseText);
  process.exit(1);
}

const id = created._id || created.id || created.model_id;
if (!id) {
  console.error("No pude leer el ID de la voz en la respuesta:");
  console.error(created);
  process.exit(1);
}

console.log(`\nVoz creada: ${id}`);
console.log(`Estado: ${created.state || "?"} · Visibilidad: ${created.visibility || "?"}`);

let state = created.state;
let visibility = created.visibility;
let model = created;

for (let attempt = 0; attempt < 40 && state !== "trained" && state !== "failed"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const poll = await fetch(`${BASE}/model/${id}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!poll.ok) {
    console.log(`  consultando... ${poll.status}`);
    continue;
  }
  model = await poll.json();
  state = model.state || model.status;
  visibility = model.visibility || visibility;
  console.log(`  estado: ${state}`);
}

if (state === "failed") {
  console.error("\nLa clonación falló. Probá con un audio más limpio y largo (10 s a 2 min).");
  console.error(model);
  process.exit(1);
}

if (state !== "trained") {
  console.warn(`\nLa voz quedó en estado “${state}”. Revisala en https://fish.audio antes de usarla.`);
}

if (visibility && visibility !== "private") {
  console.warn(
    `\nATENCIÓN: la voz quedó con visibilidad “${visibility}”, no privada. Borrala con npm run delete-voice.`
  );
}

console.log("\nAgregá estas líneas a tu .env:");
console.log(`FISH_VOICE_ID=${id}`);
console.log("VOICE_PROVIDER=fish");
console.log("\nDespués regenerá los audios con la voz clonada:");
console.log("npm run generate");
console.log("\nPara borrar la voz cuando termine la muestra:");
console.log("npm run delete-voice");
