// Prompton — hash routing + view switching + share popover.
// Loaded as a regular <script src> before the inline bootstrap. Depends on
// (defined elsewhere): renderGallery, renderDetail, renderProfile,
// renderSettings, renderCompare, prompts, toast.

// ─── Routing ───
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  window.scrollTo({top:0, behavior:'instant'});
}
document.querySelectorAll('[data-nav]').forEach(el => {
  el.addEventListener('click', (e) => {
    const target = el.getAttribute('data-nav');
    if (target === 'gallery') renderGallery();
    if (target === 'upload') showView('upload');
    if (target === 'profile') renderProfile('you'); // Always YOUR profile from nav
    if (target === 'settings') renderSettings();
    if (target === 'rankings') renderRankings();
  });
});

// ─── Share popover ───
function shareLinkFor(prompt) {
  // Prefer the static OG card page (better link unfurl on LINE / X / Discord).
  // Strip any hash from current pathname, then append p/<id>/.
  // Local dev (file:// or http://localhost) doesn't have the static page yet,
  // so fall back to the SPA hash form there.
  const base = location.origin + location.pathname.replace(/#.*$/, '').replace(/[^/]*$/, '');
  if (location.hostname && location.hostname.endsWith('.github.io')) {
    return base + 'p/' + encodeURIComponent(prompt.id) + '/';
  }
  return base + '#/p/' + encodeURIComponent(prompt.id);
}
function openSharePopover(anchorBtn, prompt) {
  // Close any existing popover first
  document.querySelectorAll('.share-popover').forEach(el => el.remove());
  const url = shareLinkFor(prompt);
  const title = prompt.title || 'Prompton';
  const text = (prompt.description || '').slice(0, 200);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const pop = document.createElement('div');
  pop.className = 'share-popover';
  pop.innerHTML = `
    ${canNativeShare ? `<button type="button" data-act="native">📤 Share via…</button>` : ''}
    <button type="button" data-act="copy">⎘ Copy link</button>
    <a target="_blank" rel="noopener" href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}">💬 Share on LINE</a>
    <a target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}">𝕏 Share on X</a>
  `;
  document.body.appendChild(pop);

  // Position below the anchor button
  const rect = anchorBtn.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  // Keep within viewport on the right edge
  if (left + popRect.width > window.scrollX + document.documentElement.clientWidth - 8) {
    left = rect.right + window.scrollX - popRect.width;
  }
  pop.style.left = left + 'px';
  pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';

  pop.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'native') {
      try {
        await navigator.share({ title, text, url });
      } catch (err) { /* user cancelled or share failed; silent */ }
      pop.remove();
    } else if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch (err) { toast('Copy failed — link: ' + url); }
      pop.remove();
    }
  });

  // Close on outside click or Escape
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchorBtn) { pop.remove(); cleanup(); } };
  const onEsc = (e) => { if (e.key === 'Escape') { pop.remove(); cleanup(); } };
  const cleanup = () => { document.removeEventListener('click', onOutside); document.removeEventListener('keydown', onEsc); };
  setTimeout(() => { document.addEventListener('click', onOutside); document.addEventListener('keydown', onEsc); }, 0);
}

// ─── Hash routing ───
// Routes:
//   #/                        → gallery (default)
//   #/p/<id>                  → prompt detail
//   #/profile/<handle>        → profile
//   #/settings                → settings
//   #compare/<a>/<b>          → compare (legacy form, kept for backward compat)
function handleHashRoute() {
  const h = location.hash || '';
  const compareM = h.match(/^#compare\/([^/]+)\/([^/]+)$/);
  if (compareM) { renderCompare(compareM[1], compareM[2], null); return true; }
  const detailM = h.match(/^#\/p\/([^/]+)$/);
  if (detailM) {
    const id = detailM[1];
    if (prompts.find(x => x.id === id)) { renderDetail(id); return true; }
  }
  const profileM = h.match(/^#\/profile\/([^/]+)$/);
  if (profileM) { renderProfile(profileM[1]); return true; }
  if (h === '#/settings') { renderSettings(); return true; }
  if (h === '#/rankings') { renderRankings(); return true; }
  if (h === '#/rankings/forks') { renderRankings('forks'); return true; }
  if (h === '' || h === '#' || h === '#/') { renderGallery(); return true; }
  return false;
}
// Backward-compatible alias used at bootstrap.
function handleCompareHash() { return handleHashRoute(); }
// Update the URL hash without firing hashchange (replaceState is silent for
// hash-only updates, so internal navigation doesn't re-trigger the router).
function setRoute(path) {
  const target = '#/' + path.replace(/^#?\/?/, '');
  if (location.hash !== target) {
    try { history.replaceState(null, '', target); } catch (e) { location.hash = target; }
  }
}
window.addEventListener('hashchange', () => { handleHashRoute(); });
