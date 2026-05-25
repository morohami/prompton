// Prompton — GitHub sync layer.
// Pure helpers + push/update/delete flows for manifest.json, htmls/<id>.html,
// thumbs/<id>.jpg, and p/<id>/index.html. Touches only the GitHub Contents
// API and the in-memory `seedPrompts`/`prompts` (which the host page owns).
//
// Loaded BEFORE index.html's inline script via a <script src> tag, so every
// function below becomes a regular global — no module imports needed.

// ─── GitHub sync (PAT-driven upload) ───
const SYNC_KEY = 'prompton_sync_v1';
function getSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // Default to the deploy origin if it looks like a github.io URL
  let repo = '';
  const m = location.host.match(/^([^.]+)\.github\.io$/);
  if (m) {
    const segs = location.pathname.split('/').filter(Boolean);
    if (segs[0]) repo = m[1] + '/' + segs[0];
  }
  return { repo: repo, branch: 'main', pat: '' };
}
function saveSyncConfig(cfg) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch (e) {}
  updateSyncBadge();
}
function updateSyncBadge() {
  const cfg = getSyncConfig();
  const a = document.querySelector('.nav-settings');
  if (a) a.classList.toggle('connected', !!(cfg.pat && cfg.repo));
}
// True when a PAT + repo are configured — i.e. this browser can write to the collection.
// In this single-tenant repo, holding the PAT means you own everything in it.
function isOwner() {
  const cfg = getSyncConfig();
  return !!(cfg.pat && cfg.repo);
}
function b64utf8(str) {
  // btoa fails on multi-byte chars; encode via TextEncoder + binary string
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToUtf8(b64) {
  // atob() returns a binary string (one char per byte). Decode those bytes as UTF-8.
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
async function ghFetch(path, opts) {
  const cfg = getSyncConfig();
  if (!cfg.repo || !cfg.pat) throw new Error('Configure repo and PAT in Settings first.');
  const url = 'https://api.github.com/repos/' + cfg.repo + path;
  const headers = Object.assign({
    'Authorization': 'Bearer ' + cfg.pat,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }, (opts && opts.headers) || {});
  // 'no-store' prevents the browser from serving a stale Contents-API GET
  // (which would return an out-of-date sha and cause 409 on the next PUT).
  const r = await fetch(url, Object.assign({ cache: 'no-store' }, opts, { headers }));
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('GitHub ' + r.status + ': ' + txt.slice(0, 200));
  }
  return r.json();
}
async function ghGetSha(path) {
  const cfg = getSyncConfig();
  try {
    const j = await ghFetch('/contents/' + encodeURIComponent(path) + '?ref=' + encodeURIComponent(cfg.branch));
    return j.sha;
  } catch (e) {
    if (String(e.message).indexOf('404') >= 0) return null;
    throw e;
  }
}
async function ghPutFile(path, content, message, sha) {
  const cfg = getSyncConfig();
  const body = {
    message: message,
    content: b64utf8(content),
    branch: cfg.branch
  };
  if (sha) body.sha = sha;
  return ghFetch('/contents/' + encodeURIComponent(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
async function ghDeleteFile(path, message, sha) {
  const cfg = getSyncConfig();
  return ghFetch('/contents/' + encodeURIComponent(path), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message, branch: cfg.branch, sha: sha })
  });
}
// Generate the static OG/Twitter-card page that lives at p/<id>/index.html.
// Crawlers (LINE/X/Discord/Slack) read the meta tags from the initial HTML;
// human visitors get a JS redirect to the SPA detail view.
function generateOGPageHtml(prompt) {
  const cfg = getSyncConfig();
  const baseUrl = cfg.repo
    ? 'https://' + cfg.repo.split('/')[0] + '.github.io/' + cfg.repo.split('/')[1] + '/'
    : '';
  const canonical = baseUrl + 'p/' + prompt.id + '/';
  const title = (prompt.title || 'Prompton') + ' — Prompton';
  const desc = (prompt.description || prompt.title || '').slice(0, 280);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Build the closing tag at runtime so the outer HTML parser doesn't see it
  // inside this script's template literal.
  const SC = '<' + '/script>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(prompt.title || 'Prompton')}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Prompton">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(prompt.title || 'Prompton')}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta http-equiv="refresh" content="0; url=../../#/p/${esc(prompt.id)}">
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px;max-width:640px;margin:0 auto;color:#555;line-height:1.6}h1{color:#1a1a1a;margin-bottom:8px}a{color:#e8893a;text-decoration:none}a:hover{text-decoration:underline}.byline{color:#999;font-size:13px;margin-bottom:24px}</style>
<script>
(function(){
  var base = location.pathname.split('/p/')[0] || '/';
  if (!base.endsWith('/')) base += '/';
  location.replace(base + '#/p/' + ${JSON.stringify(prompt.id)});
})();
${SC}
</head>
<body>
<h1>${esc(prompt.title || 'Prompton')}</h1>
<div class="byline">by ${esc(prompt.authorName || prompt.author || 'unknown')} · Prompton</div>
<p>${esc(desc)}</p>
<p><a href="../../#/p/${esc(prompt.id)}">Open in Prompton →</a></p>
</body>
</html>
`;
}

async function pushOGPageToGitHub(prompt) {
  const path = 'p/' + prompt.id + '/index.html';
  const html = generateOGPageHtml(prompt);
  const sha = await ghGetSha(path);
  await ghPutFile(path, html, 'Prompton: refresh OG card for ' + prompt.id, sha);
}

async function deleteOGPageFromGitHub(prompt) {
  const path = 'p/' + prompt.id + '/index.html';
  const sha = await ghGetSha(path);
  if (sha) await ghDeleteFile(path, 'Prompton: remove OG card for ' + prompt.id, sha);
}

async function deletePromptFromGitHub(prompt) {
  // 1. Delete the HTML file (and any per-version HTMLs) if they exist
  const htmlPaths = ['htmls/' + prompt.id + '.html'];
  if (prompt.versions && prompt.versions.length) {
    prompt.versions.forEach((v, i) => {
      const vNum = v.v != null ? v.v : (i + 1);
      htmlPaths.push('htmls/' + prompt.id + '_v' + vNum + '.html');
    });
  }
  for (const path of htmlPaths) {
    const sha = await ghGetSha(path);
    if (sha) await ghDeleteFile(path, 'Prompton: delete ' + path, sha);
  }
  // Also delete the OG card page if present.
  try { await deleteOGPageFromGitHub(prompt); } catch (e) { /* best effort */ }
  // Delete the JPG thumbnail too, if one was generated.
  try {
    const thumbPath = 'thumbs/' + prompt.id + '.jpg';
    const tSha = await ghGetSha(thumbPath);
    if (tSha) await ghDeleteFile(thumbPath, 'Prompton: delete ' + thumbPath, tSha);
  } catch (e) { /* best effort */ }
  // 2. Remove from manifest.json and re-PUT
  const cfg = getSyncConfig();
  const manRaw = await ghFetch('/contents/manifest.json?ref=' + encodeURIComponent(cfg.branch));
  const manText = b64ToUtf8(manRaw.content);
  let manifest;
  try { manifest = JSON.parse(manText); }
  catch (e) { manifest = []; }
  const next = manifest.filter(p => p.id !== prompt.id);
  await ghPutFile('manifest.json', JSON.stringify(next, null, 2), 'Prompton: remove ' + prompt.id, manRaw.sha);
  // 3. Sync in-memory seedPrompts so subsequent renders match
  if (typeof seedPrompts !== 'undefined' && Array.isArray(seedPrompts)) {
    const sIdx = seedPrompts.findIndex(p => p.id === prompt.id);
    if (sIdx >= 0) seedPrompts.splice(sIdx, 1);
  }
}
// Update only the manifest entry for an existing prompt — HTML files are untouched.
async function updatePromptMetadataOnGitHub(prompt) {
  const cfg = getSyncConfig();
  const manRaw = await ghFetch('/contents/manifest.json?ref=' + encodeURIComponent(cfg.branch));
  const manText = b64ToUtf8(manRaw.content);
  let manifest;
  try { manifest = JSON.parse(manText); }
  catch (e) { manifest = []; }
  const meta = JSON.parse(JSON.stringify(prompt));
  delete meta.html;
  if (meta.versions) meta.versions = meta.versions.map(v => { const c = {...v}; delete c.html; return c; });
  const idx = manifest.findIndex(p => p.id === prompt.id);
  if (idx >= 0) manifest[idx] = meta;
  else manifest.unshift(meta);
  await ghPutFile('manifest.json', JSON.stringify(manifest, null, 2), 'Prompton: edit metadata for ' + prompt.id, manRaw.sha);
  if (typeof seedPrompts !== 'undefined' && Array.isArray(seedPrompts)) {
    const sIdx = seedPrompts.findIndex(p => p.id === prompt.id);
    if (sIdx >= 0) seedPrompts[sIdx] = JSON.parse(JSON.stringify(prompt));
    else seedPrompts.unshift(JSON.parse(JSON.stringify(prompt)));
  }
  // Refresh OG card so social previews show the updated title/description.
  try { await pushOGPageToGitHub(prompt); } catch (e) { console.warn('OG page refresh failed:', e); }
}

// Owner-only: persist a single increment of a prompt's download counter to
// the manifest. Reads the live manifest (so concurrent edits don't clobber),
// bumps just the `downloads` field for this prompt, PUTs it back. Best-effort
// — failures don't undo the local increment.
async function bumpDownloadCountOnGitHub(prompt) {
  const cfg = getSyncConfig();
  const manRaw = await ghFetch('/contents/manifest.json?ref=' + encodeURIComponent(cfg.branch));
  const manText = b64ToUtf8(manRaw.content);
  let manifest;
  try { manifest = JSON.parse(manText); }
  catch (e) { return; }
  const idx = manifest.findIndex(p => p.id === prompt.id);
  if (idx < 0) return;
  manifest[idx].downloads = (manifest[idx].downloads || 0) + 1;
  await ghPutFile('manifest.json', JSON.stringify(manifest, null, 2), 'Prompton: +1 download for ' + prompt.id, manRaw.sha);
  if (typeof seedPrompts !== 'undefined' && Array.isArray(seedPrompts)) {
    const s = seedPrompts.find(x => x.id === prompt.id);
    if (s) s.downloads = manifest[idx].downloads;
  }
}

// Conservative HTML cleanup — safe on arbitrary prompt output.
//   - Strip UTF-8 BOM
//   - Normalize CRLF → LF
//   - Collapse runs of 3+ blank lines down to a single blank line
//   - Strip HTML comments that aren't conditional comments (<!--[if ...]>)
// Does NOT minify, collapse meaningful whitespace, or touch script/style content.
function cleanupHtml(raw) {
  if (typeof raw !== 'string' || !raw) return raw || '';
  let s = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/<!--(?!\s*\[if)[\s\S]*?-->/g, '');
  s = s.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n+$/, '\n');
  return s;
}

// Convert a Blob to a base64 string (no data: prefix) for the GitHub API.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error || new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

// ─── Bulk commit via Git Data API ───
// Combines an arbitrary number of file writes into ONE commit so the history
// stays sane when the user bulk-uploads. Each entry:
//   { path: 'htmls/foo.html', content: <string|Blob>, encoding?: 'base64' }
// For Blob inputs we always send base64; for strings we send utf-8 by default.
async function ghBulkCommit(files, message) {
  const cfg = getSyncConfig();
  if (!cfg.repo || !cfg.pat) throw new Error('Configure repo and PAT in Settings first.');
  if (!files || !files.length) throw new Error('ghBulkCommit: no files');
  // 1. Look up the current branch tip + its tree
  const branch = cfg.branch || 'main';
  const ref = await ghFetch('/git/ref/heads/' + encodeURIComponent(branch));
  const parentSha = ref.object.sha;
  const parentCommit = await ghFetch('/git/commits/' + encodeURIComponent(parentSha));
  const baseTreeSha = parentCommit.tree.sha;
  // 2. Upload each file as a blob → collect SHA + path
  const treeEntries = [];
  for (const f of files) {
    let content, encoding;
    if (f.content instanceof Blob) {
      content = await blobToBase64(f.content);
      encoding = 'base64';
    } else if (typeof f.content === 'string') {
      content = f.content;
      encoding = f.encoding || 'utf-8';
    } else {
      throw new Error('ghBulkCommit: file content must be a string or Blob');
    }
    const blob = await ghFetch('/git/blobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content, encoding: encoding })
    });
    treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  // 3. Build a new tree on top of the current one + commit it
  const newTree = await ghFetch('/git/trees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries })
  });
  const newCommit = await ghFetch('/git/commits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message, tree: newTree.sha, parents: [parentSha] })
  });
  // 4. Move the branch ref forward
  await ghFetch('/git/refs/heads/' + encodeURIComponent(branch), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha })
  });
  return newCommit;
}

// ─── Owner handle rename ───
// Validate a proposed new handle. Returns null if OK or an error string.
// Rules: lowercase alphanumeric + . _ -, 3–20 chars, no collision with another
// existing handle in profiles.json (the current owner's own handle is fine).
function validateNewHandle(newHandle) {
  if (!/^[a-z0-9_.-]{3,20}$/.test(newHandle)) {
    return 'Username must be 3–20 lowercase chars (a-z, 0-9, . _ -).';
  }
  const oldHandle = ownerHandle();
  if (newHandle === oldHandle) return null;
  if (typeof profiles !== 'undefined' && profiles && profiles[newHandle]) {
    return 'That username is already taken.';
  }
  return null;
}

// Atomic rewrite: move the owner profile under a new key, rewrite every
// prompt.author === oldHandle, push profiles.json + manifest.json in ONE
// commit (when PAT is configured), then update localStorage so future sessions
// keep the new handle. When no PAT is set, the rename is local-only.
async function renameOwnerHandle(oldHandle, newHandle) {
  if (oldHandle === newHandle) return;
  if (typeof profiles === 'undefined' || typeof prompts === 'undefined') {
    throw new Error('renameOwnerHandle: profiles/prompts not initialized');
  }

  // 1. Local rewrite (always runs — covers both PAT and PAT-less paths).
  if (profiles[oldHandle]) {
    profiles[newHandle] = Object.assign({}, profiles[oldHandle], { handle: newHandle });
    delete profiles[oldHandle];
  }
  for (const otherKey of Object.keys(profiles)) {
    const pr = profiles[otherKey];
    if (Array.isArray(pr.followers)) pr.followers = pr.followers.map(h => h === oldHandle ? newHandle : h);
    if (Array.isArray(pr.following)) pr.following = pr.following.map(h => h === oldHandle ? newHandle : h);
  }
  prompts.forEach(p => {
    if (p.author === oldHandle) p.author = newHandle;
  });
  setOwnerHandleLocal(newHandle);
  saveProfiles();
  saveData(prompts);

  // 2. If owner (PAT configured), persist to the repo. Bundle profiles.json +
  //    manifest.json into one commit so the rename is atomic in history.
  if (!isOwner()) return;
  const cfg = getSyncConfig();
  const branch = cfg.branch || 'main';
  // Pull the live versions to avoid clobbering any drift since last load.
  const profilesRaw = await ghFetch('/contents/profiles.json?ref=' + encodeURIComponent(branch));
  const manifestRaw = await ghFetch('/contents/manifest.json?ref=' + encodeURIComponent(branch));
  let liveProfiles, liveManifest;
  try { liveProfiles = JSON.parse(b64ToUtf8(profilesRaw.content)) || {}; }
  catch (e) { liveProfiles = {}; }
  try { liveManifest = JSON.parse(b64ToUtf8(manifestRaw.content)) || []; }
  catch (e) { liveManifest = []; }
  if (liveProfiles[oldHandle]) {
    liveProfiles[newHandle] = Object.assign({}, liveProfiles[oldHandle], { handle: newHandle });
    delete liveProfiles[oldHandle];
  }
  for (const otherKey of Object.keys(liveProfiles)) {
    const pr = liveProfiles[otherKey];
    if (Array.isArray(pr.followers)) pr.followers = pr.followers.map(h => h === oldHandle ? newHandle : h);
    if (Array.isArray(pr.following)) pr.following = pr.following.map(h => h === oldHandle ? newHandle : h);
  }
  liveManifest.forEach(p => { if (p && p.author === oldHandle) p.author = newHandle; });
  await ghBulkCommit([
    { path: 'profiles.json', content: JSON.stringify(liveProfiles, null, 2) },
    { path: 'manifest.json', content: JSON.stringify(liveManifest, null, 2) }
  ], 'Prompton: rename @' + oldHandle + ' → @' + newHandle);
}

async function pushPromptToGitHub(prompt) {
  // 1. Write the HTML file
  const htmlPath = 'htmls/' + prompt.id + '.html';
  const htmlSha = await ghGetSha(htmlPath);  // null for create, existing sha for update
  const cleanedHtml = cleanupHtml(prompt.html);
  prompt.html = cleanedHtml; // also persist the cleaned version in-memory
  await ghPutFile(htmlPath, cleanedHtml, 'Prompton: add ' + prompt.id + ' html', htmlSha);
  // 1b. The Thumbnails workflow takes care of `thumbs/<id>.jpg` and stamps
  //     `thumb` + `thumbVer` into the manifest on the next push to htmls/**.
  // 2. Update manifest.json — read fresh then append/replace this prompt
  const cfg = getSyncConfig();
  const manRaw = await ghFetch('/contents/manifest.json?ref=' + encodeURIComponent(cfg.branch));
  const manText = b64ToUtf8(manRaw.content);
  let manifest;
  try { manifest = JSON.parse(manText); }
  catch (e) { manifest = []; }
  // Strip html field from the prompt before storing in manifest
  const meta = JSON.parse(JSON.stringify(prompt));
  delete meta.html;
  if (meta.versions) meta.versions = meta.versions.map(v => { const c = {...v}; delete c.html; return c; });
  const existingIdx = manifest.findIndex(p => p.id === prompt.id);
  if (existingIdx >= 0) manifest[existingIdx] = meta;
  else manifest.unshift(meta);
  await ghPutFile('manifest.json', JSON.stringify(manifest, null, 2), 'Prompton: update manifest for ' + prompt.id, manRaw.sha);
  // Keep the in-memory seedPrompts in sync so reloads see the same view
  if (typeof seedPrompts !== 'undefined' && Array.isArray(seedPrompts)) {
    const sIdx = seedPrompts.findIndex(p => p.id === prompt.id);
    if (sIdx >= 0) seedPrompts[sIdx] = JSON.parse(JSON.stringify(prompt));
    else seedPrompts.unshift(JSON.parse(JSON.stringify(prompt)));
  }
  // Push the OG card page so the prompt has a proper unfurl on LINE/X/Discord.
  try { await pushOGPageToGitHub(prompt); } catch (e) { console.warn('OG page push failed:', e); }
}
