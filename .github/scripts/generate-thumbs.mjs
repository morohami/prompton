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
import http from 'node:http';

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

// Serve the checkout over HTTP instead of opening file:// URLs. Under file://
// a directory URL is a listing, so a prompton that frames another page of the
// site (prompton-app -> "../../") screenshotted as an empty frame; over HTTP
// "../../" resolves to the real app. It also matches how visitors load pages.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json'
};
function startServer() {
  const root = path.resolve('.');
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const abs = path.resolve(root, '.' + rel);
      if (abs !== root && !abs.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }
      const data = await fs.readFile(abs);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' }).end(data);
    } catch (e) {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

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
  // Diff the whole push (BEFORE_SHA = github.event.before), not just the last
  // commit: pushing several commits at once used to lose every file touched by
  // all but the newest one.
  const before = process.env.BEFORE_SHA || '';
  const ranges = [];
  if (/^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before)) ranges.push(before + ' HEAD');
  ranges.push('HEAD~1 HEAD');
  for (const range of ranges) {
    try {
      const diff = execSync('git diff --name-only ' + range, { encoding: 'utf8' });
      return changedIdsFromPaths(diff.split('\n').filter(Boolean));
    } catch (e) {
      console.warn('diff for "' + range + '" failed:', e.message);
    }
  }
  console.warn('no usable diff — falling back to all manifest ids');
  return await allManifestIds();
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

  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
    serviceWorkers: 'block'
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
    if (entry.format === 'md') {
      console.log(`skip ${id} — markdown prompton (no HTML to screenshot)`);
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
    const fileUrl = base + filePath.split('/').map(encodeURIComponent).join('/');
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
  server.close();
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Done — ok ${ok}, skipped ${skipped}, failed ${failed}.`);
  if (failed && !ok) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
