// One-off script: compare gpt-image-2 high vs medium quality for the same prompt.
// Saves two PNGs to user's Desktop and prints sizes/timing.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function loadEnvLocal() {
  const envText = await fs.readFile(path.join(projectRoot, '.env.local'), 'utf8');
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function generate(prompt, quality) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1024',
      quality,
    }),
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[${quality}] HTTP ${res.status}: ${text}`);
  }

  const data = await res.json();
  const item = data.data?.[0];
  if (!item) throw new Error(`[${quality}] empty response`);

  let buf;
  if (item.b64_json) {
    buf = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const imgRes = await fetch(item.url);
    buf = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error(`[${quality}] no image data`);
  }

  return { buf, elapsed };
}

async function main() {
  await loadEnvLocal();

  const prompt = '보톡스 시술 전후 2주 및 4개월 시점 비교 예시';

  // Resolve Windows desktop path. OneDrive Korean desktop folder.
  const desktop = 'C:\\Users\\PC\\OneDrive\\바탕 화면';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  console.log(`Prompt: "${prompt}"`);
  console.log(`Desktop: ${desktop}`);
  console.log('');

  for (const quality of ['high', 'medium']) {
    process.stdout.write(`[${quality}] generating... `);
    try {
      const { buf, elapsed } = await generate(prompt, quality);
      const filename = `botox-quality-${quality}-${stamp}.png`;
      const fullPath = path.join(desktop, filename);
      await fs.writeFile(fullPath, buf);
      const sizeKB = (buf.length / 1024).toFixed(1);
      console.log(`OK  ${sizeKB} KB, ${elapsed}s -> ${filename}`);
    } catch (err) {
      console.log(`FAIL`);
      console.error(err.message);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
