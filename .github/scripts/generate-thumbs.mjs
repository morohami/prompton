// Headless-Chrome thumbnail generator for Prompton.
// Triggered by .github/workflows/thumbnails.yml on push to htmls/**.
// Replaces the client-side html2canvas path, which broke under Brave Shields
// and produced lower-quality snapshots. Real Chrome runs the prompt's scripts,
// fonts, and CSS — the screenshot matches what users actually see.

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HTMLS_DIR = 'htmls';
const THUMBS_DIR = 'thumbs';
const MANIFEST = 'manifest.json';
const SIZE = 1280;
const QUALITY = 82;
const NETWORK_IDLE_TIMEOUT = 20000;
const SETTLE_MS = 2000;

// Only top-level <id>.html — versioned <id>_v<n>.html share the same prompt
// and use the latest version's thumb.
const isVersioned = (f) => /_v\d+\.html$/.test(f);
const isTopLevelHtml = (f) => /^htmls\/[^/]+\.html$/.test(f) && !isVersioned(f);

async function pickTargets() {
  // workflow_dispatch (manual) → regenerate every top-level html.
  // push (auto) → only files changed in the head commit.
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    const all = await fs.readdir(HTMLS_DIR);
    return all
      .filter(f => f.endsWith('.html') && !isVersioned(f))
      .map(f => `${HTMLS_DIR}/${f}`);
  }
  try {
    const diff = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' });
    return diff.split('\n').filter(isTopLevelHtml);
  } catch (e) {
    console.warn('diff lookup failed — falling back to all files:', e.message);
    const all = await fs.readdir(HTMLS_DIR);
    return all
      .filter(f => f.endsWith('.html') && !isVersioned(f))
      .map(f => `${HTMLS_DIR}/${f}`);
  }
}

async function main() {
  const targets = await pickTargets();
  if (!targets.length) {
    console.log('No top-level HTML files changed — nothing to do.');
    return;
  }
  console.log(`Targets (${targets.length}):`, targets);

  await fs.mkdir(THUMBS_DIR, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  const byId = new Map(manifest.map(p => [p.id, p]));

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  let ok = 0, skipped = 0, failed = 0;
  for (const file of targets) {
    const id = path.basename(file, '.html');
    const entry = byId.get(id);
    if (!entry) {
      console.log(`skip ${id} — not in manifest`);
      skipped++;
      continue;
    }
    const fileUrl = 'file://' + path.resolve(file);
    try {
      await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: NETWORK_IDLE_TIMEOUT });
      await page.waitForTimeout(SETTLE_MS);
      const outPath = `${THUMBS_DIR}/${id}.jpg`;
      await page.screenshot({
        path: outPath,
        type: 'jpeg',
        quality: QUALITY,
        clip: { x: 0, y: 0, width: SIZE, height: SIZE }
      });
      entry.thumb = outPath;
      entry.thumbVer = Date.now();
      ok++;
      console.log(`ok   ${id}`);
    } catch (e) {
      failed++;
      console.warn(`fail ${id}: ${e.message}`);
    }
  }

  await browser.close();
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Done — ok ${ok}, skipped ${skipped}, failed ${failed}.`);
  if (failed && !ok) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
