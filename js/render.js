// Prompton — view rendering layer (gallery, detail, profile, version + metadata editors).
// Loaded as a regular <script src> before the inline bootstrap, so every function below
// becomes a global. Depends on (defined elsewhere): prompts, profiles, tagConfig,
// escapeHtml/escapeAttr/formatNum/formatDate/safeFilename/toast/normalizeTag/normalizeTagList,
// mountAlbumThumbs, mountTagPicker, getProfile, saveData, saveProfiles, setRoute, showView,
// renderCompare, renderTagChips, isOwner, pushPromptToGitHub, updatePromptMetadataOnGitHub,
// deletePromptFromGitHub, ghGetSha, ghPutFile, cleanupHtml.

// Cache-bust thumbnail URLs. Without ?v=, browsers + the SW can hold onto an
// older blob even after the file is regenerated on GitHub. `thumbVer` is a
// monotonic timestamp set by the Thumbnails workflow when it screenshots a
// new build.
function thumbUrl(p) {
  if (!p || !p.thumb) return '';
  return p.thumbVer ? `${p.thumb}?v=${p.thumbVer}` : p.thumb;
}

// ─── Multi-file prompt support ─────────────────────────────────────────
// A prompt's HTML can live in one of two layouts:
//
//   - "flat"   (default, legacy): htmls/<id>.html holds a single self-
//              contained HTML file with inline <style> + <script>. We
//              pre-fetch the content in fetchSeed() and inject via
//              iframe.srcdoc.
//
//   - "folder" (multi-file): htmls/<id>/index.html plus sibling style.css /
//              app.js / lib/* / assets/* live alongside. We do not pre-
//              fetch; iframe.src points directly at the index.html so
//              subresources load through normal relative URLs and the
//              browser caches each file individually.
//
// Past versions follow the same split: htmls/<id>_v<n>.html for flat,
// htmls/<id>_v<n>/index.html for folder.

// Resolve the path to a prompt's preview HTML. Pass viewing=N to point at
// version <id>_v<N> instead of the latest top-level file.
function promptHtmlPath(p, viewing) {
  if (!p) return '';
  const suffix = viewing ? '_v' + viewing : '';
  if (p.layout === 'folder') return `htmls/${p.id}${suffix}/index.html`;
  return `htmls/${p.id}${suffix}.html`;
}

// Build the iframe attribute string ('src="..."' or 'srcdoc="..."') for
// previewing a prompt. The caller drops this into a template literal:
//   `<iframe class="thumb" ${promptPreviewAttrs(p)} sandbox="" ...></iframe>`
// Folder prompts use src= so the multi-file page loads normally; flat
// prompts use srcdoc= with the already-fetched p.html.
function promptPreviewAttrs(p, viewing) {
  if (!p) return ' srcdoc=""';
  if (p.layout === 'folder') return ' src="' + escapeAttr(promptHtmlPath(p, viewing)) + '"';
  // viewing a past version of a flat prompt: prefer its versions[] entry's html
  let html = p.html || '';
  if (viewing && p.versions) {
    const v = p.versions.find(x => x.v === viewing);
    if (v && v.html) html = v.html;
  }
  return ' srcdoc="' + escapeAttr(html) + '"';
}

function titleWithEmphasis(title) {
  const words = (title || '').split(' ');
  if (words.length < 2) return escapeHtml(title);
  const last = words.pop();
  return escapeHtml(words.join(' ')) + ' <em>' + escapeHtml(last) + '</em>';
}

// ─── Drafts menu (masthead) — backed by local drafts ───
// Replaced the Instagram-style stories bar. The 下書き button in the masthead
// shows a count badge; clicking it opens a dropdown with "+ 新規" and every
// saved draft. The function keeps its historical name because every draft
// mutation site (save / publish / delete / autosave-flush) calls it.
function renderStoriesBar() {
  const btn = document.getElementById('draftsMenuBtn');
  const menu = document.getElementById('draftsMenu');
  if (!btn || !menu) return;
  const count = drafts.length;
  btn.textContent = t('nav.drafts') + (count ? ' (' + count + ')' : '');
  const sorted = drafts.slice().sort((a, b) =>
    (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  const items = sorted.map(d => {
    const label = ((d.title || d.body || '').replace(/\s+/g, ' ').trim() || t('drafts.untitled')).slice(0, 40);
    const multi = (d.css && d.css.trim()) || (d.js && d.js.trim());
    return `<button type="button" class="drafts-menu-item" data-draft-id="${escapeAttr(d.id)}">
      <span class="dm-title">${escapeHtml(label)}</span>
      ${multi ? '<span class="dm-multi">3-file</span>' : ''}
    </button>`;
  }).join('');
  menu.innerHTML =
    `<button type="button" class="drafts-menu-item dm-new" data-draft-new="1">＋ ${escapeHtml(t('drafts.newLabel'))}</button>` + items;
  menu.querySelectorAll('[data-draft-new]').forEach(b => b.addEventListener('click', () => {
    closeDraftsMenu();
    openDraftEditorModal(null);
  }));
  menu.querySelectorAll('[data-draft-id]').forEach(b =>
    b.addEventListener('click', () => {
      closeDraftsMenu();
      openDraftEditorModal(b.dataset.draftId);
    }));
}
function closeDraftsMenu() {
  const menu = document.getElementById('draftsMenu');
  if (menu) { menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); }
}
// Toggle + outside-click close. Wired once at load (this file runs before
// the inline bootstrap, so the masthead markup already exists).
(() => {
  const btn = document.getElementById('draftsMenuBtn');
  const menu = document.getElementById('draftsMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    menu.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) renderStoriesBar(); // refresh list right before showing
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) closeDraftsMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDraftsMenu(); });
})();

