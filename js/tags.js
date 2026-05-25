// Prompton — tag system: alias map, picker UI, curation/derivation,
// Settings curation panel.
// Loaded as a regular <script src> before the inline bootstrap, so every
// function below becomes a global. Depends on (defined elsewhere):
// prompts, escapeHtml, escapeAttr, toast.

let tagConfig = { curated: [], aliases: {} };

// ─── Tag normalization ───
// Apply alias map to a single tag. Unknown tags pass through unchanged.
function normalizeTag(t) {
  if (!t) return t;
  const trimmed = String(t).trim();
  if (!trimmed) return trimmed;
  return (tagConfig.aliases && tagConfig.aliases[trimmed]) || trimmed;
}
// Pill-based tag picker. Replaces the comma-text input + chip-row combo.
//
// Layout:
//   <div class="tag-picker" id="<containerId>">
//     <div class="tag-picker-pills"></div>   ← selected pills + inline input
//     <div class="tag-picker-suggest"></div> ← curated/past suggestions
//   </div>
//
// Behaviour:
//   - Selected tags render as pills with an × button
//   - Inline input accepts Enter, comma, or Tab to commit current text as a pill
//   - Backspace on empty input removes the last pill
//   - Suggestion chips show curated + past tags that aren't selected or
//     intentionally removed this session; click adds to selection
//   - Returns an API: { getTags(), setTags(arr), addTag(t), removeTag(t) }
function mountTagPicker(containerId, initialTags, opts) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  opts = opts || {};
  let selected = (initialTags || []).map(normalizeTag).filter(Boolean);
  // Dedupe initial
  selected = [...new Set(selected)];
  const removed = new Set();

  container.classList.add('tag-picker');
  container.innerHTML = `
    <div class="tag-picker-pills" data-tp-pills></div>
    <div class="tag-picker-suggest" data-tp-suggest></div>
  `;
  const pillsEl = container.querySelector('[data-tp-pills]');
  const suggestEl = container.querySelector('[data-tp-suggest]');

  const renderPills = () => {
    const inputVal = pillsEl.querySelector('input')?.value || '';
    pillsEl.innerHTML = selected.map(t =>
      `<span class="tag-pill"><span class="t">${escapeHtml(t)}</span><button type="button" class="x" data-rm-pill="${escapeAttr(t)}" aria-label="Remove ${escapeAttr(t)}">×</button></span>`
    ).join('') + `<input type="text" class="tag-picker-input" placeholder="${selected.length ? '' : 'add a tag…'}" autocomplete="off">`;
    const inp = pillsEl.querySelector('input');
    inp.value = inputVal;
  };

  const renderSuggest = () => {
    const curatedSet = new Set(tagConfig.curated || []);
    const past = new Set();
    prompts.forEach(p => {
      if (p.tag) past.add(normalizeTag(p.tag));
      if (Array.isArray(p.tags)) p.tags.forEach(t => past.add(normalizeTag(t)));
    });
    const selSet = new Set(selected);
    const ordered = [
      ...(tagConfig.curated || []).filter(t => !selSet.has(t) && !removed.has(t)),
      ...[...past].filter(t => t && !curatedSet.has(t) && !selSet.has(t) && !removed.has(t)).sort()
    ];
    suggestEl.innerHTML = ordered.length
      ? '<span class="tag-picker-label">Suggested:</span>' + ordered.map(t => {
          const curated = curatedSet.has(t);
          return `<button type="button" class="curated-chip${curated ? ' curated' : ''}" data-tp-add="${escapeAttr(t)}">+ ${escapeHtml(t)}</button>`;
        }).join('')
      : '';
  };

  const refresh = () => { renderPills(); renderSuggest(); if (opts.onChange) opts.onChange(selected.slice()); };

  const addTag = (raw) => {
    const t = normalizeTag(String(raw || '').trim());
    if (!t) return;
    if (selected.includes(t)) return;
    selected.push(t);
    removed.delete(t);
    refresh();
    // Refocus input
    pillsEl.querySelector('input')?.focus();
  };
  const removeTag = (t) => {
    const i = selected.indexOf(t);
    if (i < 0) return;
    selected.splice(i, 1);
    removed.add(t);
    refresh();
  };

  // Pills container: click on × removes pill; clicking anywhere else focuses input
  pillsEl.addEventListener('click', (e) => {
    const xBtn = e.target.closest('[data-rm-pill]');
    if (xBtn) { removeTag(xBtn.dataset.rmPill); return; }
    if (!e.target.matches('input')) {
      pillsEl.querySelector('input')?.focus();
    }
  });
  // Keydown on input: Enter / comma / Tab → commit; Backspace on empty → remove last
  pillsEl.addEventListener('keydown', (e) => {
    if (!e.target.matches('input')) return;
    const inp = e.target;
    if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && inp.value.trim())) {
      e.preventDefault();
      const v = inp.value.trim().replace(/,$/, '');
      if (v) addTag(v);
      inp.value = '';
    } else if (e.key === 'Backspace' && !inp.value && selected.length) {
      e.preventDefault();
      removeTag(selected[selected.length - 1]);
    }
  });
  // Blur on input: commit any pending text (so users don't lose it by clicking elsewhere)
  pillsEl.addEventListener('focusout', (e) => {
    if (!e.target.matches('input')) return;
    const v = e.target.value.trim();
    if (v) { addTag(v); e.target.value = ''; }
  });
  // Suggestion chip click: add
  suggestEl.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tp-add]');
    if (!chip) return;
    addTag(chip.dataset.tpAdd);
  });

  refresh();
  return {
    getTags: () => selected.slice(),
    setTags: (arr) => { selected = (arr || []).map(normalizeTag).filter(Boolean); selected = [...new Set(selected)]; refresh(); },
    addTag,
    removeTag
  };
}

