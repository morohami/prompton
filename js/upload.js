// Prompton — Share / upload flow + bulk-upload mode.
// Loaded after render.js / github.js so the helpers it relies on exist by the
// time these handlers fire. Depends on (defined elsewhere): prompts,
// seedPrompts, profiles, saveData, escapeHtml/escapeAttr, toast, cleanupHtml,
// normalizeTag/normalizeTagList, getSyncConfig, ghFetch, ghBulkCommit,
// b64ToUtf8, generateOGPageHtml, isOwner, renderDetail,
// renderGallery.

// ─── Upload form ───
const fileDrop = document.getElementById('fileDrop');
const htmlFile = document.getElementById('htmlFile');
let uploadedHtml = '';

// Helper: extract <title> and <meta name="description"> from HTML
function extractHtmlMeta(html) {
  const m = {};
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) m.title = titleMatch[1].trim();
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) m.description = descMatch[1].trim();
  return m;
}

// Helper: split a pasted prompt by [SYSTEM]/[USER]/[CONTEXT] block headers.
// If no headers found, whole text becomes userPrompt.
function parsePromptBlocks(text) {
  const result = { systemPrompt: '', userPrompt: '', context: '' };
  text = (text || '').trim();
  if (!text) return result;
  const pattern = /\[(SYSTEM|USER|CONTEXT)\]/gi;
  const headers = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    headers.push({ kind: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length });
  }
  if (!headers.length) {
    result.userPrompt = text;
    return result;
  }
  headers.sort((a, b) => a.start - b.start);
  // Discard any text before the first header (rare, but defensive)
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const next = headers[i + 1];
    const body = text.slice(h.end, next ? next.start : text.length).trim();
    const key = h.kind === 'SYSTEM' ? 'systemPrompt' : h.kind === 'USER' ? 'userPrompt' : 'context';
    result[key] = body;
  }
  return result;
}

function applyUploadedHtml(html, displayName, sizeBytes) {
  uploadedHtml = html;
  const size = sizeBytes != null ? sizeBytes : new Blob([html]).size;
  fileDrop.classList.add('has-file');
  fileDrop.classList.remove('dragover');
  document.getElementById('dropTitle').textContent = '✓ ' + (displayName || 'pasted.html');
  document.getElementById('dropHint').innerHTML = (size/1024).toFixed(1) + ' KB · ready to publish · <span style="opacity:.7">click to replace</span>';

  // Auto-fill title from <title> tag if user hasn't typed one yet
  const meta = extractHtmlMeta(html);
  const titleInput = document.getElementById('titleInput');
  if (meta.title && titleInput && !titleInput.value.trim()) {
    titleInput.value = meta.title;
  }
  const descInput = document.querySelector('[name="description"]');
  if (meta.description && descInput && !descInput.value.trim()) {
    descInput.value = meta.description;
    const adv = document.querySelector('.upload-advanced');
    if (adv) adv.open = true;
  }

  // Show live preview
  const preview = document.getElementById('htmlPreview');
  const iframe = document.getElementById('previewIframe');
  const sizeEl = document.getElementById('previewSize');
  if (preview && iframe) {
    iframe.srcdoc = html;
    if (sizeEl) sizeEl.textContent = (size/1024).toFixed(1) + ' KB';
    preview.style.display = '';
  }
}

function handleHtmlFile(f) {
  if (!f) return;
  const looksLikeHtml = /\.html?$/i.test(f.name) || (f.type && /html/i.test(f.type));
  if (!looksLikeHtml) { toast('That doesn\'t look like an HTML file.'); return; }
  const reader = new FileReader();
  reader.onload = () => applyUploadedHtml(reader.result, f.name, f.size);
  reader.onerror = () => toast('Could not read that file.');
  reader.readAsText(f);
}

// Multi-file entry point: if exactly one file is dropped and we're not
// already in bulk mode, use the single-prompt flow. Otherwise enter (or
// stay in) bulk mode and append each file to the queue.
function handleHtmlFiles(fileList) {
  const files = Array.from(fileList || []).filter(f =>
    /\.html?$/i.test(f.name) || (f.type && /html/i.test(f.type))
  );
  if (!files.length) return;
  if (files.length === 1 && bulkQueue.length === 0) {
    handleHtmlFile(files[0]);
    return;
  }
  // Bulk path
  enterBulkMode();
  Promise.all(files.map(f => f.text().then(text => ({
    filename: f.name,
    title: parseBulkTitle(text, f.name),
    html: text
  })))).then(entries => {
    bulkQueue.push(...entries);
    renderBulkQueue();
  });
}