// Draft modal — Instagram-style single-step publish. Title + body, then
// "Post" goes straight to GitHub. Supports three quick-fill paths:
//   - Claude conversation paste → largest code-fence is the body
//   - GitHub URL paste (raw / blob / gist) → fetched directly
//   - Manual: just type or paste HTML
function openDraftEditorModal(draftId) {
  const existing = document.getElementById('draftModal');
  if (existing) existing.remove();
  const draft = draftId
    ? drafts.find(x => x.id === draftId)
    : { id: newDraftId(), title: '', body: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (!draft) return;
  const isNew = !draftId;

  const overlay = document.createElement('div');
  overlay.className = 'profile-modal-overlay';
  overlay.id = 'draftModal';
  overlay.innerHTML = `
    <div class="profile-modal-content">
      <h2>${escapeHtml(isNew ? t('drafts.newTitle') : t('drafts.editTitle'))}</h2>
      <div class="field">
        <input type="text" id="draftTitle" value="${escapeAttr(draft.title || '')}" placeholder="${escapeAttr(t('drafts.titlePlaceholder'))}" maxlength="120" autocomplete="off">
      </div>
      <div class="draft-tabs" role="tablist">
        <button type="button" class="draft-tab active" data-tab="body" role="tab">HTML</button>
        <button type="button" class="draft-tab ${draft.css ? 'has-content' : ''}" data-tab="css" role="tab">CSS</button>
        <button type="button" class="draft-tab ${draft.js ? 'has-content' : ''}" data-tab="js" role="tab">JS</button>
      </div>
      <div class="field">
        <textarea id="draftBody" rows="10" placeholder="${escapeAttr(t('drafts.bodyPlaceholder'))}">${escapeHtml(draft.body || '')}</textarea>
        <textarea id="draftCss" rows="10" style="display:none" placeholder="${escapeAttr(t('drafts.cssPlaceholder'))}">${escapeHtml(draft.css || '')}</textarea>
        <textarea id="draftJs" rows="10" style="display:none" placeholder="${escapeAttr(t('drafts.jsPlaceholder'))}">${escapeHtml(draft.js || '')}</textarea>
      </div>
      <div class="draft-toolbar">
        <button type="button" class="btn-text" id="draftPasteBtn">${escapeHtml(t('drafts.pasteBtn'))}</button>
        <button type="button" class="btn-text" id="draftGitHubBtn">${escapeHtml(t('drafts.githubBtn'))}</button>
        <span class="draft-autosave-status" id="draftAutosaveStatus" aria-live="polite"></span>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn primary" id="draftPostBtn">${escapeHtml(t('drafts.post'))}</button>
        <button type="button" class="btn-cancel" id="draftSaveBtn">${escapeHtml(t('drafts.saveOnly'))}</button>
        ${isNew ? '' : `<button type="button" class="btn-cancel" id="draftDeleteBtn">${escapeHtml(t('drafts.delete'))}</button>`}
        <button type="button" class="btn-cancel" id="draftCancelBtn">${escapeHtml(t('drafts.cancel'))}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('draftCancelBtn').addEventListener('click', () => overlay.remove());

  // ─── HTML / CSS / JS tab switching ──────────────────────────────────────
  // One textarea per tab; only the active one is visible. A tab whose
  // textarea has content gets .has-content (small dot) so you can tell a
  // multi-file draft at a glance without clicking through.
  const tabAreas = {
    body: document.getElementById('draftBody'),
    css: document.getElementById('draftCss'),
    js: document.getElementById('draftJs')
  };
  const readTabs = () => ({
    body: tabAreas.body.value,
    css: tabAreas.css.value,
    js: tabAreas.js.value
  });
  overlay.querySelectorAll('.draft-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.draft-tab').forEach(x => x.classList.remove('active'));
      tab.classList.add('active');
      Object.entries(tabAreas).forEach(([key, area]) => {
        area.style.display = key === tab.dataset.tab ? '' : 'none';
      });
      tabAreas[tab.dataset.tab].focus();
    });
  });
  const refreshTabDots = () => {
    overlay.querySelectorAll('.draft-tab').forEach(tab => {
      const area = tabAreas[tab.dataset.tab];
      tab.classList.toggle('has-content', !!(area && area.value.trim()));
    });
  };
  Object.values(tabAreas).forEach(area => area.addEventListener('input', refreshTabDots));

  // ─── Auto-save (2-second debounce) ─────────────────────────────────────
  // Persists this draft to drafts[] + localStorage 2s after the last keystroke.
  // - Skips empty drafts (no title and no body) so we don't litter localStorage
  //   with blank entries when the user opens "+ 新規" and closes immediately.
  // - The explicit "下書き保存" button still works; it just performs the same
  //   save synchronously and closes the modal.
  // - When the user publishes (投稿), publishDraftDirect filters this draft
  //   out of drafts[], so the auto-saved entry is cleaned up automatically.
  const statusEl = document.getElementById('draftAutosaveStatus');
  function setAutosaveStatus(key) {
    if (!statusEl) return;
    statusEl.textContent = key ? t(key) : '';
  }
  let autosaveTimer = null;
  function scheduleAutosave() {
    const titleNow = document.getElementById('draftTitle').value.trim();
    const t3 = readTabs();
    const hasAny = titleNow || t3.body.trim() || t3.css.trim() || t3.js.trim();
    if (!hasAny) { setAutosaveStatus(''); return; }
    setAutosaveStatus('drafts.autosaveDirty');
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      draft.title = titleNow;
      draft.body = t3.body;
      draft.css = t3.css;
      draft.js = t3.js;
      draft.updatedAt = new Date().toISOString();
      const idx = drafts.findIndex(x => x.id === draft.id);
      if (idx >= 0) drafts[idx] = draft;
      else drafts.unshift(draft);
      try { saveDrafts(); } catch (e) { console.warn('draft autosave failed:', e); }
      renderStoriesBar();
      setAutosaveStatus('drafts.autosaveSaved');
    }, 2000);
  }
  document.getElementById('draftTitle').addEventListener('input', scheduleAutosave);
  Object.values(tabAreas).forEach(area => area.addEventListener('input', scheduleAutosave));
  // If the modal closes (overlay click, cancel button, Esc), flush a final save
  // so we never lose the last few keystrokes.
  const flushAndCleanup = () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      const titleNow = document.getElementById('draftTitle')?.value.trim();
      const t3 = readTabs();
      if (titleNow || t3.body.trim() || t3.css.trim() || t3.js.trim()) {
        draft.title = titleNow || '';
        draft.body = t3.body;
        draft.css = t3.css;
        draft.js = t3.js;
        draft.updatedAt = new Date().toISOString();
        const idx = drafts.findIndex(x => x.id === draft.id);
        if (idx >= 0) drafts[idx] = draft;
        else drafts.unshift(draft);
        try { saveDrafts(); } catch (e) {}
        renderStoriesBar();
      }
    }
  };
  // Hook into MutationObserver — when overlay is removed from DOM, flush.
  const removalObserver = new MutationObserver(() => {
    if (!document.body.contains(overlay)) { flushAndCleanup(); removalObserver.disconnect(); }
  });
  removalObserver.observe(document.body, { childList: true });

  // Claude paste — read clipboard, route fenced blocks by language into the
  // three tabs (```css → CSS, ```js → JS, longest html/untagged → HTML).
  document.getElementById('draftPasteBtn').addEventListener('click', async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); }
    catch (e) { toast(t('drafts.clipboardDenied')); return; }
    if (!text || !text.trim()) { toast(t('drafts.clipboardEmpty')); return; }
    const { body, css, js, title } = extractFromClaudePaste(text);
    const titleInput = document.getElementById('draftTitle');
    if (!titleInput.value && title) titleInput.value = title;
    if (body) tabAreas.body.value = body;
    if (css) tabAreas.css.value = css;
    if (js) tabAreas.js.value = js;
    refreshTabDots();
    scheduleAutosave();
    toast(t('drafts.pasted'));
  });

  // GitHub URL — prompt for URL, fetch HTML content into body.
  document.getElementById('draftGitHubBtn').addEventListener('click', async () => {
    const url = prompt(t('drafts.githubPrompt'));
    if (!url) return;
    try {
      toast(t('drafts.fetching'));
      const html = await fetchFromGitHubUrl(url);
      document.getElementById('draftBody').value = html;
      // Guess a title from <title> if no title yet.
      const titleInput = document.getElementById('draftTitle');
      if (!titleInput.value) {
        const tm = html.match(/<title>([^<]+)<\/title>/i);
        if (tm) titleInput.value = tm[1].trim();
      }
      toast(t('drafts.fetched'));
    } catch (err) {
      console.warn('GitHub fetch failed:', err);
      toast(t('drafts.fetchFailed') + ' ' + err.message);
    }
  });

  // Save-only — keep as draft, don't publish.
  document.getElementById('draftSaveBtn').addEventListener('click', () => {
    const t3 = readTabs();
    draft.title = document.getElementById('draftTitle').value.trim();
    draft.body = t3.body;
    draft.css = t3.css;
    draft.js = t3.js;
    draft.updatedAt = new Date().toISOString();
    const idx = drafts.findIndex(x => x.id === draft.id);
    if (idx >= 0) drafts[idx] = draft;
    else drafts.unshift(draft);
    saveDrafts();
    overlay.remove();
    renderStoriesBar();
    toast(t('drafts.saved'));
  });

  // Post — one-shot publish to GitHub. Removes the draft on success since
  // it's now a real prompt.
  document.getElementById('draftPostBtn').addEventListener('click', async () => {
    const title = document.getElementById('draftTitle').value.trim();
    const t3 = readTabs();
    const btn = document.getElementById('draftPostBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = t('drafts.posting');
    try {
      await publishDraftDirect(title, t3.body, t3.css, t3.js);
      // Drop this draft — it's published now.
      drafts = drafts.filter(x => x.id !== draft.id);
      saveDrafts();
      overlay.remove();
      renderStoriesBar();
      renderGallery();
      toast(t('drafts.published'));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = originalText;
      console.warn('Publish failed:', err);
      if (err.message === 'not-owner') toast(t('drafts.needOwner'));
      else if (err.message === 'empty-body') toast(t('drafts.bodyRequired'));
      else toast(t('drafts.publishFailed') + ' ' + err.message);
    }
  });

  const delBtn = document.getElementById('draftDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (!confirm(t('drafts.confirmDelete'))) return;
    drafts = drafts.filter(x => x.id !== draft.id);
    saveDrafts();
    overlay.remove();
    renderStoriesBar();
  });

  setTimeout(() => { const i = document.getElementById('draftTitle'); if (i) i.focus(); }, 50);
}

// ─── Playlists view (user-defined collections) ───
function renderPlaylists() {
  setRoute('playlists');
  const el = document.getElementById('playlistsContent');
  if (!el) return;
  const me_h = ownerHandle();
  const tiles = playlists.map(pl => {
    const color = pl.color || '#8C1515';
    const count = (pl.promptIds || []).length;
    return `<a class="playlist-tile" data-pl-id="${escapeAttr(pl.id)}" style="background:${escapeAttr(color)}">
      <div class="pl-name">${escapeHtml(pl.name)}</div>
      <div class="pl-count">${count} ${count === 1 ? 'prompton' : 'promptons'}</div>
    </a>`;
  }).join('');
  el.innerHTML = `
    <h1><em>${escapeHtml(t('playlists.title'))}</em></h1>
    <p class="lede">${escapeHtml(t('playlists.lede'))}</p>
    <div class="playlist-grid">
      ${tiles || `<div class="empty-state">${escapeHtml(t('playlists.empty'))}</div>`}
      <button type="button" class="playlist-tile new-pl" id="newPlaylistBtn">
        <div class="pl-name">+ ${escapeHtml(t('playlists.new'))}</div>
      </button>
    </div>
  `;
  el.querySelectorAll('[data-pl-id]').forEach(a =>
    a.addEventListener('click', () => renderPlaylistDetail(a.dataset.plId)));
  const newBtn = document.getElementById('newPlaylistBtn');
  if (newBtn) newBtn.addEventListener('click', openCreatePlaylistModal);
  showView('playlists');
}

function renderPlaylistDetail(plId) {
  const pl = playlists.find(x => x.id === plId);
  if (!pl) { renderPlaylists(); return; }
  setRoute('playlists/' + plId);
  const el = document.getElementById('playlistsContent');
  if (!el) return;
  const inPlaylist = (pl.promptIds || [])
    .map(id => prompts.find(p => p.id === id))
    .filter(Boolean);
  const color = pl.color || '#8C1515';
  const me_h = ownerHandle();
  const canEdit = pl.owner === me_h;
  el.innerHTML = `
    <div class="playlist-header" style="border-left:4px solid ${escapeAttr(color)}">
      <h1>${escapeHtml(pl.name)}</h1>
      <div class="lede">${inPlaylist.length} ${inPlaylist.length === 1 ? 'prompton' : 'promptons'} · ${escapeHtml(t('playlists.by'))} @${escapeHtml(pl.owner)}</div>
      ${canEdit ? `<button type="button" class="btn secondary" id="deletePlaylistBtn">${escapeHtml(t('playlists.delete'))}</button>` : ''}
    </div>
    <div class="grid" id="playlistGrid"></div>
  `;
  const grid = el.querySelector('#playlistGrid');
  if (!inPlaylist.length) {
    grid.innerHTML = `<div class="empty-state">${escapeHtml(t('playlists.emptyTiles'))}</div>`;
  } else {
    inPlaylist.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card';
      const thumbInner = p.thumb
        ? `<img class="thumb-img" loading="lazy" decoding="async" src="${escapeAttr(thumbUrl(p))}" alt="">`
        : `<iframe class="thumb"${promptPreviewAttrs(p)} sandbox="" scrolling="no" tabindex="-1"></iframe>`;
      card.innerHTML = `
        <div class="thumb-wrap">${thumbInner}</div>
        <div class="meta-top"><span>${formatDate(p.date)}</span><span>${escapeHtml(p.model)}</span></div>
        <h3>${escapeHtml(p.title)}</h3>
        <div class="by">by <span data-author="${p.author}">${escapeHtml(p.authorName)}</span></div>
      `;
      card.addEventListener('click', () => renderDetail(p.id));
      grid.appendChild(card);
    });
  }
  if (canEdit) {
    const delBtn = document.getElementById('deletePlaylistBtn');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm(t('playlists.confirmDelete', { name: pl.name }))) return;
      playlists = playlists.filter(x => x.id !== plId);
      savePlaylists();
      if (isOwner()) {
        try { await pushPlaylistsToGitHub(); } catch (e) { console.warn('Playlist sync failed:', e); }
      }
      renderPlaylists();
    });
  }
  showView('playlists');
}

function openCreatePlaylistModal() {
  const existing = document.getElementById('playlistModal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'profile-modal-overlay';
  overlay.id = 'playlistModal';
  const colorOptions = PLAYLIST_COLORS.map((c, i) =>
    `<button type="button" class="pl-color-swatch ${i === 0 ? 'active' : ''}" data-color="${c}" style="background:${c}"></button>`).join('');
  overlay.innerHTML = `
    <div class="profile-modal-content">
      <h2>${escapeHtml(t('playlists.newTitle'))}</h2>
      <div class="field">
        <label>${escapeHtml(t('playlists.nameLabel'))}</label>
        <input type="text" id="newPlName" placeholder="${escapeAttr(t('playlists.namePlaceholder'))}" maxlength="60">
      </div>
      <div class="field">
        <label>${escapeHtml(t('playlists.colorLabel'))}</label>
        <div class="pl-color-row">${colorOptions}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn primary" id="createPlBtn">${escapeHtml(t('playlists.create'))}</button>
        <button type="button" class="btn-cancel" id="cancelPlBtn">${escapeHtml(t('playlists.cancel'))}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  let chosenColor = PLAYLIST_COLORS[0];
  overlay.querySelectorAll('.pl-color-swatch').forEach(b => b.addEventListener('click', () => {
    overlay.querySelectorAll('.pl-color-swatch').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    chosenColor = b.dataset.color;
  }));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('cancelPlBtn').addEventListener('click', () => overlay.remove());
  document.getElementById('createPlBtn').addEventListener('click', async () => {
    const name = document.getElementById('newPlName').value.trim();
    if (!name) { toast(t('playlists.nameRequired')); return; }
    const pl = {
      id: newPlaylistId(),
      name: name,
      color: chosenColor,
      owner: ownerHandle(),
      promptIds: [],
      created: new Date().toISOString().slice(0, 10)
    };
    playlists.unshift(pl);
    savePlaylists();
    overlay.remove();
    if (isOwner()) {
      try { await pushPlaylistsToGitHub(); } catch (e) { console.warn('Playlist sync failed:', e); }
    }
    renderPlaylistDetail(pl.id);
  });
  setTimeout(() => { const i = document.getElementById('newPlName'); if (i) i.focus(); }, 50);
}

// "Add to playlist" menu rendered into a container on the detail view.
function renderAddToPlaylistMenu(container, promptId) {
  const me_h = ownerHandle();
  const mine = playlists.filter(pl => pl.owner === me_h);
  if (!mine.length) {
    container.innerHTML = `<div class="pl-menu-empty">${escapeHtml(t('playlists.noneYet'))} <button type="button" class="btn-text" id="plMenuNew">${escapeHtml(t('playlists.newInline'))}</button></div>`;
    const nb = document.getElementById('plMenuNew');
    if (nb) nb.addEventListener('click', () => { container.parentElement.remove(); openCreatePlaylistModal(); });
    return;
  }
  container.innerHTML = mine.map(pl => {
    const isIn = (pl.promptIds || []).indexOf(promptId) >= 0;
    return `<button type="button" class="pl-menu-item ${isIn ? 'on' : ''}" data-pl-id="${escapeAttr(pl.id)}">
      <span class="pl-dot" style="background:${escapeAttr(pl.color || '#8C1515')}"></span>
      <span class="pl-menu-name">${escapeHtml(pl.name)}</span>
      <span class="pl-menu-check">${isIn ? '✓' : '+'}</span>
    </button>`;
  }).join('');
  container.querySelectorAll('[data-pl-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pl = playlists.find(x => x.id === btn.dataset.plId);
      if (!pl) return;
      pl.promptIds = pl.promptIds || [];
      const idx = pl.promptIds.indexOf(promptId);
      if (idx >= 0) pl.promptIds.splice(idx, 1);
      else pl.promptIds.push(promptId);
      savePlaylists();
      btn.classList.toggle('on');
      btn.querySelector('.pl-menu-check').textContent = idx >= 0 ? '+' : '✓';
      if (isOwner()) {
        try { await pushPlaylistsToGitHub(); } catch (e) { console.warn('Playlist sync failed:', e); }
      }
    });
  });
}