// Render clickable chips for curated + previously-used tags into a mount,
// excluding tags already present in the linked input. Clicking a chip
// appends the tag to the input and re-renders.
// `excludeTags` (optional) hides those tags from the suggestions even if
// they're "past" tags — used by the metadata editor for the prompt's
// existing tags.
// Tags the user explicitly removes from the input mid-session are tracked
// in `removed` and stay excluded until they re-add them via a chip click
// or by typing the tag back in.
function mountCuratedTagChips(inputId, mountId, excludeTags) {
  const input = document.getElementById(inputId);
  const mount = document.getElementById(mountId);
  if (!input || !mount) return;
  const excluded = new Set((excludeTags || []).map(normalizeTag).filter(Boolean));
  const removed = new Set();
  const parseTags = (val) => new Set((val || '').split(',').map(s => normalizeTag(s.trim())).filter(Boolean));
  let lastTags = parseTags(input.value);
  const refresh = () => {
    const present = parseTags(input.value);
    const past = new Set();
    prompts.forEach(p => {
      if (p.tag) past.add(normalizeTag(p.tag));
      if (Array.isArray(p.tags)) p.tags.forEach(t => past.add(normalizeTag(t)));
    });
    const curatedSet = new Set(tagConfig.curated || []);
    const ordered = [
      ...(tagConfig.curated || []).filter(t => !present.has(t) && !excluded.has(t) && !removed.has(t)),
      ...[...past].filter(t => t && !curatedSet.has(t) && !present.has(t) && !excluded.has(t) && !removed.has(t)).sort()
    ];
    mount.innerHTML = ordered.map(t => {
      const isCurated = curatedSet.has(t);
      return `<button type="button" class="curated-chip${isCurated ? ' curated' : ''}" data-tag="${escapeAttr(t)}">+ ${escapeHtml(t)}</button>`;
    }).join('');
  };
  mount.addEventListener('click', (e) => {
    const chip = e.target.closest('.curated-chip');
    if (!chip) return;
    const tag = chip.dataset.tag;
    const cur = input.value.trim();
    input.value = cur ? (cur.replace(/,\s*$/, '') + ', ' + tag) : tag;
    // Re-adding via chip click clears the "I removed this" memory for that tag.
    removed.delete(tag);
    lastTags = parseTags(input.value);
    refresh();
  });
  input.addEventListener('input', () => {
    const cur = parseTags(input.value);
    // Anything that was in the input before and isn't now → user just removed it.
    for (const t of lastTags) if (!cur.has(t)) removed.add(t);
    // Anything in the input now that wasn't before → user just added it (typing).
    for (const t of cur) if (!lastTags.has(t)) removed.delete(t);
    lastTags = cur;
    refresh();
  });
  refresh();
}

