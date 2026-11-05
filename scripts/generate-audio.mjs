import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { providerInfo, synthesize } from "../lib/voice.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const phrases = JSON.parse(await readFile(path.join(root, "phrases.json"), "utf8"));
const outDir = path.join(root, "assets", "audio");

await mkdir(outDir, { recursive: true });

const info = providerInfo();
console.log(`Proveedor: ${info.provider}${info.cloned ? " (voz clonada)" : " (voz de prueba)"}`);
if (info.provider === "fish" && !info.configured) {
  console.error("Fish Audio está sin configurar.");
  console.error("Agregá FISH_API_KEY y FISH_VOICE_ID a .env, o usá npm run generate:demo.");
  process.exit(1);
}
if (info.provider === "demo") {
  console.log("Usando Edge TTS: los audios NO son la voz clonada del amigo.");
}

let failed = 0;

for (const phrase of phrases) {
  process.stdout.write(`  ${phrase.id} ${phrase.label}... `);
  try {
    const { data } = await synthesize(phrase.text);
    const out = path.join(outDir, `${phrase.id}.mp3`);
    await writeFile(out, data);
    console.log(`ok (${Math.round(data.length / 1024)} KB)`);
  } catch (error) {
    failed += 1;
    console.log("ERROR");
    console.error(`    ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (failed) {
  console.error(`\n${failed} frase(s) fallaron. Revisá el error y volvé a intentar.`);
  process.exit(1);
}

console.log(`\nListo: ${phrases.length} audios en assets/audio/`);