// ─── Bulk upload state + UI (lives inside the Share form) ───
const bulkQueue = [];
function parseBulkTitle(html, filename) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1].trim()) return m[1].trim();
  return filename.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ').trim() || filename;
}
function enterBulkMode() {
  document.body.classList.add('bulk-mode');
  // Hide single-prompt fields
  const ids = ['promptBlock', 'titleBlock', 'uploadAdvanced', 'htmlPreview'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  document.getElementById('bulkQueue').style.display = '';
  document.getElementById('dropTitle').textContent = 'Bulk mode — drop more .html files to add';
  document.getElementById('dropHint').innerHTML = 'click to browse · drag &amp; drop · titles edit below';
  fileDrop.classList.add('has-file');
}
function exitBulkMode() {
  document.body.classList.remove('bulk-mode');
  ['promptBlock', 'titleBlock', 'uploadAdvanced'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = '';
  });
  document.getElementById('bulkQueue').style.display = 'none';
  document.getElementById('bulkQueue').innerHTML = '';
  document.getElementById('dropTitle').textContent = 'Drop .html here';
  document.getElementById('dropHint').innerHTML = 'click to browse<span class="sep">·</span>drag &amp; drop<span class="sep">·</span>or paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>';
  fileDrop.classList.remove('has-file');
  updateBulkSubmit();
}
function renderBulkQueue() {
  const queueEl = document.getElementById('bulkQueue');
  queueEl.innerHTML = bulkQueue.map((q, i) =>
    `<div class="bulk-row" data-i="${i}">
       <span class="fname" title="${escapeAttr(q.filename)}">${escapeHtml(q.filename)}</span>
       <input class="title" type="text" value="${escapeAttr(q.title)}" placeholder="Title…">
       <button type="button" class="x" title="Remove">×</button>
     </div>`
  ).join('');
  queueEl.querySelectorAll('.bulk-row').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('input.title').addEventListener('input', (e) => { bulkQueue[i].title = e.target.value; });
    row.querySelector('.x').addEventListener('click', () => {
      bulkQueue.splice(i, 1);
      if (!bulkQueue.length) { exitBulkMode(); return; }
      renderBulkQueue();
    });
  });
  updateBulkSubmit();
}
function updateBulkSubmit() {
  const btn = document.querySelector('#uploadForm button[type="submit"]');
  if (!btn) return;
  if (bulkQueue.length) {
    btn.textContent = `Publish ${bulkQueue.length} prompt${bulkQueue.length === 1 ? '' : 's'} →`;
  } else {
    btn.textContent = 'Publish prompt →';
  }
}

// Note: fileDrop is a <label> wrapping the file input, so clicking it
// natively opens the OS file picker. Do NOT add a manual click handler —
// that would open the picker twice.
htmlFile.addEventListener('change', (e) => { handleHtmlFiles(e.target.files); e.target.value = ''; });

// Drag & drop on the drop zone
;['dragenter', 'dragover'].forEach(evt => {
  fileDrop.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    fileDrop.classList.add('dragover');
  });
});
;['dragleave', 'dragend'].forEach(evt => {
  fileDrop.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    // Only remove highlight when leaving the dropzone itself, not its children
    if (evt === 'dragleave' && fileDrop.contains(e.relatedTarget)) return;
    fileDrop.classList.remove('dragover');
  });
});
fileDrop.addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation();
  fileDrop.classList.remove('dragover');
  const dt = e.dataTransfer;
  if (!dt) return;
  if (dt.files && dt.files.length) { handleHtmlFiles(dt.files); return; }
  // Some apps drop text/html or text/plain instead of a file
  const html = dt.getData('text/html') || dt.getData('text/plain');
  if (html && /<\s*html|<\s*!DOCTYPE/i.test(html)) {
    applyUploadedHtml(html, 'dropped.html');
  } else {
    toast('Drop an HTML file (or paste raw HTML with Ctrl+V).');
  }
});

