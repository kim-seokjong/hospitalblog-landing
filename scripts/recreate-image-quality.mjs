// One-off: recreate a reference image at gpt-image-2 high vs medium via /v1/images/edits.
// Sends the source image as reference + a detailed prompt for maximum fidelity.

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

const SOURCE_PATH = 'C:\\Users\\PC\\OneDrive\\바탕 화면\\mirror_gpt_image2.png';
const DESKTOP = 'C:\\Users\\PC\\OneDrive\\바탕 화면';

const PROMPT = `Recreate this exact mirror selfie photograph with maximum photorealism. A young Korean woman in her early 20s taking a selfie in front of a mirror with a dark blue iPhone in a clear case (triple-camera module visible). Hair pulled back into a loose low bun with a few wispy strands escaping at the front. She wears a plain crew-neck white short-sleeve t-shirt. Her face is in three-quarter view, looking down at the phone screen with a faint subtle smile, eyes calm. Skin shows authentic texture: visible post-acne marks, small freckles, mild redness clustered on the left cheek and around the chin. Absolutely no skin smoothing, no beauty filter, no airbrushing — looks unretouched and candid. Natural soft daylight enters from a window on the left side, warm wood paneling background. Slight natural shine on forehead and nose. Color palette: warm neutrals, natural skin tones, no oversaturation. Image must look like an unedited iPhone selfie shot in real life, vertical portrait, very high realism, no AI artifacts, no plastic look. Same composition, framing, lighting and mood as the reference photograph.`;

async function generate(quality) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const fileBuf = await fs.readFile(SOURCE_PATH);
  const fileBlob = new Blob([fileBuf], { type: 'image/png' });

  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('image', fileBlob, 'reference.png');
  form.append('prompt', PROMPT);
  form.append('n', '1');
  form.append('size', '1024x1536');
  form.append('quality', quality);

  const start = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
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

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Output: ${DESKTOP}`);
  console.log('');

  for (const quality of ['high', 'medium']) {
    process.stdout.write(`[${quality}] generating... `);
    try {
      const { buf, elapsed } = await generate(quality);
      const filename = `mirror-recreate-${quality}-${stamp}.png`;
      const fullPath = path.join(DESKTOP, filename);
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