function normalizeTagList(tags) {
  if (!Array.isArray(tags)) return tags;
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

// ─── Tag curation panel ───
// Return the set of tag names actually used by at least one prompt (after
// normalization so curated entries can be compared apples-to-apples).
function getUsedTagSet() {
  const used = new Set();
  (typeof prompts !== 'undefined' ? prompts : []).forEach(p => {
    if (p.tag) used.add(normalizeTag(p.tag));
    if (Array.isArray(p.tags)) p.tags.forEach(t => used.add(normalizeTag(t)));
  });
  return used;
}

// Auto-derive the sorted list of tags actually used by at least one prompt.
// This is the single source of truth for `tagConfig.curated` — no manual entry.
function deriveCuratedTags() {
  const used = getUsedTagSet();
  return Array.from(used).filter(Boolean).sort((a, b) => a.localeCompare(b));
}
// Per-tag usage count for the read-only display in Settings.
function getTagUsageCounts() {
  const counts = {};
  (typeof prompts !== 'undefined' ? prompts : []).forEach(p => {
    const seen = new Set();
    if (p.tag) seen.add(normalizeTag(p.tag));
    if (Array.isArray(p.tags)) p.tags.forEach(t => seen.add(normalizeTag(t)));
    seen.forEach(t => { if (t) counts[t] = (counts[t] || 0) + 1; });
  });
  return counts;
}

function renderTagCurationPanel() {
  const curatedHost = document.getElementById('curatedTagList');
  if (!curatedHost) return;
  const derived = deriveCuratedTags();
  const counts = getTagUsageCounts();
  // Keep in-memory tagConfig.curated in sync with what's actually in use, so
  // the upload tag picker reads from a clean, alias-normalized list.
  tagConfig.curated = derived;
  curatedHost.innerHTML = derived.length
    ? derived.map(t => `<span class="tag-pill" title="Used by ${counts[t] || 0} prompt${counts[t] === 1 ? '' : 's'}">${escapeHtml(t)} <span class="chip-count" style="opacity:.6;font-size:11px;margin-left:4px">${counts[t] || 0}</span></span>`).join('')
    : '<span style="color:var(--text-muted);font-style:italic;font-size:12px">No tags yet — tag a prompt to see it here.</span>';

  const aliasHost = document.getElementById('aliasList');
  if (!aliasHost) return;
  const entries = Object.entries(tagConfig.aliases || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    aliasHost.innerHTML = '<div class="empty">No aliases yet.</div>';
  } else {
    aliasHost.innerHTML = entries.map(([from, to]) =>
      `<div class="alias-row"><span class="from">${escapeHtml(from)}</span><span class="arrow">→</span><span class="to">${escapeHtml(to)}</span><button class="x" type="button" data-rm-alias="${escapeAttr(from)}" title="Remove">×</button></div>`
    ).join('');
  }
}
document.getElementById('aliasAddBtn').addEventListener('click', () => {
  const from = (document.getElementById('aliasFromInput').value || '').trim();
  const to = (document.getElementById('aliasToInput').value || '').trim();
  if (!from || !to) return;
  if (from === to) { toast('Alias from and to are the same.'); return; }
  tagConfig.aliases[from] = to;
  document.getElementById('aliasFromInput').value = '';
  document.getElementById('aliasToInput').value = '';
  renderTagCurationPanel();
});
document.getElementById('aliasList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rm-alias]');
  if (!btn) return;
  delete tagConfig.aliases[btn.dataset.rmAlias];
  renderTagCurationPanel();
});
