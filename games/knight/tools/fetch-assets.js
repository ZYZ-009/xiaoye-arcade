// Fetch public domain (CC0) game art from Kenney.nl
// Usage: node tools/fetch-assets.js
const fs = require('fs');
const path = require('path');

const ASSETS = [
  { slug: 'pixel-platformer', name: 'kenney_pixel-platformer' },
  { slug: 'retro-fantasy-kit', name: 'kenney_retro-fantasy-kit' },
  { slug: 'medieval-rts', name: 'kenney_medieval-rts' },
];

const OUT_DIR = path.join(__dirname, '..', 'assets', 'raw');

async function findZipUrl(slug) {
  const r = await fetch(`https://kenney.nl/assets/${slug}`, {
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await r.text();
  // Kenney download links: https://kenney.nl/media/pages/assets/<slug>/<hash>/kenney_<slug>.zip
  const re = /(?:href|data-url)=['"]((?:https?:\/\/kenney\.nl)?\/media\/pages\/assets\/[^'"]*\.zip)['"]/g;
  let m, found = null;
  while ((m = re.exec(html)) !== null) {
    found = m[1];
    break;
  }
  if (found && !/^https?:/.test(found)) found = 'https://kenney.nl' + found;
  return found;
}

async function download(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`Downloaded ${path.basename(dest)} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const a of ASSETS) {
    try {
      const url = await findZipUrl(a.slug);
      if (!url) { console.log(`No zip URL for ${a.slug}`); continue; }
      console.log(`Found ${a.slug}: ${url}`);
      await download(url, path.join(OUT_DIR, `${a.name}.zip`));
    } catch (e) {
      console.log(`FAIL ${a.slug}: ${e.message}`);
    }
  }
})();
