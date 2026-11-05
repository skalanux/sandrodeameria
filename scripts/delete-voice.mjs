import { loadEnv } from "../lib/env.js";

loadEnv();

const API_KEY = process.env.FISH_API_KEY || "";
const BASE = process.env.FISH_API_BASE || "https://api.fish.audio";
const id = process.argv[2] || process.env.FISH_VOICE_ID || "";

if (!API_KEY) {
  console.error("Falta FISH_API_KEY en .env.");
  process.exit(1);
}
if (!id) {
  console.error("Falta el ID de la voz. Pasalo como argumento o poné FISH_VOICE_ID en .env.");
  console.error("Uso: npm run delete-voice -- <voice_id>");
  process.exit(1);
}

const response = await fetch(`${BASE}/model/${id}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${API_KEY}` },
  signal: AbortSignal.timeout(30_000),
});

const text = await response.text().catch(() => "");

if (!response.ok) {
  console.error(`Fish Audio respondió ${response.status}: ${text || "(sin cuerpo)"}`);
  process.exit(1);
}

console.log(`Voz ${id} borrada de Fish Audio.`);
console.log("Quitá FISH_VOICE_ID de .env y poné VOICE_PROVIDER=demo si querés volver a la voz de prueba.");