// ─── Rankings view (top prompts by downloads / forks) ───
function renderRankings(metric) {
  metric = metric || 'downloads';   // 'downloads' or 'forks'
  setRoute('rankings');
  const el = document.getElementById('rankingsContent');
  if (!el) return;
  const all = prompts.slice();
  const sorted = all.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  const top = sorted.slice(0, 30);
  const totalDl = all.reduce((s, p) => s + (p.downloads || 0), 0);
  const totalFk = all.reduce((s, p) => s + (p.forks || 0), 0);
  const labelOther = metric === 'downloads' ? 'forks' : 'downloads';

  el.innerHTML = `
    <div class="rankings-wrap">
      <h1><em>${escapeHtml(t('rankings.title'))}</em></h1>
      <p class="lede">Top promptons by ${metric}. Updated live from the manifest.</p>
      <div class="ranking-totals">
        <div><div class="num">${formatNum(totalDl)}</div><div class="lbl">Total downloads</div></div>
        <div><div class="num">${formatNum(totalFk)}</div><div class="lbl">Total forks</div></div>
        <div><div class="num">${all.length}</div><div class="lbl">Promptons</div></div>
      </div>
      <div class="ranking-toggle">
        <button type="button" class="${metric === 'downloads' ? 'active' : ''}" data-rank="downloads">${escapeHtml(t('rankings.downloadsBtn'))}</button>
        <button type="button" class="${metric === 'forks' ? 'active' : ''}" data-rank="forks">${escapeHtml(t('rankings.forksBtn'))}</button>
      </div>
      <ol class="ranking-list">
        ${top.map((p, i) => {
          const primary = p[metric] || 0;
          const other = p[labelOther] || 0;
          const thumb = p.thumb
            ? `<img class="rank-thumb" loading="lazy" decoding="async" src="${escapeAttr(thumbUrl(p))}" alt="">`
            : '<div class="rank-thumb empty"></div>';
          return `<li class="rank-row" data-go="${p.id}">
            <span class="rank-pos">${i + 1}</span>
            ${thumb}
            <div class="rank-info">
              <div class="rank-title">${escapeHtml(p.title)}</div>
              <div class="rank-by">by <span class="author-link" data-author="${p.author}">${escapeHtml(p.authorName)}</span>${p.date ? ' · ' + formatDate(p.date) : ''}</div>
            </div>
            <div class="rank-metric">
              <div class="num">${formatNum(primary)}</div>
              <div class="lbl">${metric}</div>
            </div>
            <div class="rank-metric secondary">
              <div class="num">${formatNum(other)}</div>
              <div class="lbl">${labelOther}</div>
            </div>
          </li>`;
        }).join('') || '<li class="empty-state">No promptons yet.</li>'}
      </ol>
    </div>
  `;
  el.querySelectorAll('.rank-row[data-go]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('author-link') || e.target.dataset.author) return;
      renderDetail(row.dataset.go);
    });
  });
  el.querySelectorAll('[data-author]').forEach(a => {
    a.addEventListener('click', (e) => { e.stopPropagation(); renderProfile(a.dataset.author); });
  });
  el.querySelectorAll('[data-rank]').forEach(b => {
    b.addEventListener('click', () => renderRankings(b.dataset.rank));
  });
  showView('rankings');
}

function renderGallery() {
  setRoute('');
  showView('gallery');
  renderTagChips();
  renderStoriesBar();
  // All prompts are published once they're in the manifest — no local-only drafts.
  const publicPrompts = prompts.slice();

  // ── Spotify-style home (only when not filtering/searching) ──
  const magazineEl = document.getElementById('magazineSection');
  const archiveEl = document.getElementById('archiveHeader');
  const showHome = currentFilter === 'all' && !currentSearch.trim();

  if (showHome && publicPrompts.length > 0) {
    const picks = getNewspaperPicks(publicPrompts);
    const lead = picks.lead;
    const trending = [...picks.major, ...picks.briefs];
    const leadExcerpt = lead.editorsNote || lead.description || '';

    // "Made for you" = prompts you authored (yours, including remixes)
    const me_h = ownerHandle();
    const yourForks = prompts.filter(p => p.author === me_h);
    // "By <top author>" = prompts from author with most published
    const authorCounts = {};
    publicPrompts.forEach(p => { authorCounts[p.author] = (authorCounts[p.author] || 0) + 1; });
    const topAuthor = Object.entries(authorCounts).sort((a,b) => b[1]-a[1])[0];
    const featuredAuthor = topAuthor ? topAuthor[0] : null;
    const featuredAuthorPrompts = featuredAuthor ? publicPrompts.filter(p => p.author === featuredAuthor).slice(0, 8) : [];
    const featuredAuthorName = featuredAuthor ? (getProfile(featuredAuthor).name) : '';

    const greeting = (() => {
      const h = new Date().getHours();
      if (h < 5) return 'Good night';
      if (h < 12) return 'Good morning';
      if (h < 18) return 'Good afternoon';
      return 'Good evening';
    })();
    const youName = getProfile(me_h).name;

    // Cache HTML strings keyed by prompt id so the IntersectionObserver below
    // can build iframes without hauling them through the DOM as data-attrs.
    // Folder-layout prompts don't need a cache entry (mountAlbumThumbs reads
    // p.layout straight off the prompts[] array and points iframe.src
    // at htmls/<id>/index.html instead of using srcdoc).
    window._albumHtmlCache = window._albumHtmlCache || {};
    publicPrompts.forEach(p => { window._albumHtmlCache[p.id] = p.html || ''; });

    const albumCardHtml = (p) =>
      '<div class="album-card" data-news-go="' + p.id + '">' +
        '<div class="album-thumb">' +
          (p.thumb
            ? '<img class="thumb-img" loading="lazy" decoding="async" src="' + escapeAttr(thumbUrl(p)) + '" alt="">'
            : '<div class="thumb-mount" data-thumb-id="' + p.id + '"></div>') +
          '<button type="button" class="album-fullscreen" data-fullscreen-id="' + p.id + '" title="View this HTML fullscreen" aria-label="View fullscreen">⛶</button>' +
          '<button type="button" class="fav-btn ' + (isFavorited(p.id) ? 'on' : '') + '" data-fav-id="' + p.id + '" aria-label="Favorite" title="Favorite">' + (isFavorited(p.id) ? '♥' : '♡') + '</button>' +
          '<div class="album-play" title="Open prompton">▶</div>' +
        '</div>' +
        '<h3 class="album-title">' + escapeHtml(p.title) + '</h3>' +
        '<div class="album-by">' + escapeHtml(p.authorName) + '</div>' +
        '<div class="album-stats">' + formatNum(p.downloads) + ' · ⑂ ' + p.forks + '</div>' +
      '</div>';

    // "Recently added" — by date desc, the freshest 30 entries in the collection
    const recentlyAdded = publicPrompts.slice().sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    ).slice(0, 30);

    magazineEl.innerHTML =
      '<div class="greeting">' + greeting + ', ' + escapeHtml(youName === 'You' ? 'reader' : youName.split(' ')[0]) + '.</div>' +
      '<div class="greeting-sub">' +
        (FEATURES.spotlight ? 'Daily edition · Issue ' + getIssueNumber() : 'Your collection · ' + publicPrompts.length + ' prompton' + (publicPrompts.length === 1 ? '' : 's')) +
      '</div>' +

      (FEATURES.spotlight && lead ? (
        '<div class="spotlight">' +
          '<div class="spotlight-gradient"></div>' +
          '<div class="spotlight-grid">' +
            '<div class="spotlight-preview" data-news-go="' + lead.id + '">' +
              '<iframe id="spotlightIframe" data-prompt-id="' + lead.id + '" sandbox="allow-scripts"></iframe>' +
            '</div>' +
            '<div class="spotlight-editorial">' +
              '<div class="spotlight-kicker">TODAY\'S LEAD</div>' +
              '<h2 class="spotlight-title" data-news-go="' + lead.id + '">' + titleWithEmphasis(lead.title) + '</h2>' +
              (leadExcerpt ? '<div class="spotlight-excerpt">' + escapeHtml(leadExcerpt) + '</div>' : '') +
              '<div class="spotlight-byline">by <span class="author-link" data-author="' + lead.author + '">' + escapeHtml(lead.authorName) + '</span> · ' + formatNum(lead.downloads) + ' downloads · ' + lead.forks + ' forks</div>' +
              '<div class="spotlight-actions">' +
                '<button class="btn-play" data-news-go="' + lead.id + '">Open prompton</button>' +
                '<button class="btn-ghost" data-news-fork="' + lead.id + '">⑂ Fork</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      ) : '') +

      (recentlyAdded.length ? (
        '<div class="row-section">' +
          '<div class="row-header">' +
            '<h2>Recently added</h2>' +
            '<a class="show-all" data-go-sort="new">Show all</a>' +
          '</div>' +
          '<div class="row-scroll">' + recentlyAdded.map(albumCardHtml).join('') + '</div>' +
        '</div>'
      ) : '') +

      (FEATURES.trending && trending.length ? (
        '<div class="row-section">' +
          '<div class="row-header">' +
            '<h2>Trending today</h2>' +
            '<a class="show-all" data-go-sort="forks">Show all</a>' +
          '</div>' +
          '<div class="row-scroll">' + trending.map(albumCardHtml).join('') + '</div>' +
        '</div>'
      ) : '') +

      (yourForks.length ? (
        '<div class="row-section">' +
          '<div class="row-header">' +
            '<h2><em>Made for you</em></h2>' +
            '<a class="show-all" data-go-profile="' + me_h + '">Show all</a>' +
          '</div>' +
          '<div class="row-scroll">' + yourForks.map(albumCardHtml).join('') + '</div>' +
        '</div>'
      ) : '') +

      (featuredAuthorPrompts.length ? (
        '<div class="row-section">' +
          '<div class="row-header">' +
            '<h2 data-author="' + featuredAuthor + '">By ' + escapeHtml(featuredAuthorName) + '</h2>' +
            '<a class="show-all" data-go-profile="' + featuredAuthor + '">Show all</a>' +
          '</div>' +
          '<div class="row-scroll">' + featuredAuthorPrompts.map(albumCardHtml).join('') + '</div>' +
        '</div>'
      ) : '');

    // Assign spotlight iframe srcdoc imperatively (same reason as the detail
    // preview — see comment over there).
    const spotIframe = magazineEl.querySelector('#spotlightIframe');
    if (spotIframe) {
      const p = prompts.find(x => x.id === spotIframe.dataset.promptId);
      if (p) {
        if (p.layout === 'folder') spotIframe.src = 'htmls/' + p.id + '/index.html';
        else spotIframe.srcdoc = p.html || '';
      }
    }

    // Wire spotlight + cards
    magazineEl.querySelectorAll('[data-news-go]').forEach(el =>
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('author-link') || e.target.dataset.author) return;
        renderDetail(el.dataset.newsGo);
      }));
    magazineEl.querySelectorAll('[data-news-fork]').forEach(el =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = prompts.find(x => x.id === el.dataset.newsFork);
        if (p) forkPrompt(p);
      }));
    magazineEl.querySelectorAll('[data-fav-id]').forEach(el =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.favId;
        const nowFav = toggleFavorite(id);
        el.classList.toggle('on', nowFav);
        el.textContent = nowFav ? '♥' : '♡';
      }));
    magazineEl.querySelectorAll('[data-author]').forEach(a =>
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        renderProfile(a.dataset.author);
      }));
    magazineEl.querySelectorAll('[data-go-profile]').forEach(a =>
      a.addEventListener('click', () => renderProfile(a.dataset.goProfile)));
    magazineEl.querySelectorAll('[data-go-sort]').forEach(a =>
      a.addEventListener('click', () => {
        currentSort = a.dataset.goSort;
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) sortSelect.value = a.dataset.goSort;
        renderGallery();
        document.getElementById('cardGrid').scrollIntoView({behavior:'smooth', block:'start'});
      }));

    // Lazy-mount live iframe previews — only build the iframe once the card
    // enters the viewport. Keeps initial render fast and stops 30 sandboxed
    // browsers from spinning up at once.
    mountAlbumThumbs(magazineEl);

    archiveEl.innerHTML = '<div class="archive-header"><h2>All promptons</h2><p>The full library — search, filter, and sort below.</p></div>';
  } else {
    magazineEl.innerHTML = '';
    archiveEl.innerHTML = '';
  }

  // ── Filtered / sorted list ──
  let list = prompts.slice();
  if (currentFilter !== 'all') {
    list = list.filter(p => {
      if (normalizeTag(p.tag) === currentFilter) return true;
      if (Array.isArray(p.tags) && p.tags.some(t => normalizeTag(t) === currentFilter)) return true;
      return false;
    });
  }
  if (currentSearch.trim()) {
    const q = currentSearch.toLowerCase();
    list = list.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.authorName.toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  if (currentSort === 'new') list.sort((a,b) => b.date.localeCompare(a.date));
  if (currentSort === 'downloads') list.sort((a,b) => b.downloads - a.downloads);
  if (currentSort === 'forks') list.sort((a,b) => b.forks - a.forks);

  const grid = document.getElementById('cardGrid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-family:Fraunces,serif;font-style:italic;font-size:22px;color:var(--ink-soft)">Nothing matches — try a different search.</div>`;
    return;
  }
  list.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    const ribbonClass = p.forks > 50 ? 'tomato' : '';
    const ribbonText = p.forks > 50 ? 'Popular' : (p.parentId ? 'Fork' : p.model.split(' ')[0]);
    const knobsBadge = p.variables && p.variables.length ? `<span class="knobs-badge">⚙ ${p.variables.length} knobs</span>` : '';
    const versionBadge = p.versions && p.versions.length >= 2 ? `<span class="v-badge">v${p.versions.length}</span>` : '';
    const thumbInner = p.thumb
      ? `<img class="thumb-img" loading="lazy" decoding="async" src="${escapeAttr(thumbUrl(p))}" alt="">`
      : `<div class="thumb-mount card-thumb-mount" data-thumb-id="${p.id}"></div>`;
    const favOn = isFavorited(p.id);
    card.innerHTML = `
      <div class="thumb-wrap">
        <span class="ribbon ${ribbonClass}">${ribbonText}</span>
        ${thumbInner}
        <button type="button" class="fav-btn ${favOn ? 'on' : ''}" data-fav-id="${p.id}" aria-label="Favorite" title="Favorite">${favOn ? '♥' : '♡'}</button>
      </div>
      <div class="meta-top">
        <span>${formatDate(p.date)}</span>
        <span>${p.model}</span>
      </div>
      <h3>${escapeHtml(p.title)}</h3>
      <div class="by">by <span data-author="${p.author}">${escapeHtml(p.authorName)}</span></div>
      <div class="stats">
        <span><b>${formatNum(p.downloads)}</b> downloads</span>
        <span><b>${p.forks}</b> forks</span>
        ${versionBadge}
        ${knobsBadge}
      </div>
    `;
    const favBtn = card.querySelector('.fav-btn');
    if (favBtn) favBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const nowFav = toggleFavorite(p.id);
      favBtn.classList.toggle('on', nowFav);
      favBtn.textContent = nowFav ? '♥' : '♡';
    });
    card.addEventListener('click', (e) => {
      if (compareMode) {
        const idx = compareSelection.indexOf(p.id);
        if (idx >= 0) {
          compareSelection.splice(idx, 1);
          card.classList.remove('selected');
        } else if (compareSelection.length < 2) {
          compareSelection.push(p.id);
          card.classList.add('selected');
        }
        updateComparePill();
        // Auto-trigger when 2 selected — no floating bottom pill needed.
        if (compareSelection.length === 2) {
          const sel = compareSelection.slice();
          compareMode = false;
          compareSelection = [];
          const toggle = document.getElementById('compareToggle');
          if (toggle) { toggle.classList.remove('active'); toggle.textContent = '⇄ Compare'; }
          const gridEl = document.getElementById('cardGrid');
          if (gridEl) gridEl.classList.remove('compare-mode');
          renderCompare(sel[0], sel[1], null);
        }
        return;
      }
      if (e.target.dataset.author) {
        renderProfile(e.target.dataset.author);
        return;
      }
      renderDetail(p.id);
    });
    if (compareMode && compareSelection.indexOf(p.id) >= 0) {
      card.classList.add('selected');
    }
    grid.appendChild(card);
  });
  // Apply compare-mode class
  grid.classList.toggle('compare-mode', compareMode);
  const _issueCountEl = document.getElementById('issueCount');
  if (_issueCountEl) _issueCountEl.textContent = `${prompts.length} promptons in circulation`;
  // Lazy-mount the grid's iframe thumbnails — only what enters the viewport.
  mountAlbumThumbs(grid);
  showView('gallery');
}