// Window-level dragover suppression so accidental drops outside the zone
// don't navigate the browser away from the page.
window.addEventListener('dragover', (e) => {
  const view = document.getElementById('view-upload');
  if (view && view.classList.contains('active')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  const view = document.getElementById('view-upload');
  if (view && view.classList.contains('active') && !fileDrop.contains(e.target)) {
    e.preventDefault();
    // If file(s) dropped anywhere on the upload page, route to the dropzone
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleHtmlFiles(e.dataTransfer.files);
    }
  }
});

// Ctrl+V paste — accept HTML text or file from clipboard
document.addEventListener('paste', (e) => {
  const view = document.getElementById('view-upload');
  if (!view || !view.classList.contains('active')) return;
  // Don't hijack paste into the prompt textarea or title field
  const target = e.target;
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
  const cd = e.clipboardData;
  if (!cd) return;
  // 1) File in clipboard?
  if (cd.files && cd.files.length) {
    const f = cd.files[0];
    if (/\.html?$/i.test(f.name) || /html/i.test(f.type || '')) {
      e.preventDefault();
      handleHtmlFile(f);
      return;
    }
  }
  // 2) HTML text?
  const html = cd.getData('text/html') || cd.getData('text/plain');
  if (html && /<\s*html|<\s*!DOCTYPE/i.test(html)) {
    e.preventDefault();
    applyUploadedHtml(html, 'pasted.html');
  }
});

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  // Bulk path takes over when 2+ files are queued — single-prompt UI is hidden.
  if (bulkQueue.length) { return submitBulkUpload(e.target); }
  if (!uploadedHtml) { toast('Drop an HTML file first.'); return; }
  const fd = new FormData(e.target);

  // Title required
  const title = (fd.get('title') || '').trim();
  if (!title) { toast('Give it a title.'); document.getElementById('titleInput').focus(); return; }

  // Parse the pasted prompt — split [SYSTEM] / [USER] / [CONTEXT] blocks, or treat as userPrompt
  const blocks = parsePromptBlocks(fd.get('quickPrompt') || '');
  if (!blocks.userPrompt && !blocks.systemPrompt && !blocks.context) {
    toast('Paste the prompt that generated this output.');
    document.getElementById('quickPromptField').focus();
    return;
  }

  // Parse variables: "KEY | Label | default | hint" per line
  const varsRaw = (fd.get('variables') || '').trim();
  const variables = varsRaw ? varsRaw.split('\n').map(line => {
    const parts = line.split('|').map(s => s.trim());
    if (!parts[0]) return null;
    return {
      key: parts[0].replace(/[^A-Z0-9_]/gi, '_').toUpperCase(),
      label: parts[1] || parts[0],
      default: parts[2] || '',
      hint: parts[3] || ''
    };
  }).filter(Boolean) : [];

  const tags = normalizeTagList(window._uploadTagPicker ? window._uploadTagPicker.getTags() : []);

  // If this upload started from a Fork, pick up the stashed parent id and
  // bump the parent's fork count.
  let parentId = null;
  try { parentId = sessionStorage.getItem('prompton_fork_parent') || null; } catch (e) {}
  if (parentId) {
    const parent = prompts.find(x => x.id === parentId);
    if (parent) parent.forks++;
  }

  const newPrompt = {
    id: 'p' + Date.now(),
    title: title,
    description: (fd.get('description') || '').trim(),
    systemPrompt: blocks.systemPrompt,
    userPrompt: blocks.userPrompt,
    context: blocks.context,
    model: fd.get('model') || 'Claude Opus 4.7',
    license: fd.get('license') || 'CC0 — Public domain',
    tags: tags,
    tag: tags[0] || 'other',
    author: ownerHandle(), authorName: (function(){ const h = ownerHandle(); return (typeof profiles !== 'undefined' && profiles[h]) ? profiles[h].name : 'You'; })(),
    date: new Date().toISOString().slice(0,10),
    downloads: 0, forks: 0, parentId: parentId,
    usage: [],
    variables: variables,
    html: uploadedHtml
  };
  prompts.unshift(newPrompt);
  saveData(prompts);

  // If GitHub sync is configured, publish to repo (uploads otherwise live only in localStorage)
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const cfg = getSyncConfig();
  if (cfg.repo && cfg.pat) {
    const origLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '↑ Pushing to GitHub…'; }
    try {
      await pushPromptToGitHub(newPrompt);
      toast('Published to GitHub · "' + newPrompt.title + '"');
    } catch (err) {
      console.error(err);
      toast('Saved locally — GitHub push failed: ' + err.message);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
    }
  } else {
    toast('Saved locally · "' + newPrompt.title + '" (configure GitHub in ⚙ Settings to publish)');
  }

  e.target.reset();
  try { sessionStorage.removeItem('prompton_fork_parent'); } catch (e) {}
  if (window._uploadTagPicker) window._uploadTagPicker.setTags([]);
  uploadedHtml = '';
  fileDrop.classList.remove('has-file');
  document.getElementById('dropTitle').textContent = 'Drop .html here';
  document.getElementById('dropHint').textContent = 'or click to browse';
  document.getElementById('htmlPreview').style.display = 'none';
  document.getElementById('undeclaredWarning').style.display = 'none';
  const adv = document.querySelector('.upload-advanced');
  if (adv) adv.open = false;
  renderDetail(newPrompt.id);
});

