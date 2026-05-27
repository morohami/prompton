// Headless-Chrome thumbnail generator for Prompton.
// Triggered by .github/workflows/thumbnails.yml on push to htmls/**.
// Replaces the client-side html2canvas path, which broke under Brave Shields
// and produced lower-quality snapshots. Real Chrome runs the prompt's scripts,
// fonts, and CSS — the screenshot matches what users actually see.
//
// Supports both prompt layouts:
//   - flat   (legacy): htmls/<id>.html — single self-contained file
//   - folder (new):    htmls/<id>/index.html + sibling CSS/JS/assets
//
// Either way the thumbnail lands at thumbs/<id>.jpg. The script reads
// manifest.json to find each prompt's layout and screenshots the right URL.

import { chromium } from 'playwright';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HTMLS_DIR = 'htmls';
const THUMBS_DIR = 'thumbs';
const MANIFEST = 'manifest.json';
// Capture + output at 640 — cards display at ~480px, so 640 gives ~1.3x on
// retina without bloating the repo. q=72 JPEG → typically 40-80 KB per file
// vs ~600 KB at 1280/82.
const SIZE = 640;
const QUALITY = 72;
const NETWORK_IDLE_TIMEOUT = 20000;
const SETTLE_MS = 2000;

// Extract a set of prompt IDs that need re-thumbnailing from a list of
// changed file paths. Both flat (htmls/<id>.html) and folder
// (htmls/<id>/anyfile) edits map to the same id; versioned files
// (htmls/<id>_v2.html or htmls/<id>_v2/...) are ignored — versions share
// the top-level thumb.
function changedIdsFromPaths(paths) {
  const ids = new Set();
  const isVersioned = (id) => /_v\d+$/.test(id);
  for (const p of paths) {
    // Flat top-level: htmls/<id>.html
    const flatM = p.match(/^htmls\/([^/]+)\.html$/);
    if (flatM) {
      if (!isVersioned(flatM[1])) ids.add(flatM[1]);
      continue;
    }
    // Folder: htmls/<id>/<anything>
    const folderM = p.match(/^htmls\/([^/]+)\/.+/);
    if (folderM && !isVersioned(folderM[1])) {
      ids.add(folderM[1]);
    }
  }
  return Array.from(ids);
}

async function allManifestIds() {
  const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
  return manifest.map(p => p.id);
}

async function pickTargetIds() {
  // workflow_dispatch (manual) → regenerate everything in the manifest.
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    return await allManifestIds();
  }
  try {
    const diff = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' });
    const paths = diff.split('\n').filter(Boolean);
    return changedIdsFromPaths(paths);
  } catch (e) {
    console.warn('diff lookup failed — falling back to all manifest ids:', e.message);
    return await allManifestIds();
  }
}

// Resolve the path to a prompt's main HTML file on disk, given its
// manifest entry. Folder-layout prompts live at htmls/<id>/index.html;
// flat at htmls/<id>.html.
function htmlPathFor(entry) {
  if (entry.layout === 'folder') return `${HTMLS_DIR}/${entry.id}/index.html`;
  return `${HTMLS_DIR}/${entry.id}.html`;
}

async function main() {
  const targetIds = await pickTargetIds();
  if (!targetIds.length) {
    console.log('No prompt files changed — nothing to do.');
    return;
  }
  console.log(`Targets (${targetIds.length}):`, targetIds);

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
  for (const id of targetIds) {
    const entry = byId.get(id);
    if (!entry) {
      console.log(`skip ${id} — not in manifest`);
      skipped++;
      continue;
    }
    const filePath = htmlPathFor(entry);
    try { await fs.access(filePath); }
    catch (e) {
      console.log(`skip ${id} — ${filePath} missing on disk`);
      skipped++;
      continue;
    }
    const fileUrl = 'file://' + path.resolve(filePath);
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
      console.log(`ok   ${id} (${entry.layout || 'flat'})`);
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