// ─── Compare mode (gallery) ───
function updateComparePill() {
  const pill = document.getElementById('comparePill');
  const goBtn = document.getElementById('compareGoBtn');
  if (!compareMode) {
    pill.classList.remove('show');
    pill.setAttribute('aria-hidden', 'true');
    return;
  }
  pill.classList.add('show');
  pill.setAttribute('aria-hidden', 'false');
  pill.querySelector('.count').textContent = compareSelection.length + ' of 2 selected';
  goBtn.disabled = compareSelection.length !== 2;
  goBtn.textContent = compareSelection.length === 2 ? 'Compare now →' : 'Pick ' + (2 - compareSelection.length) + ' more';
}
function clearCompareSelection() {
  compareSelection = [];
  document.querySelectorAll('#cardGrid .card.selected').forEach(c => c.classList.remove('selected'));
  updateComparePill();
}
document.getElementById('compareToggle').addEventListener('click', () => {
  compareMode = !compareMode;
  const toggle = document.getElementById('compareToggle');
  toggle.classList.toggle('active', compareMode);
  toggle.textContent = compareMode ? '⇄ Cancel compare' : '⇄ Compare';
  const grid = document.getElementById('cardGrid');
  if (grid) grid.classList.toggle('compare-mode', compareMode);
  if (!compareMode) clearCompareSelection();
  updateComparePill();
});
document.getElementById('compareGoBtn').addEventListener('click', () => {
  if (compareSelection.length !== 2) return;
  const [a, b] = compareSelection;
  // Reset compare mode before navigating
  const sel = compareSelection.slice();
  compareMode = false;
  compareSelection = [];
  const toggle = document.getElementById('compareToggle');
  toggle.classList.remove('active');
  toggle.textContent = '⇄ Compare';
  const grid = document.getElementById('cardGrid');
  if (grid) grid.classList.remove('compare-mode');
  updateComparePill();
  renderCompare(sel[0], sel[1], null);
});
document.getElementById('compareClearBtn').addEventListener('click', () => clearCompareSelection());