// Bulk submit — Tree API single commit for all htmls + OG pages + manifest,
// then a second commit for thumbs once they finish rendering.
async function submitBulkUpload(formEl) {
  if (!isOwner()) {
    toast('Configure GitHub in ⚙ Settings before publishing.');
    return;
  }
  const submitBtn = formEl.querySelector('button[type="submit"]');
  const origLabel = submitBtn ? submitBtn.textContent : '';
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Pushing bulk commit…'; }

  const today = new Date().toISOString().slice(0, 10);
  const me_h = ownerHandle();
  const youName = (typeof profiles !== 'undefined' && profiles[me_h] ? profiles[me_h].name : 'You');
  const newPrompts = bulkQueue.map((q, i) => ({
    id: 'p' + (Date.now() + i),
    title: q.title,
    description: '',
    systemPrompt: '', userPrompt: '(bulk-uploaded — paste original prompt via Edit)', context: '',
    model: 'Claude Opus 4.7',
    license: 'CC0 — Public domain',
    tags: [], tag: 'other',
    author: ownerHandle(), authorName: youName,
    date: today,
    downloads: 0, forks: 0, parentId: null,
    usage: [], variables: [],
    html: cleanupHtml(q.html)
  }));

  let manSha = null, manifest = [];
  try {
    const cfg = getSyncConfig();
    const manRaw = await ghFetch('/contents/manifest.json?ref=' + encodeURIComponent(cfg.branch));
    manSha = manRaw.sha;
    manifest = JSON.parse(b64ToUtf8(manRaw.content)) || [];
  } catch (err) {
    toast('Failed to read manifest: ' + err.message);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
    return;
  }
  const metaList = newPrompts.map(p => { const m = JSON.parse(JSON.stringify(p)); delete m.html; return m; });
  const nextManifest = [...metaList, ...manifest];

  const files = [];
  for (const p of newPrompts) {
    files.push({ path: 'htmls/' + p.id + '.html', content: p.html });
    files.push({ path: 'p/' + p.id + '/index.html', content: generateOGPageHtml(p) });
  }
  files.push({ path: 'manifest.json', content: JSON.stringify(nextManifest, null, 2) });

  try {
    await ghBulkCommit(files, 'Prompton: bulk upload ' + newPrompts.length + ' prompts');
  } catch (err) {
    console.error('Bulk commit failed:', err);
    toast('Bulk commit failed: ' + err.message);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
    return;
  }

  for (const p of newPrompts) {
    prompts.unshift(p);
    seedPrompts.unshift(JSON.parse(JSON.stringify(p)));
  }
  saveData(prompts);
  bulkQueue.length = 0;
  exitBulkMode();
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Publish prompt →'; }
  // The Thumbnails workflow will pick up htmls/* changes from the bulk commit
  // and patch thumb fields into the manifest within ~30-60s.
  toast(`✓ Published ${newPrompts.length} prompts · thumbnails generating on GitHub.`);
  renderGallery();
}