// ─── Detail rendering ───
function renderDetail(id, viewingVersionNum) {
  const p = prompts.find(x => x.id === id);
  if (!p) return;
  setRoute('p/' + id);
  p.downloads = p.downloads; // (counts updated on actual download)

  const parent = p.parentId ? prompts.find(x => x.id === p.parentId) : null;
  const children = prompts.filter(x => x.parentId === p.id);

  const hasVersions = p.versions && p.versions.length >= 2;
  const latestV = hasVersions ? getCurrentVersionNum(p) : null;
  const viewing = (viewingVersionNum != null) ? viewingVersionNum : latestV;
  const isViewingPast = hasVersions && viewing != null && viewing !== latestV;

  // Build `view` — overlay the selected past version's data on top of p
  let view = p;
  if (isViewingPast) {
    const vData = getVersionData(p, viewing);
    if (vData) {
      view = Object.assign({}, p, {
        systemPrompt: vData.systemPrompt,
        userPrompt: vData.userPrompt,
        context: vData.context,
        model: vData.model,
        html: vData.html,
        variables: (vData.variables !== undefined) ? vData.variables : p.variables,
        date: vData.date
      });
    }
  }

  const isYours = p.author === ownerHandle();
  const canSaveNewVersion = (isYours || isOwner()) && !isViewingPast;

  // Auto-detect undeclared {{TOKEN}} variables in the prompt text. Any token
  // that appears in systemPrompt/userPrompt/context but isn't in view.variables
  // gets synthesized as an editable field, so the Personalize panel covers it.
  const declaredKeys = new Set((view.variables || []).map(v => v.key));
  const haystack = [view.systemPrompt, view.userPrompt, view.context].filter(Boolean).join(' ');
  const tokenRe = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
  const autoVars = [];
  const seen = new Set(declaredKeys);
  let m;
  while ((m = tokenRe.exec(haystack)) !== null) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    // Humanize key → label (e.g. CUSTOMER_NAME → "Customer name")
    const label = key.toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
    autoVars.push({ key, label, default: '', hint: 'Auto-detected from {{' + key + '}}', auto: true });
  }
  if (autoVars.length) {
    view = Object.assign({}, view, { variables: (view.variables || []).concat(autoVars) });
  }

  const el = document.getElementById('detailContent');
  el.innerHTML = `
    ${isViewingPast ? `
      <div class="version-banner">
        <span>Viewing v${viewing} of ${p.versions.length} · ${formatDate(view.date)} · ${escapeHtml(view.model)}</span>
        <button type="button" class="back-latest" id="backToLatestBtn">← Back to latest (v${latestV})</button>
      </div>` : ''}

    <div class="detail-header">
      <div>
        <h1>${escapeHtml(p.title)}</h1>
        <div class="detail-byline">
          <span class="author-link" data-author="${p.author}">@${escapeHtml(p.author)}</span>
          &nbsp;·&nbsp; ${formatDateShort(p.date)}
          &nbsp;·&nbsp; ${escapeHtml(p.model)}
          ${parent ? `&nbsp;·&nbsp; <span class="author-link" data-prompt="${parent.id}">forked from ${escapeHtml(parent.title)}</span>` : ''}
        </div>
        <div class="detail-counts">
          <span class="dc-item"><b>${formatNum(p.downloads)}</b> ${escapeHtml(t('profile.downloads'))}</span>
          <span class="dc-item"><b>${formatNum(p.forks)}</b> ${escapeHtml(t('profile.forks'))}</span>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn primary" id="openClaudeTopBtn" title="Opens claude.ai with this prompt pre-filled">${escapeHtml(t('detail.open'))}</button>
        ${isOwner() ? `<button class="btn secondary owner-action" id="editMetadataBtn" title="Edit title / description / tags / license">${escapeHtml(t('detail.edit'))}</button>` : ''}
        ${canSaveNewVersion ? `<button class="btn secondary owner-action" id="saveVersionBtn">${escapeHtml(t('detail.saveVersion'))}</button>` : ''}
        ${isOwner() ? `<button class="btn danger owner-action" id="deletePromptBtn" title="Delete this prompton and its files from GitHub">${escapeHtml(t('detail.delete'))}</button>` : ''}
        <button class="btn secondary" id="copyPromptTopBtn" title="Copy the full prompt to clipboard">${escapeHtml(t('detail.copy'))}</button>
        <button class="btn secondary" id="downloadBtn">${escapeHtml(t('detail.download'))}</button>
        <button class="btn secondary ${isFavorited(p.id) ? 'on' : ''}" id="favoriteBtn" title="Favorite (private, this device only)">${escapeHtml(isFavorited(p.id) ? t('detail.favorited') : t('detail.favorite'))}</button>
        <button class="btn secondary" id="addToPlaylistBtn" title="Add to playlist">${escapeHtml(t('detail.playlist'))}</button>
        <button class="btn secondary" id="shareBtn" title="Share this prompton">${escapeHtml(t('detail.share'))}</button>
        <button class="btn secondary" id="forkBtn">${escapeHtml(t('detail.fork'))}</button>
        ${parent ? `<button class="btn secondary" id="compareOriginalBtn">${escapeHtml(t('detail.compareOriginal'))}</button>` : ''}
      </div>
    </div>

    <div id="versionEditorMount"></div>

    <div class="detail-grid">
      <div>
        <div class="preview-wrap">
          <!-- No allow-same-origin: prompt HTML runs arbitrary JS; sharing the
               app origin would let it read localStorage (GitHub PAT). Opaque
               origin still loads static subresources and GitHub Pages sends
               ACAO:* so same-host fetch() keeps working too. -->
          <iframe id="detailPreviewIframe" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" allowfullscreen></iframe>
          ${p.thumb ? `<img class="preview-thumb-mobile" src="${escapeAttr(thumbUrl(p))}" alt="">` : ''}
          <div class="preview-overlay">
            <button type="button" id="fullscreenBtn" title="View fullscreen">${escapeHtml(t('detail.fullscreen'))}</button>
            <a id="openStandaloneLink" target="_blank" rel="noopener" title="Open this HTML on its own page (good for sharing)">${escapeHtml(t('detail.standalone'))}</a>
          </div>
        </div>
        <div class="preview-caption">
          <span>↑ Live preview · ${(new Blob([view.html]).size / 1024).toFixed(1)} KB</span>
          <span>${escapeHtml(p.license)}</span>
        </div>

        ${hasVersions ? renderVersionTimeline(p, viewing) : ''}

        <div class="meta-block" style="margin-top:30px">
          <h2>Description</h2>
          <p style="font-size:16px;line-height:1.6">${escapeHtml(p.description)}</p>
        </div>

        ${p.reproPrompt ? `
        <div class="meta-block">
          <h2>How to reproduce</h2>
          <pre class="repro-block">${escapeHtml(p.reproPrompt)}</pre>
        </div>` : ''}

        ${p.devNotes ? `
        <div class="meta-block">
          <h2>Development notes</h2>
          <div class="dev-notes">${escapeHtml(p.devNotes).replace(/\n/g, '<br>')}</div>
        </div>` : ''}

        <div class="meta-block">
          <h2>Tags</h2>
          <div class="tag-list">${normalizeTagList(p.tags || []).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>
        </div>

        ${children.length || parent ? `
        <div class="fork-tree">
          <h2>Fork tree</h2>
          ${parent ? `<div class="fork-item" data-prompt="${parent.id}"><span class="arrow">↰</span> <span class="fork-title">${escapeHtml(parent.title)}</span> <span class="fork-author">by ${escapeHtml(parent.authorName)}</span><span class="compare-link" data-compare-pair="${parent.id},${p.id}" title="Compare with this version">⇄</span></div>` : ''}
          ${children.map(c => `<div class="fork-item" data-prompt="${c.id}"><span class="arrow">↳</span> <span class="fork-title">${escapeHtml(c.title)}</span> <span class="fork-author">by ${escapeHtml(c.authorName)}</span><span class="compare-link" data-compare-pair="${p.id},${c.id}" title="Compare with this version">⇄</span></div>`).join('')}
          ${!children.length && !parent ? '<div class="empty-fork">No forks yet — be the first.</div>' : ''}
        </div>` : `
        <div class="fork-tree">
          <h2>Fork tree</h2>
          <div class="empty-fork">No forks yet — be the first.</div>
        </div>`}
      </div>

      <div>
        <div class="anatomy">
          <h2>Prompt Anatomy</h2>
          ${view.systemPrompt ? `<div class="block"><div class="block-label"><span class="label-text">System prompt</span><button type="button" class="block-copy" data-copy-section="systemPrompt" title="Copy this section">⎘ Copy</button></div><pre data-template="systemPrompt">${renderTemplate(view.systemPrompt, view.variables)}</pre></div>` : ''}
          <div class="block"><div class="block-label"><span class="label-text">User instruction</span><button type="button" class="block-copy" data-copy-section="userPrompt" title="Copy this section">⎘ Copy</button></div><pre data-template="userPrompt">${renderTemplate(view.userPrompt, view.variables)}</pre></div>
          ${view.context ? `<div class="block"><div class="block-label"><span class="label-text">Context / data</span><button type="button" class="block-copy" data-copy-section="context" title="Copy this section">⎘ Copy</button></div><pre data-template="context">${renderTemplate(view.context, view.variables)}</pre></div>` : ''}
        </div>

        ${view.variables && view.variables.length ? `
        <div class="personalize" id="personalizePanel">
          <h2>Make it yours.</h2>
          <div class="tagline">Tweak the knobs the author left out — the prompt updates live.</div>
          ${view.variables.map(v => {
            const isLong = (v.default || '').length > 60;
            const tag = isLong ? 'textarea' : 'input';
            const valAttr = isLong ? '' : ` value="${escapeAttr(v.default)}"`;
            const inner = isLong ? escapeHtml(v.default) : '';
            return `<div class="var-field" data-var-field="${escapeAttr(v.key)}"${v.auto ? ' data-auto="1"' : ''}>
              <label>${escapeHtml(v.label)}${v.required ? ' <span class="req">*</span>' : ''} <span class="key-tag">{{${escapeHtml(v.key)}}}</span></label>
              <${tag} data-var="${escapeAttr(v.key)}"${valAttr}${isLong ? '' : ' type="text"'}>${inner}${isLong ? `</${tag}>` : ''}
              ${v.hint ? `<div class="hint">${escapeHtml(v.hint)}</div>` : ''}
            </div>`;
          }).join('')}
          <div class="actions">
            <button class="btn-copy" id="copyPromptBtn">⎘ Copy personalized prompt</button>
            <button class="btn-claude" id="openClaudeBtn">↗ Open in Claude.ai</button>
            <button class="btn-reset" id="resetVarsBtn">Reset to defaults</button>
            <button class="btn-clear" id="clearVarsBtn" style="display:none">× Clear my values</button>
            <span class="status" id="copyStatus">✓ Copied</span>
          </div>
        </div>` : ''}

        ${p.usage && p.usage.length ? `
        <div class="usage">
          <h2>Usage Instructions</h2>
          <ol>${p.usage.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
        </div>` : ''}
      </div>
    </div>
  `;

  // Helper: get current substituted values (from personalize panel if present, else defaults)
  const getCurrentSubVals = () => {
    if (!view.variables || !view.variables.length) return {};
    const panel = document.getElementById('personalizePanel');
    if (!panel) {
      const o = {};
      view.variables.forEach(v => { o[v.key] = v.default; });
      return o;
    }
    const o = {};
    panel.querySelectorAll('[data-var]').forEach(i => { o[i.dataset.var] = i.value; });
    return o;
  };

  // Helper: build the full formatted prompt
  const buildFullPromptText = () => {
    const vals = getCurrentSubVals();
    const parts = [];
    if (view.systemPrompt) parts.push('[SYSTEM]\n' + substitute(view.systemPrompt, view.variables, vals));
    parts.push('[USER]\n' + substitute(view.userPrompt, view.variables, vals));
    if (view.context) parts.push('[CONTEXT]\n' + substitute(view.context, view.variables, vals));
    return parts.join('\n\n');
  };

  // Helper: validate required variables (if personalize panel exists). Returns false + shows feedback if invalid.
  const ensureRequiredValid = () => {
    if (!view.variables || !view.variables.length) return true;
    const panel = document.getElementById('personalizePanel');
    if (!panel) return true;
    let valid = true;
    panel.querySelectorAll('.var-field').forEach(f => f.classList.remove('error'));
    view.variables.forEach(v => {
      if (!v.required) return;
      const input = panel.querySelector(`[data-var="${v.key}"]`);
      if (input && !input.value.trim()) {
        const field = input.closest('.var-field');
        if (field) field.classList.add('error');
        valid = false;
      }
    });
    if (!valid) {
      const t = document.getElementById('toast');
      t.textContent = 'Fill in the required variables first.';
      t.classList.add('error'); t.classList.add('show');
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.classList.remove('show'); t.classList.remove('error'); }, 2400);
      // Scroll to first error
      const firstErr = panel.querySelector('.var-field.error');
      if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return valid;
  };

  // Helper: in-place "Copied" feedback on any button
  const copyWithFeedback = (text, btn, doneLabel) => {
    navigator.clipboard.writeText(text).then(() => {
      const originalHTML = btn.innerHTML;
      btn.classList.add('success');
      btn.innerHTML = '✓ ' + (doneLabel || 'Copied');
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => {
        btn.classList.remove('success');
        btn.innerHTML = originalHTML;
      }, 1800);
    }).catch(() => toast('Copy failed — select and copy manually'));
  };

  // Point the live-preview iframe at the real HTML file. Streaming parse is
  // far faster than srcdoc for 70KB+ payloads, and the URL matches the
  // standalone open link so the browser only fetches once. Folder-layout
  // prompts resolve to htmls/<id>/index.html (or _v<n>/index.html for past
  // versions); flat prompts keep the legacy htmls/<id>.html path.
  const previewIframe = document.getElementById('detailPreviewIframe');
  if (previewIframe) {
    previewIframe.src = promptHtmlPath(p, isViewingPast ? viewing : null);
  }

  // Wire actions
  document.getElementById('downloadBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const blob = new Blob([view.html], {type: 'text/html'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = safeFilename(p);
    a.click();
    URL.revokeObjectURL(url);
    p.downloads++;
    saveData(prompts);
    const originalHTML = btn.innerHTML;
    btn.classList.add('success');
    btn.innerHTML = '✓ Downloaded';
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => { btn.classList.remove('success'); btn.innerHTML = originalHTML; }, 1800);
    // Refresh just the downloads count in the new .detail-counts strip.
    const dlEl = document.querySelector('.detail-counts .dc-item:first-child b');
    if (dlEl) dlEl.textContent = formatNum(p.downloads);
    // Owner-only: persist the increment so the count survives reload + shows
    // up on other devices. Fire-and-forget — local increment already happened.
    if (isOwner()) {
      bumpDownloadCountOnGitHub(p).catch(err => console.warn('Download count push failed:', err));
    }
  });

  document.getElementById('forkBtn').addEventListener('click', () => {
    forkPrompt(p);
  });

  // Share button — opens a small popover with native share / copy link / LINE / X.
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSharePopover(shareBtn, p);
    });
  }

  // Add-to-playlist popover — anchor under the button, click outside closes.
  const plBtn = document.getElementById('addToPlaylistBtn');
  if (plBtn) {
    plBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const existing = document.getElementById('plMenuPopover');
      if (existing) { existing.remove(); return; }
      const rect = plBtn.getBoundingClientRect();
      const pop = document.createElement('div');
      pop.id = 'plMenuPopover';
      pop.className = 'pl-menu-popover';
      pop.style.cssText = `position:absolute;top:${rect.bottom + window.scrollY + 6}px;left:${rect.left + window.scrollX}px;z-index:1000;`;
      const inner = document.createElement('div');
      inner.className = 'pl-menu-inner';
      pop.appendChild(inner);
      document.body.appendChild(pop);
      renderAddToPlaylistMenu(inner, p.id);
      const offClick = (e) => {
        if (!pop.contains(e.target) && e.target !== plBtn) {
          pop.remove();
          document.removeEventListener('click', offClick);
        }
      };
      setTimeout(() => document.addEventListener('click', offClick), 0);
    });
  }

  // Favorite toggle — private, per-device. Heart fills + the count on the
  // owner's profile bumps on next render.
  const favBtn = document.getElementById('favoriteBtn');
  if (favBtn) {
    favBtn.addEventListener('click', () => {
      const nowFav = toggleFavorite(p.id);
      favBtn.classList.toggle('on', nowFav);
      favBtn.textContent = nowFav ? t('detail.favorited') : t('detail.favorite');
    });
  }

  // Fullscreen — request fullscreen on the live preview iframe so the HTML
  // takes over the screen. Esc / browser UI returns the user to the detail view.
  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      const iframe = document.getElementById('detailPreviewIframe');
      if (!iframe) return;
      const req = iframe.requestFullscreen || iframe.webkitRequestFullscreen || iframe.msRequestFullscreen;
      if (req) {
        req.call(iframe).catch(err => {
          console.warn('Fullscreen denied — falling back to standalone tab:', err);
          // Fallback: open standalone in new tab
          const link = document.getElementById('openStandaloneLink');
          if (link && link.href) window.open(link.href, '_blank', 'noopener');
        });
      } else {
        toast('Fullscreen not supported — opening standalone instead.');
        const link = document.getElementById('openStandaloneLink');
        if (link && link.href) window.open(link.href, '_blank', 'noopener');
      }
    });
  }

  // Open standalone — direct link to the raw HTML file. On the production site
  // (GitHub Pages) this is shareable; on the local dev server it's the same.
  const openLink = document.getElementById('openStandaloneLink');
  if (openLink) {
    // Always link to the same-origin htmls/ path so it works both locally and on Pages.
    openLink.href = 'htmls/' + encodeURIComponent(p.id) + '.html';
  }

  // Top-level Copy prompt button — works for any prompt
  document.getElementById('copyPromptTopBtn').addEventListener('click', (e) => {
    if (!ensureRequiredValid()) return;
    copyWithFeedback(buildFullPromptText(), e.currentTarget);
  });

  // Top-level Open in Claude.ai button — works for any prompt
  document.getElementById('openClaudeTopBtn').addEventListener('click', (e) => {
    if (!ensureRequiredValid()) return;
    window.open('https://claude.ai/new?q=' + encodeURIComponent(buildFullPromptText()), '_blank');
    const btn = e.currentTarget;
    const originalHTML = btn.innerHTML;
    btn.classList.add('success');
    btn.innerHTML = '✓ Opened';
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => { btn.classList.remove('success'); btn.innerHTML = originalHTML; }, 1800);
  });

  // Per-block copy buttons in Prompt Anatomy
  el.querySelectorAll('.block-copy').forEach(b => {
    b.addEventListener('click', () => {
      const section = b.dataset.copySection; // 'systemPrompt' | 'userPrompt' | 'context'
      if (!ensureRequiredValid()) return;
      const vals = getCurrentSubVals();
      const text = substitute(view[section] || '', view.variables, vals);
      copyWithFeedback(text, b);
    });
  });

  if (parent) {
    const compareBtn = document.getElementById('compareOriginalBtn');
    if (compareBtn) compareBtn.addEventListener('click', () => renderCompare(parent.id, p.id, p.id));
  }

  // Version banner: back to latest
  const backToLatestBtn = document.getElementById('backToLatestBtn');
  if (backToLatestBtn) {
    backToLatestBtn.addEventListener('click', () => renderDetail(p.id));
  }

  // Save new version button
  const saveVersionBtn = document.getElementById('saveVersionBtn');
  if (saveVersionBtn) {
    saveVersionBtn.addEventListener('click', () => openVersionEditor(p.id));
  }

  // Edit metadata (owner only) — opens inline editor for title / description / tags / license / model.
  const editMetaBtn = document.getElementById('editMetadataBtn');
  if (editMetaBtn) {
    editMetaBtn.addEventListener('click', () => openMetadataEditor(p.id));
  }

  // Delete prompt (owner only) — removes from GitHub then from local state.
  const deleteBtn = document.getElementById('deletePromptBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const msg = `Delete "${p.title}" (${p.id})?\n\nThis removes htmls/${p.id}.html and the manifest entry from GitHub. Cannot be undone.`;
      if (!confirm(msg)) return;
      const originalHTML = deleteBtn.innerHTML;
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '… Deleting';
      try {
        await deletePromptFromGitHub(p);
        // Remove from in-memory state and persist cache
        const lIdx = prompts.findIndex(x => x.id === p.id);
        if (lIdx >= 0) prompts.splice(lIdx, 1);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(seedPrompts)); } catch(e){}
        toast('Deleted "' + p.title + '" — Pages may take a minute to refresh');
        showView('gallery');
        renderGallery();
      } catch (err) {
        console.error('Delete failed:', err);
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = originalHTML;
        alert('Delete failed: ' + err.message);
      }
    });
  }

  // Version timeline buttons (view + compare)
  el.querySelectorAll('[data-view-version]').forEach(b =>
    b.addEventListener('click', () => renderDetail(p.id, parseInt(b.dataset.viewVersion, 10))));
  el.querySelectorAll('[data-compare-version]').forEach(b =>
    b.addEventListener('click', () => {
      const vNum = parseInt(b.dataset.compareVersion, 10);
      renderCompare(p.id + ':v' + vNum, p.id + ':v' + latestV, p.id);
    }));

  el.querySelectorAll('[data-author]').forEach(a =>
    a.addEventListener('click', () => renderProfile(a.dataset.author)));
  el.querySelectorAll('[data-prompt]').forEach(a =>
    a.addEventListener('click', (e) => {
      if (e.target.classList.contains('compare-link')) return;
      renderDetail(a.dataset.prompt);
    }));
  el.querySelectorAll('[data-compare-pair]').forEach(a =>
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      const parts = a.dataset.comparePair.split(',');
      renderCompare(parts[0], parts[1], p.id);
    }));

  // ── Personalization wiring ──
  if (view.variables && view.variables.length) {
    const panel = document.getElementById('personalizePanel');
    const inputs = panel.querySelectorAll('[data-var]');
    const varsStorageKey = 'promptshare_vars_' + p.id + (isViewingPast ? '_v' + viewing : '');

    const currentValues = () => {
      const o = {};
      inputs.forEach(i => { o[i.dataset.var] = i.value; });
      return o;
    };

    const updateClearBtn = () => {
      const btn = document.getElementById('clearVarsBtn');
      btn.style.display = localStorage.getItem(varsStorageKey) ? '' : 'none';
    };

    const persistValues = () => {
      try { localStorage.setItem(varsStorageKey, JSON.stringify(currentValues())); } catch(e) {}
      updateClearBtn();
    };

    const updateAnatomy = (changedKey) => {
      const vals = currentValues();
      el.querySelectorAll('.anatomy pre[data-template]').forEach(pre => {
        const field = pre.dataset.template;
        pre.innerHTML = renderTemplateWithValues(view[field], view.variables, vals);
      });
      if (changedKey) {
        el.querySelectorAll(`.anatomy pre .subst[data-key="${changedKey}"]`).forEach(s => {
          s.classList.add('flash');
          setTimeout(() => s.classList.remove('flash'), 350);
        });
      }
    };

    // Restore saved values from localStorage
    try {
      const saved = localStorage.getItem(varsStorageKey);
      if (saved) {
        const savedVals = JSON.parse(saved);
        inputs.forEach(input => {
          if (savedVals[input.dataset.var] !== undefined) input.value = savedVals[input.dataset.var];
        });
        updateAnatomy();
      }
    } catch(e) {}
    updateClearBtn();

    // Clear error on input; persist and update anatomy
    inputs.forEach(input => {
      input.addEventListener('input', () => {
        const field = input.closest('.var-field');
        if (field) field.classList.remove('error');
        updateAnatomy(input.dataset.var);
        persistValues();
      });
    });

    // Validate required fields — returns true if valid
    const validateRequired = () => {
      let valid = true;
      panel.querySelectorAll('.var-field').forEach(f => f.classList.remove('error'));
      view.variables.forEach(v => {
        if (!v.required) return;
        const input = panel.querySelector(`[data-var="${v.key}"]`);
        if (input && !input.value.trim()) {
          const field = input.closest('.var-field');
          if (field) field.classList.add('error');
          valid = false;
        }
      });
      if (!valid) {
        const t = document.getElementById('toast');
        t.textContent = 'Fill in the required variables first.';
        t.classList.add('error');
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.classList.remove('show'); t.classList.remove('error'); }, 2400);
      }
      return valid;
    };

    // Build substituted prompt text
    const buildPromptText = () => {
      const vals = currentValues();
      const parts = [];
      if (view.systemPrompt) parts.push('[SYSTEM]\n' + substitute(view.systemPrompt, view.variables, vals));
      parts.push('[USER]\n' + substitute(view.userPrompt, view.variables, vals));
      if (view.context) parts.push('[CONTEXT]\n' + substitute(view.context, view.variables, vals));
      return parts.join('\n\n');
    };

    document.getElementById('copyPromptBtn').addEventListener('click', (e) => {
      if (!validateRequired()) return;
      copyWithFeedback(buildPromptText(), e.currentTarget, 'Copied');
    });

    document.getElementById('openClaudeBtn').addEventListener('click', (e) => {
      if (!validateRequired()) return;
      window.open('https://claude.ai/new?q=' + encodeURIComponent(buildPromptText()), '_blank');
      const btn = e.currentTarget;
      const originalHTML = btn.innerHTML;
      btn.classList.add('success');
      btn.innerHTML = '✓ Opened';
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => { btn.classList.remove('success'); btn.innerHTML = originalHTML; }, 1800);
    });

    document.getElementById('resetVarsBtn').addEventListener('click', () => {
      inputs.forEach(input => {
        const v = view.variables.find(x => x.key === input.dataset.var);
        if (v) input.value = v.default;
      });
      panel.querySelectorAll('.var-field').forEach(f => f.classList.remove('error'));
      updateAnatomy();
      persistValues();
      toast('Reset to author defaults');
    });

    document.getElementById('clearVarsBtn').addEventListener('click', () => {
      try { localStorage.removeItem(varsStorageKey); } catch(e) {}
      inputs.forEach(input => {
        const v = view.variables.find(x => x.key === input.dataset.var);
        if (v) input.value = v.default;
      });
      panel.querySelectorAll('.var-field').forEach(f => f.classList.remove('error'));
      updateAnatomy();
      updateClearBtn();
      toast('Cleared your saved values');
    });
  }

  showView('detail');
}

// ─── Version timeline rendering ───
function renderVersionTimeline(p, viewing) {
  if (!p.versions || p.versions.length < 2) return '';
  const latestV = p.versions[p.versions.length - 1].v;
  // Newest first
  const nodes = p.versions.slice().reverse().map(v => {
    const isCurrent = v.v === latestV;
    const isViewing = v.v === viewing && !isCurrent;
    const isPast = v.v !== latestV;
    return `
      <div class="version-node ${isCurrent ? 'current' : ''} ${isViewing ? 'viewing' : ''}">
        <div class="node-header">
          <span class="v-num">v${v.v}</span>
          ${isCurrent ? '<span class="v-current-tag">Current</span>' : ''}
          ${isViewing ? '<span class="v-viewing-tag">Viewing</span>' : ''}
          <span class="v-date">${formatDate(v.date)}</span>
        </div>
        <div class="v-model">Model · ${escapeHtml(v.model)}</div>
        <div class="v-changelog">${escapeHtml(v.changelog || '(no changelog)')}</div>
        ${isPast ? `
          <div class="v-actions">
            ${v.v === viewing
              ? `<button type="button" data-view-version="${latestV}">Back to latest</button>`
              : `<button type="button" data-view-version="${v.v}">View this version</button>`}
            <button type="button" data-compare-version="${v.v}">Compare with v${latestV}</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
  return `
    <div class="version-timeline">
      <h2>Version History</h2>
      <div class="version-list">${nodes}</div>
    </div>
  `;
}

// ─── Save new version workflow ───
function openVersionEditor(promptId) {
  const p = prompts.find(x => x.id === promptId);
  if (!p) return;
  const latest = (p.versions && p.versions.length) ? p.versions[p.versions.length - 1] : null;
  const baseSys = latest ? latest.systemPrompt : (p.systemPrompt || '');
  const baseUser = latest ? latest.userPrompt : (p.userPrompt || '');
  const baseCtx = latest ? latest.context : (p.context || '');
  const baseModel = latest ? latest.model : p.model;
  const versionCount = (p.versions && p.versions.length) ? p.versions.length : 1;
  const nextV = versionCount + 1;

  const mount = document.getElementById('versionEditorMount');
  if (!mount) return;
  mount.innerHTML = `
    <div class="version-editor" id="versionEditor">
      <h2>Save new version (v${nextV})</h2>
      <div class="editor-tagline">Describe what changed and why. Past versions are preserved.</div>
      ${versionCount >= 8 ? `<div class="editor-warning">Consider starting a fresh prompton — this one's history is getting long (${versionCount} versions).</div>` : ''}
      <div class="field" id="changelogField">
        <label>Changelog <span class="req">*</span> — what changed?</label>
        <textarea name="changelog" placeholder="e.g. Tightened the system prompt. Added a constraint about specificity."></textarea>
      </div>
      <div class="field">
        <label>System prompt</label>
        <textarea name="systemPrompt">${escapeHtml(baseSys)}</textarea>
      </div>
      <div class="field">
        <label>User instruction</label>
        <textarea name="userPrompt">${escapeHtml(baseUser)}</textarea>
      </div>
      <div class="field">
        <label>Context / data</label>
        <textarea name="context">${escapeHtml(baseCtx)}</textarea>
      </div>
      <div class="field">
        <label>Model</label>
        <select name="model">
          ${['Claude Opus 4.7','Claude Sonnet 4.6','GPT-4o','GPT-5','Gemini 2.5 Pro','DeepSeek V3','Other']
            .map(m => `<option ${m === baseModel ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>New HTML output <span style="color:var(--ink-soft);text-transform:none;letter-spacing:0;">(optional — reuses previous if not provided)</span></label>
        <label class="file-drop" id="versionFileDrop">
          <div id="versionDropTitle">Drop your .html here</div>
          <div style="font-size:11px;color:var(--ink-soft);margin-top:4px" id="versionDropHint">or click to browse</div>
          <input type="file" accept=".html,text/html" style="display:none" id="versionHtmlFile" />
        </label>
      </div>
      <div class="editor-actions">
        <button type="button" class="btn" id="versionSaveBtn">Save version</button>
        <button type="button" class="btn-cancel" id="versionCancelBtn">Cancel</button>
      </div>
    </div>
  `;

  let stagedHtml = '';
  const fileDrop = document.getElementById('versionFileDrop');
  const fileInput = document.getElementById('versionHtmlFile');
  fileDrop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      stagedHtml = reader.result;
      fileDrop.classList.add('has-file');
      document.getElementById('versionDropTitle').textContent = '✓ ' + f.name;
      document.getElementById('versionDropHint').textContent = (f.size/1024).toFixed(1) + ' KB · ready';
    };
    reader.readAsText(f);
  });

  document.getElementById('versionCancelBtn').addEventListener('click', () => {
    mount.innerHTML = '';
  });

  document.getElementById('versionSaveBtn').addEventListener('click', () => {
    const editor = document.getElementById('versionEditor');
    const changelogField = document.getElementById('changelogField');
    const changelog = editor.querySelector('[name="changelog"]').value.trim();
    if (!changelog) {
      changelogField.classList.add('error');
      const t = document.getElementById('toast');
      t.textContent = 'A changelog is required so others know what changed.';
      t.classList.add('error'); t.classList.add('show');
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.classList.remove('show'); t.classList.remove('error'); }, 2400);
      return;
    }
    changelogField.classList.remove('error');
    saveNewVersion(promptId, {
      changelog: changelog,
      systemPrompt: editor.querySelector('[name="systemPrompt"]').value,
      userPrompt: editor.querySelector('[name="userPrompt"]').value,
      context: editor.querySelector('[name="context"]').value,
      model: editor.querySelector('[name="model"]').value,
      html: stagedHtml || null
    });
  });

  mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openMetadataEditor(promptId) {
  const p = prompts.find(x => x.id === promptId);
  if (!p) return;
  const mount = document.getElementById('versionEditorMount');
  if (!mount) return;
  const modelOpts = ['Claude Opus 4.7','Claude Sonnet 4.6','GPT-4o','GPT-5','Gemini 2.5 Pro','DeepSeek V3','Other'];
  mount.innerHTML = `
    <div class="version-editor" id="metadataEditor">
      <h2>Edit metadata</h2>
      <div class="editor-tagline">Title, description, tags, license, model. Prompt body and HTML are not touched — use "Save new version" for those.</div>
      <div class="field">
        <label>Title <span class="req">*</span></label>
        <input type="text" name="title" value="${escapeAttr(p.title)}">
      </div>
      <div class="field">
        <label>Description</label>
        <textarea name="description">${escapeHtml(p.description || '')}</textarea>
      </div>
      <div class="field">
        <label>How to reproduce <span style="color:var(--ink-soft);text-transform:none;letter-spacing:0;">(optional — paste the exact prompt or step-by-step)</span></label>
        <textarea name="reproPrompt" style="min-height:80px;font-family:'JetBrains Mono', monospace;font-size:13px">${escapeHtml(p.reproPrompt || '')}</textarea>
      </div>
      <div class="field">
        <label>Development notes <span style="color:var(--ink-soft);text-transform:none;letter-spacing:0;">(optional — context, iterations, gotchas)</span></label>
        <textarea name="devNotes" style="min-height:80px">${escapeHtml(p.devNotes || '')}</textarea>
      </div>
      <div class="field">
        <label>Tags <span style="color:var(--ink-soft);text-transform:none;letter-spacing:0;">(type to add · Enter or comma to commit · × on a pill to remove)</span></label>
        <div id="metaTagPicker"></div>
      </div>
      <div class="field">
        <label>License</label>
        <input type="text" name="license" value="${escapeAttr(p.license || '')}">
      </div>
      <div class="field">
        <label>Model</label>
        <select name="model">
          ${modelOpts.map(m => `<option ${m === p.model ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="editor-actions">
        <button type="button" class="btn" id="metadataSaveBtn">Save metadata</button>
        <button type="button" class="btn-cancel" id="metadataCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  const metaPicker = mountTagPicker('metaTagPicker', p.tags || []);
  document.getElementById('metadataCancelBtn').addEventListener('click', () => { mount.innerHTML = ''; });
  document.getElementById('metadataSaveBtn').addEventListener('click', () => {
    const editor = document.getElementById('metadataEditor');
    const title = editor.querySelector('[name="title"]').value.trim();
    if (!title) {
      toast('Title is required.');
      return;
    }
    const tags = normalizeTagList(metaPicker ? metaPicker.getTags() : []);
    saveMetadata(promptId, {
      title: title,
      description: editor.querySelector('[name="description"]').value,
      reproPrompt: editor.querySelector('[name="reproPrompt"]').value,
      devNotes: editor.querySelector('[name="devNotes"]').value,
      tags: tags,
      license: editor.querySelector('[name="license"]').value.trim() || p.license,
      model: editor.querySelector('[name="model"]').value
    });
  });
  mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveMetadata(promptId, fields) {
  const p = prompts.find(x => x.id === promptId);
  if (!p) return;
  // Apply locally first so the UI feels instant; revert on failure.
  const prev = { title: p.title, description: p.description, reproPrompt: p.reproPrompt, devNotes: p.devNotes, tags: p.tags, license: p.license, model: p.model, tag: p.tag };
  p.title = fields.title;
  p.description = fields.description;
  p.reproPrompt = fields.reproPrompt;
  p.devNotes = fields.devNotes;
  p.tags = fields.tags;
  p.tag = fields.tags[0] || p.tag;
  p.license = fields.license;
  p.model = fields.model;
  saveData(prompts);
  const saveBtn = document.getElementById('metadataSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
  try {
    await updatePromptMetadataOnGitHub(p);
    toast('Saved metadata — Pages may take a minute to refresh');
    renderDetail(promptId);
  } catch (err) {
    console.error('Metadata save failed:', err);
    // Revert local state
    Object.assign(p, prev);
    saveData(prompts);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save metadata'; }
    alert('Save failed: ' + err.message);
  }
}

async function saveNewVersion(promptId, fields) {
  const p = prompts.find(x => x.id === promptId);
  if (!p) return;

  // Snapshot for revert-on-failure
  const prevState = JSON.stringify({ versions: p.versions, systemPrompt: p.systemPrompt, userPrompt: p.userPrompt, context: p.context, model: p.model, html: p.html, date: p.date });

  // If no versions yet, seed v1 from current state first
  const seededV1 = !p.versions || !p.versions.length;
  if (seededV1) {
    p.versions = [{
      v: 1,
      date: p.date,
      model: p.model,
      systemPrompt: p.systemPrompt || '',
      userPrompt: p.userPrompt || '',
      context: p.context || '',
      variables: p.variables ? JSON.parse(JSON.stringify(p.variables)) : [],
      html: p.html,
      changelog: 'Initial version.'
    }];
  }

  const nextV = p.versions[p.versions.length - 1].v + 1;
  const prevHtml = p.versions[p.versions.length - 1].html;
  const newVersion = {
    v: nextV,
    date: new Date().toISOString().slice(0, 10),
    model: fields.model,
    systemPrompt: fields.systemPrompt,
    userPrompt: fields.userPrompt,
    context: fields.context,
    variables: p.variables ? JSON.parse(JSON.stringify(p.variables)) : [],
    html: fields.html || prevHtml,
    changelog: fields.changelog
  };
  p.versions.push(newVersion);
  syncTopLevelFromLatest(p);
  saveData(prompts);
  toast(`Saved v${nextV} locally — "${fields.changelog.slice(0, 40)}${fields.changelog.length > 40 ? '…' : ''}"`);
  renderDetail(promptId);

  // Push to GitHub if owner — uploads any missing per-version HTML files and re-PUTs manifest.
  if (isOwner()) {
    try {
      await syncVersionsToGitHub(p);
      toast(`v${nextV} pushed to GitHub — Pages may take a minute to refresh`);
    } catch (err) {
      console.error('Version push failed:', err);
      // Revert local state on push failure so the local view doesn't drift from remote.
      const prev = JSON.parse(prevState);
      Object.assign(p, prev);
      saveData(prompts);
      renderDetail(promptId);
      alert('Push to GitHub failed: ' + err.message + '\n\nLocal changes reverted to match remote.');
    }
  }
}

// Upload any per-version HTML files that aren't on GitHub yet, then re-PUT the manifest.
async function syncVersionsToGitHub(prompt) {
  if (!prompt.versions || !prompt.versions.length) return;
  for (const v of prompt.versions) {
    const vNum = v.v;
    const path = 'htmls/' + prompt.id + '_v' + vNum + '.html';
    const existing = await ghGetSha(path);
    if (!existing) {
      const cleaned = cleanupHtml(v.html || '');
      v.html = cleaned;
      await ghPutFile(path, cleaned, 'Prompton: add ' + prompt.id + ' v' + vNum + ' html', null);
    }
  }
  // Keep the top-level htmls/<id>.html in sync with the latest version's HTML.
  const latestHtml = cleanupHtml(prompt.versions[prompt.versions.length - 1].html || '');
  prompt.versions[prompt.versions.length - 1].html = latestHtml;
  const topPath = 'htmls/' + prompt.id + '.html';
  const topSha = await ghGetSha(topPath);
  await ghPutFile(topPath, latestHtml, 'Prompton: refresh top-level html for ' + prompt.id, topSha);
  // The Thumbnails workflow regenerates the JPG and patches `thumb`/`thumbVer`
  // into the manifest on the htmls/* push above — no client-side step needed.
  await updatePromptMetadataOnGitHub(prompt);
}

// ── Template substitution helpers ──
function substitute(text, variables, values) {
  if (!text) return '';
  let out = text;
  (variables || []).forEach(v => {
    const val = (values && values[v.key] !== undefined) ? values[v.key] : v.default;
    out = out.split('{{' + v.key + '}}').join(val);
  });
  return out;
}
// Render with HTML-escaped output, highlighting substituted values in <span class="subst">
function renderTemplateWithValues(text, variables, values) {
  if (!text) return '';
  // Tokenize: split on {{KEY}} markers from the variables list only
  const keys = (variables || []).map(v => v.key);
  if (!keys.length) return escapeHtml(text);
  const pattern = new RegExp('\\{\\{(' + keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\}\\}', 'g');
  let result = '';
  let lastIdx = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIdx, m.index));
    const key = m[1];
    const v = variables.find(x => x.key === key);
    const val = (values && values[key] !== undefined) ? values[key] : (v ? v.default : '');
    result += `<span class="subst" data-key="${escapeAttr(key)}">${escapeHtml(val)}</span>`;
    lastIdx = m.index + m[0].length;
  }
  result += escapeHtml(text.slice(lastIdx));
  return result;
}
// Initial render uses defaults
function renderTemplate(text, variables) {
  return renderTemplateWithValues(text, variables, null);
}

// ─── Fork ───
// Forks no longer create local drafts. Instead: download the parent HTML so
// the user can edit it in their own editor, then come back and Upload the
// edited file as a new prompt. The parent id is stashed in sessionStorage so
// the next successful upload picks it up as parentId.
function forkPrompt(parent) {
  if (!parent) return;
  // 1. Download the parent's HTML
  try {
    const blob = new Blob([parent.html || ''], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = safeFilename(parent);
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { console.warn('Fork download failed:', e); }
  // 2. Stash parent for the upcoming upload + pre-fill the form
  try { sessionStorage.setItem('prompton_fork_parent', parent.id); } catch (e) {}
  prefillUploadFormFromParent(parent);
  // 3. Switch to upload view
  showView('upload');
  setRoute('upload');
  toast(`Downloaded "${parent.title}" — edit it, then drop the new file above to publish your remix.`);
}

// Pre-fill the upload form with the parent's prompt text, description, tags,
// model, and a "(remix)" title suffix. Called after `forkPrompt`.
function prefillUploadFormFromParent(parent) {
  const titleInput = document.getElementById('titleInput');
  if (titleInput) titleInput.value = (parent.title || '') + ' (remix)';
  const descInput = document.querySelector('#uploadForm input[name="description"]');
  if (descInput) descInput.value = parent.description || '';
  const modelSel = document.querySelector('#uploadForm select[name="model"]');
  if (modelSel && parent.model) modelSel.value = parent.model;
  const licSel = document.querySelector('#uploadForm select[name="license"]');
  if (licSel && parent.license) licSel.value = parent.license;
  const promptTA = document.getElementById('quickPromptField');
  if (promptTA) {
    const parts = [];
    if (parent.systemPrompt) parts.push('[SYSTEM]\n' + parent.systemPrompt);
    if (parent.userPrompt)   parts.push('[USER]\n'   + parent.userPrompt);
    if (parent.context)      parts.push('[CONTEXT]\n'+ parent.context);
    promptTA.value = parts.join('\n\n');
  }
  if (window._uploadTagPicker && Array.isArray(parent.tags)) {
    window._uploadTagPicker.setTags(parent.tags);
  }
  // Open the Advanced details so the pre-filled tags/description are visible.
  const adv = document.querySelector('.upload-advanced');
  if (adv) adv.open = true;
}

// ─── Profile ───
function getMostProlificAuthor() {
  const counts = {};
  prompts.forEach(p => { counts[p.author] = (counts[p.author] || 0) + 1; });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}
function renderProfile(handle, tab) {
  const profile = getProfile(handle);
  if (!profile) return;
  setRoute('profile/' + handle);
  window._currentProfileHandle = handle;
  const mine = prompts.filter(p => p.author === handle);
  const me_h = ownerHandle();
  const isYou = handle === me_h;
  const youFollow = !isYou && isFollowing(me_h, handle);
  const totalDl = mine.reduce((s, p) => s + (p.downloads || 0), 0);
  const totalFk = mine.reduce((s, p) => s + (p.forks || 0), 0);
  const activeTab = tab || 'published';

  const websiteDisplay = (profile.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const websiteHref = profile.website && !/^https?:\/\//.test(profile.website) ? 'https://' + profile.website : profile.website;

  const el = document.getElementById('profileContent');
  el.innerHTML = `
    <div class="profile-page">
      <div class="profile-header-v2">
        <div class="avatar-large" ${profile.avatar ? 'style="background-image:url(' + escapeAttr(profile.avatar) + ')"' : ''}>
          ${profile.avatar ? '' : escapeHtml(profile.name.charAt(0).toUpperCase())}
        </div>
        <div class="profile-info">
          <h1>${escapeHtml(profile.name)}</h1>
          <div class="handle">@${escapeHtml(handle)}</div>
          ${profile.bio ? `<p class="bio">${escapeHtml(profile.bio)}</p>` : ''}
          <div class="profile-meta">
            ${profile.location ? `<span>· ${escapeHtml(profile.location)}</span>` : ''}
            ${profile.website ? `<span>↗ <a href="${escapeAttr(websiteHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(websiteDisplay)}</a></span>` : ''}
            ${isYou && profile.email ? `<span>✉ ${escapeHtml(profile.email)}</span>` : ''}
            <span>· Joined ${formatDate(profile.joined)}</span>
          </div>
        </div>
        <div class="profile-actions">
          ${isYou
            ? '<button class="btn secondary" id="editProfileBtn">✎ Edit profile</button>'
            : '<button class="btn ' + (youFollow ? 'secondary' : 'primary') + '" id="followBtn">' + (youFollow ? '✓ Following' : '+ Follow') + '</button>'}
        </div>
      </div>

      <div class="profile-stats-v2">
        <button type="button" class="stat-card ${activeTab === 'published' ? 'active' : ''}" data-tab="published">
          <div class="num">${mine.length}</div>
          <div class="lbl">${escapeHtml(t('profile.published'))}</div>
        </button>
        ${isYou ? `
        <button type="button" class="stat-card ${activeTab === 'favorites' ? 'active' : ''}" data-tab="favorites">
          <div class="num">${formatNum(favorites.length)}</div>
          <div class="lbl">${escapeHtml(t('profile.favorites'))}</div>
        </button>` : `
        <div class="stat-card non-tab">
          <div class="num">${formatNum(totalDl)}</div>
          <div class="lbl">${escapeHtml(t('profile.downloads'))}</div>
        </div>`}
        <button type="button" class="stat-card ${activeTab === 'followers' ? 'active' : ''}" data-tab="followers">
          <div class="num">${profile.followers.length}</div>
          <div class="lbl">${escapeHtml(t('profile.followers'))}</div>
        </button>
        <button type="button" class="stat-card ${activeTab === 'following' ? 'active' : ''}" data-tab="following">
          <div class="num">${profile.following.length}</div>
          <div class="lbl">${escapeHtml(t('profile.following'))}</div>
        </button>
        <div class="stat-card non-tab">
          <div class="num">${formatNum(totalFk)}</div>
          <div class="lbl">${escapeHtml(t('profile.forks'))}</div>
        </div>
      </div>

      <div class="profile-tab-content" id="profileTabContent"></div>
    </div>
  `;

  // Wire actions
  if (isYou) {
    const eb = document.getElementById('editProfileBtn');
    if (eb) eb.addEventListener('click', () => openEditProfileModal());
  } else {
    const fb = document.getElementById('followBtn');
    if (fb) fb.addEventListener('click', () => {
      toggleFollow(handle);
      renderProfile(handle, activeTab);
    });
  }
  el.querySelectorAll('.stat-card[data-tab]').forEach(b =>
    b.addEventListener('click', () => renderProfileTab(handle, b.dataset.tab))
  );

  renderProfileTab(handle, activeTab);
  showView('profile');
}

function renderProfileTab(handle, tab) {
  const profile = getProfile(handle);
  const el = document.getElementById('profileTabContent');
  document.querySelectorAll('.stat-card[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  if (tab === 'published') {
    const mine = prompts.filter(p => p.author === handle);
    if (!mine.length) {
      el.innerHTML = '<div class="empty-state">No prompts published yet.</div>';
      return;
    }
    el.innerHTML = '<div class="grid" id="profileGrid"></div>';
    const grid = el.querySelector('#profileGrid');
    mine.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card';
      const knobsBadge = p.variables && p.variables.length ? `<span class="knobs-badge">⚙ ${p.variables.length} knobs</span>` : '';
      const versionBadge = p.versions && p.versions.length >= 2 ? `<span class="v-badge">v${p.versions.length}</span>` : '';
      card.innerHTML = `
        <div class="thumb-wrap">
          <iframe class="thumb"${promptPreviewAttrs(p)} sandbox="" scrolling="no" tabindex="-1"></iframe>
        </div>
        <div class="meta-top"><span>${formatDate(p.date)}</span><span>${escapeHtml(p.model)}</span></div>
        <h3>${escapeHtml(p.title)}</h3>
        <div class="stats">
          <span><b>${formatNum(p.downloads)}</b> downloads</span>
          <span><b>${p.forks}</b> forks</span>
          ${versionBadge}${knobsBadge}
        </div>
      `;
      card.addEventListener('click', () => renderDetail(p.id));
      grid.appendChild(card);
    });
  } else if (tab === 'followers') {
    el.innerHTML = renderUserList(profile.followers, 'No followers yet.');
    wireUserList(el, handle);
  } else if (tab === 'following') {
    el.innerHTML = renderUserList(profile.following, 'Not following anyone yet.');
    wireUserList(el, handle);
  } else if (tab === 'favorites') {
    // Owner-only tab. Favorites live in localStorage so they're naturally
    // private — only show on the viewer's own profile.
    if (handle !== ownerHandle()) { el.innerHTML = ''; return; }
    const mineFavs = favorites
      .map(id => prompts.find(x => x.id === id))
      .filter(Boolean);
    if (!mineFavs.length) {
      el.innerHTML = '<div class="empty-state">' + escapeHtml(t('profile.favoritesEmpty')) + '</div>';
      return;
    }
    el.innerHTML = '<div class="grid" id="profileGrid"></div>';
    const grid = el.querySelector('#profileGrid');
    mineFavs.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card';
      const thumbInner = p.thumb
        ? `<img class="thumb-img" loading="lazy" decoding="async" src="${escapeAttr(thumbUrl(p))}" alt="">`
        : `<iframe class="thumb"${promptPreviewAttrs(p)} sandbox="" scrolling="no" tabindex="-1"></iframe>`;
      card.innerHTML = `
        <div class="thumb-wrap">${thumbInner}</div>
        <div class="meta-top"><span>${formatDate(p.date)}</span><span>${escapeHtml(p.model)}</span></div>
        <h3>${escapeHtml(p.title)}</h3>
        <div class="by">by <span data-author="${p.author}">${escapeHtml(p.authorName)}</span></div>
      `;
      card.addEventListener('click', () => renderDetail(p.id));
      grid.appendChild(card);
    });
  }
}

function renderUserList(handles, emptyMsg) {
  if (!handles.length) return '<div class="empty-state">' + escapeHtml(emptyMsg) + '</div>';
  return '<div class="user-list">' + handles.map(h => {
    const p = getProfile(h);
    const me_h = ownerHandle();
    const youFollow = isFollowing(me_h, h);
    const isMe = h === me_h;
    const bioPreview = p.bio ? (p.bio.length > 80 ? p.bio.substring(0, 80) + '…' : p.bio) : '';
    return '<div class="user-item">' +
      '<div class="avatar-mini" data-go="' + escapeAttr(h) + '"' + (p.avatar ? ' style="background-image:url(' + escapeAttr(p.avatar) + ')"' : '') + '>' +
        (p.avatar ? '' : escapeHtml(p.name.charAt(0).toUpperCase())) +
      '</div>' +
      '<div class="user-info" data-go="' + escapeAttr(h) + '">' +
        '<div class="user-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="user-handle">@' + escapeHtml(h) + (bioPreview ? ' · ' + escapeHtml(bioPreview) : '') + '</div>' +
      '</div>' +
      (isMe ? '<span style="font-family:JetBrains Mono,monospace;font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.08em">YOU</span>' :
        '<button class="btn-follow ' + (youFollow ? 'following' : '') + '" data-follow="' + escapeAttr(h) + '">' + (youFollow ? '✓ Following' : '+ Follow') + '</button>') +
    '</div>';
  }).join('') + '</div>';
}

function wireUserList(container, currentHandle) {
  container.querySelectorAll('[data-go]').forEach(el =>
    el.addEventListener('click', () => renderProfile(el.dataset.go))
  );
  container.querySelectorAll('[data-follow]').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFollow(btn.dataset.follow);
      // Re-render current profile view + active tab
      if (window._currentProfileHandle) {
        const activeTab = document.querySelector('.stat-card[data-tab].active');
        renderProfile(window._currentProfileHandle, activeTab ? activeTab.dataset.tab : 'followers');
      }
    })
  );
}

// ─── Edit Profile modal ───
function openEditProfileModal() {
  const me_h = ownerHandle();
  const profile = getProfile(me_h);
  if (!profile) return;

  // Remove any existing modal
  const existing = document.getElementById('profileModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'profile-modal-overlay';
  overlay.id = 'profileModal';
  overlay.innerHTML =
    '<div class="profile-modal-content">' +
      '<h2>Edit profile</h2>' +
      '<div class="avatar-edit-row">' +
        '<div class="avatar-large" id="editAvatarPreview"' + (profile.avatar ? ' style="background-image:url(' + escapeAttr(profile.avatar) + ')"' : '') + '>' +
          (profile.avatar ? '' : escapeHtml(profile.name.charAt(0).toUpperCase())) +
        '</div>' +
        '<div class="avatar-edit-actions">' +
          '<button type="button" class="btn secondary" id="changeAvatarBtn">✎ Change avatar</button>' +
          '<button type="button" class="btn-cancel" id="removeAvatarBtn" style="' + (profile.avatar ? '' : 'display:none') + '">× Remove avatar</button>' +
          '<input type="file" id="avatarFileInput" accept="image/*" style="display:none">' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>Display name <span style="color:var(--tomato)">*</span></label>' +
        '<input type="text" id="editName" value="' + escapeAttr(profile.name) + '" placeholder="Your name" maxlength="80">' +
      '</div>' +
      '<div class="field">' +
        '<label>Username <span style="text-transform:none;letter-spacing:0;font-style:italic;color:var(--ink-soft)">(lowercase, 3–20 chars · changes @handle everywhere)</span></label>' +
        '<input type="text" id="editHandle" value="' + escapeAttr(me_h) + '" placeholder="yourname" maxlength="20" pattern="^[a-z0-9_.-]{3,20}$" autocapitalize="off" autocomplete="off">' +
      '</div>' +
      '<div class="field">' +
        '<label>Bio <span style="text-transform:none;letter-spacing:0;font-style:italic;color:var(--ink-soft)">(max 160 chars)</span></label>' +
        '<textarea id="editBio" placeholder="Tell readers about yourself" maxlength="160">' + escapeHtml(profile.bio) + '</textarea>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field">' +
          '<label>Email<span class="private">(private)</span></label>' +
          '<input type="email" id="editEmail" value="' + escapeAttr(profile.email) + '" placeholder="you@example.com">' +
        '</div>' +
        '<div class="field">' +
          '<label>Location</label>' +
          '<input type="text" id="editLocation" value="' + escapeAttr(profile.location) + '" placeholder="City, Country">' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>Website</label>' +
        '<input type="url" id="editWebsite" value="' + escapeAttr(profile.website) + '" placeholder="https://yoursite.com">' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn primary" id="saveProfileBtn">Save changes</button>' +
        '<button type="button" class="btn-cancel" id="cancelEditBtn">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  let stagedAvatar = profile.avatar;

  // Click outside content closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeProfileModal();
  });

  // Avatar upload
  document.getElementById('changeAvatarBtn').addEventListener('click', () => {
    document.getElementById('avatarFileInput').click();
  });
  document.getElementById('avatarFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
        stagedAvatar = canvas.toDataURL('image/jpeg', 0.85);
        const preview = document.getElementById('editAvatarPreview');
        preview.style.backgroundImage = 'url(' + stagedAvatar + ')';
        preview.textContent = '';
        document.getElementById('removeAvatarBtn').style.display = '';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('removeAvatarBtn').addEventListener('click', () => {
    stagedAvatar = null;
    const preview = document.getElementById('editAvatarPreview');
    preview.style.backgroundImage = '';
    const nameVal = document.getElementById('editName').value.trim() || 'Y';
    preview.textContent = nameVal.charAt(0).toUpperCase();
    document.getElementById('removeAvatarBtn').style.display = 'none';
  });

  document.getElementById('cancelEditBtn').addEventListener('click', closeProfileModal);

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const newName = document.getElementById('editName').value.trim();
    if (!newName) { toast('Display name is required.'); document.getElementById('editName').focus(); return; }

    profile.name = newName;
    profile.bio = document.getElementById('editBio').value.trim();
    profile.email = document.getElementById('editEmail').value.trim();
    profile.location = document.getElementById('editLocation').value.trim();
    profile.website = document.getElementById('editWebsite').value.trim();
    profile.avatar = stagedAvatar;

    saveProfiles();

    // Propagate name change to all of user's prompts
    prompts.forEach(p => {
      if (p.author === me_h) p.authorName = newName;
    });
    saveData(prompts);

    // Username (handle) change is a multi-file rewrite — gated on validation
    // and committed via renameOwnerHandle. Local-only when no PAT configured.
    const newHandleRaw = document.getElementById('editHandle').value.trim().toLowerCase();
    const newHandle = newHandleRaw || me_h;
    if (newHandle !== me_h) {
      const handleErr = validateNewHandle(newHandle);
      if (handleErr) { toast(handleErr); document.getElementById('editHandle').focus(); return; }
      closeProfileModal();
      toast('Renaming ' + me_h + ' → ' + newHandle + '…');
      try {
        await renameOwnerHandle(me_h, newHandle);
        toast('✓ Renamed to @' + newHandle);
      } catch (err) {
        console.warn('Rename failed:', err);
        toast('Rename failed — see console.');
      }
      renderProfile(ownerHandle());
      return;
    }

    closeProfileModal();
    toast('Profile saved.');
    renderProfile(me_h);
  });

  // Auto-focus the name field
  setTimeout(() => { const n = document.getElementById('editName'); if (n) n.focus(); }, 50);
}

function closeProfileModal() {
  const m = document.getElementById('profileModal');
  if (m) m.remove();
}
