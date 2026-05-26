# Prompton — Handoff for next Claude Code session

**Repo**: `morohami/prompton` (public) · **Live**: <https://morohami.github.io/prompton/>
**Local working copy**: `C:\Users\松村峻長\prompton\` (Windows / PowerShell 5.1)
**gh CLI**: authenticated as `morohami`
**Dev server**: port 3459, name `prompton`, started via `mcp__Claude_Preview__preview_start`.
Script at `C:\Users\松村峻長\.claude\serve-prompton.ps1` rooted at `$env:USERPROFILE\prompton\`.

## ⚠️ START HERE — open the live site in a real browser BEFORE coding

The previous session ended with two user-reported regressions that I could not
reproduce in the in-tool preview (the `preview_eval` viewport got stuck at
164px wide — likely a `mcp__Claude_Preview__preview_resize` artifact). Verify
each on a real device first:

1. **「コンテンツが消えた」** — gallery is blank after the most recent batch
   of changes.
2. **「設定ギアが動かない」** — clicking the ⚙ icon in the masthead doesn't
   open Settings.

### Where to look first

- **Open <https://morohami.github.io/prompton/> in Chrome + iPhone Safari**.
  DevTools Console → look for `Remote data fetch failed` or `Data hydration
  failed` warns from the bootstrap. If those appear, fetchSeed is throwing
  in production and `seedPrompts` stays empty.
- **`document.querySelectorAll('[data-nav]').length`** in console — confirms
  the wiring at `js/router.js:12` found the gear link. If 0, the script
  loaded before the DOM was ready or the masthead markup is missing.
- **`getComputedStyle(document.querySelector('[data-nav="settings"]'))`** —
  check `pointer-events`, `display`, `position`. If something overlaps the
  gear (z-index issue) it'll receive clicks instead.
- **Network tab on the live site** → confirm `manifest.json`, `profiles.json`,
  `tags.json`, `playlists.json`, `i18n/en.json`, `i18n/ja.json` all 200.

### Likely culprits to consider

- The masthead now hosts the search input in flex layout. CSS at
  `css/main.css:93` adds `flex-wrap: nowrap` + `flex-shrink: 0` on
  `.nav-actions` (defensive — landed in `279eee7`) but at narrow widths
  before `@media (max-width: 900px)` kicks in (which hides the search),
  the search could still push actions off-screen if `min-width: 0` isn't
  honored. Inspect at exactly 700–900px.
- `bootstrap` was hardened in `279eee7` to keep going on errors. If
  the gallery is empty even after that lands, the failure is upstream
  — likely a service-worker version mismatch. SW is currently `v7`
  in `sw.js`. If the user's installed SW is older, it may be serving
  a stale `index.html` that doesn't match the current JS.
- **Hard fix if needed**: bump SW version to v8, or have the user
  manually unregister: DevTools → Application → Service Workers →
  Unregister. Then hard-reload.

### Worst-case rollback

If you can't find the cause within ~15 minutes, revert the masthead
change cleanly:

```bash
# revert the inline-search masthead, keep the defensive bootstrap
git revert d955ed1 --no-edit
# OR: hard reset to the last known-good commit, then cherry-pick
# 279eee7 to keep the defensive bootstrap
git reset --hard 4170f70  # last verified-good commit (OAuth backend foundation)
git cherry-pick 279eee7
git push --force-with-lease origin main
```

This drops Instagram-style masthead + immediate-publish drafts + GitHub-URL
import + a few other features, but returns the gallery to a known-good state.
Then cherry-pick features back in one by one with verification.

---

## ✅ Local git is now clean (was diverged earlier)

The rebase conflict described in the previous draft of this file was
resolved during this session. Final state:

- `780b0f8 Add International 調整さん (8-bit & Elegant editions)` —
  applied via the pre-existing `780b0f8` commit (the rebase was aborted,
  and the local-only commit was pushed in a later commit chain).
- Fourier prompt (`p1779746643461`) — recovered after an accidental
  deletion in commit `6b4676b` (HANDOFF.md commit was made on a stale
  branch tree). Restored in commit `3a0b582` from `cb412f8`.
- Working tree is clean. `origin/main` and local `main` match.

Most recent commits at handoff time:

```
3a0b582 Restore Fourier prompt HTML + OG card
6b4676b HANDOFF.md: complete rewrite for next-session pickup
279eee7 Defensive: masthead never breaks layout, bootstrap never strands user
d955ed1 インスタ風: 検索を最上部・即投稿・GitHub URL対応・stories PC表示
```

The thumbnails workflow will auto-regenerate thumbs for any new prompts
on the next push to `htmls/**`. No client-side thumbnail step.

---

## Recent feature waves (most recent first)

| Wave | Highlights | Key commits |
|---|---|---|
| Defensive layer | `flex-shrink: 0` on `.nav-actions`, hide masthead search ≤900px, every bootstrap step wrapped in `try/catch`, `renderGallery()` always runs | `279eee7` |
| Instagram-style overhaul | Masthead hosts the search input, grey issue-line removed, tagline removed, brand dot removed, stories bar shown on all viewports, draft modal goes straight to publish (no "send to upload form" detour), GitHub URL import (raw / blob / gist) | `d955ed1` |
| Drafts / stories feature | Stories bar repurposed: shows local drafts (`prompton_drafts_v1`), tap → modal, "Claude paste" extracts the largest code-fence, supports save-only + publish + delete | `a599c43` |
| Mobile detail polish | iframe live-preview hidden on phones, full-bleed thumbnail with a Fullscreen / Open-standalone overlay; action row pinned to bottom with backdrop-blur | `a599c43` |
| Detail header trim | `by @handle · 5/26 · model` (was "by FullName · May 26, 2026 · Model · 2.1k downloads · 47 forks"), counts moved to a separate `.detail-counts` row | `a599c43` |
| Numbers + search + emoji | `formatNum` returns full locale-aware numbers (no 2.1k abbreviation), tag chips gone — replaced by an autocomplete `.search-suggest` dropdown, bottom-tab emoji icons removed | `98cd089` |
| Mobile polish round | PWA installable (`manifest.webmanifest` + SVG icons + theme-color), stories bar (initially mobile-only), sticky mobile detail action bar, workflow thumbnail compression to 640×640 q=72 | `7423df5` |
| OAuth backend foundation | `functions/` directory for Cloudflare Pages Functions: `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`, `/api/write`. Stateless HMAC session cookies. `OAUTH_SETUP.md` deployment guide. Client uses `/auth/me` to detect signed-in state. **Not yet wired to existing write paths.** | `4170f70` |
| Instagram-style mobile mode | `body.mobile-app` toggle via matchMedia, fixed bottom-tab nav, full-bleed single-column feed | `8aa84d7` |
| Playlists | `playlists.json` + new view + add-to-playlist popover on detail | `f42c42a` |
| Cleanup html2canvas | Deleted `js/html2canvas.min.js` (~200KB) + all client thumbnail code. Workflow owns thumbnails now | `cfc8dba` |
| Playwright thumbnail workflow | `.github/workflows/thumbnails.yml` + `.github/scripts/generate-thumbs.mjs`. On push to `htmls/**`, headless Chrome screenshots → `thumbs/<id>.jpg` → committed back with `[skip ci]` | `12aadf1` |

Earlier waves (Phase A/B/C) are documented in the original handoff git
history if needed.

---

## File layout (current)

```
index.html                ~1,500 lines — HTML + inline bootstrap + i18n helpers
                                       + profile/data/favorites/playlists/drafts
                                       state + Settings panel logic
css/main.css              ~4,000 lines — all styles incl. mobile-app overrides
js/github.js              ~520 lines  — GitHub API + ghBulkCommit + rename
                                       + bumpDownloadCountOnGitHub + push-
                                       PlaylistsToGitHub + pushPromptToGitHub
                                       (NO client thumbnail code — workflow owns it)
js/render.js              ~1,800 lines — renderGallery + renderDetail +
                                       renderProfile + renderRankings +
                                       renderPlaylists + renderStoriesBar
                                       (drafts) + openDraftEditorModal +
                                       openCreatePlaylistModal + version editor +
                                       metadata editor + thumbUrl + fork helpers
js/upload.js              ~440 lines  — single + bulk upload, parsePromptBlocks
                                       (no client thumbnails)
js/tags.js                ~280 lines  — tag config, normalize, picker
js/router.js              ~135 lines  — hash routing, [data-nav] click handlers
                                       (including search/favorites helpers)
i18n/en.json              EN strings
i18n/ja.json              JP strings
icons/icon.svg            PWA app icon (cardinal P)
icons/maskable.svg        Android maskable variant
manifest.webmanifest      PWA manifest
manifest.json             prompt metadata
profiles.json             author profiles
tags.json                 { curated, aliases }
playlists.json            user-defined collections
sw.js                     SW v7 — precaches shell + i18n + icons + playlists.json
404.html                  SPA hash rewrite
htmls/<id>.html           top-level prompt HTML (latest version)
htmls/<id>_v<n>.html      per-version HTML (when versions[] exists)
thumbs/<id>.jpg           workflow-generated thumbnail (640×640 q=72)
p/<id>/index.html         OG/Twitter card with JS redirect to SPA
.github/workflows/thumbnails.yml   Playwright workflow
.github/scripts/generate-thumbs.mjs
functions/_utils.ts                HMAC session helpers
functions/auth/{login,callback,logout,me}.ts
functions/api/write.ts             Auth-gated GitHub Contents proxy
OAUTH_SETUP.md            CF Pages deployment guide
```

**Loading order in `index.html`**:

```html
<script src="js/github.js"></script>
<script src="js/render.js"></script>
<script src="js/tags.js"></script>
<script src="js/router.js"></script>
<script src="js/upload.js"></script>
<script> /* inline bootstrap incl. i18n, drafts, favorites, playlists */ </script>
```

All extracted files are regular `<script>` (not modules) so functions stay
globals.

---

## Architecture rules (still apply)

- **Bootstrap is async** — `fetchSeed()` then hydrate, then `renderGallery()`.
  Every step is now wrapped in `try/catch` so a partial failure can't strand
  the user on a blank screen (commit `279eee7`).
- **Owner ops** gated by `isOwner()` — true when PAT + repo are in localStorage
  (`prompton_sync_v1`).
- **Hash routes**: `#/`, `#/p/<id>`, `#/profile/<handle>`, `#/settings`,
  `#/rankings`, `#/rankings/forks`, `#/playlists`, `#/playlists/<id>`.
  `setRoute()` uses `replaceState` — internal nav doesn't re-fire the router.
- **Tags**: `tagConfig.curated` is auto-derived from prompt usage at
  bootstrap and on save. Aliases stay manual.
- **Thumbnails**: workflow only. No client-side generation. Manifest's
  `thumb` + `thumbVer` fields are written by `.github/scripts/generate-thumbs.mjs`.
- **i18n**: `t(key, vars)` is TDZ-safe — if `i18nDict` isn't initialized yet
  it returns the key. Locale files at `i18n/<locale>.json`. Toggle in Settings.
- **Mobile mode**: `body.mobile-app` is added when `matchMedia('(max-width: 680px)')`
  matches. Stories bar shows on every viewport now (overridden out of
  `body.mobile-app` scope in `d955ed1`).
- **Drafts**: `prompton_drafts_v1` in localStorage. Tap a story tile →
  `openDraftEditorModal`. Publish calls `publishDraftDirect(title, body)`
  which constructs a minimal prompt object and pushes to GitHub. Deletes
  the draft on success.
- **GitHub URL import**: `fetchFromGitHubUrl(url)` accepts raw, blob, and
  gist URLs. Used by the draft modal's "From GitHub URL" button.

---

## Known issues / open asks (from the most recent user feedback)

These are direct user quotes. Cross-reference with the verification steps in
"START HERE" above.

1. **🔴 「コンテンツが消えた」 / 「設定ギアが動かない」** — see top of file.
   Highest priority.

2. **「投稿できない」** — was reported earlier, was traced to the upload-form
   prefill bug. The fix was to bypass the upload form entirely and publish
   directly from the draft modal (`publishDraftDirect`). Verify this actually
   works end-to-end on the live site by:
   - Open the homepage
   - Tap the "+ 新規" tile in the stories bar
   - Paste an HTML snippet, give it a title
   - Tap "投稿" → should commit to GitHub, return to feed, and the new card
     should appear in the gallery (probably after a manifest refresh)

3. **「ストーリー：パソコンに表示されない」** — was reported earlier; the CSS
   was changed in `d955ed1` to remove the `body.mobile-app` scope so the
   stories bar shows on every viewport. Verify it actually renders on
   desktop now.

4. **「上部帯の灰色をやめよう」** — done in `d955ed1`: `.issue-line {
   display: none; }`. Verify nothing depends on `#issueDate` /
   `#issueCount` (those `<span>`s were removed from the markup).

5. **絵文字削除** — picture emoji are gone (🏠 🔍 ❤ 👤 🗑 ⇄ ♫). Typography
   glyphs (♥ ♡ ⑂ ＋ ↗ ↓ ⎘ ✎) still in detail buttons, card stats, etc.
   If the user wants those gone too, scrub `i18n/en.json` + `ja.json` +
   any inline JSX-style strings in `js/render.js`.

6. **Numbers are real numbers** — `formatNum` uses
   `Number.toLocaleString(currentLocale === 'ja' ? 'ja-JP' : 'en-US')`.
   No "2.1k" anywhere. Verify by visiting a prompt with high downloads
   (look at seeded profiles — Tomas Lind, Eleanor Rosa).

---

## What the next session should do, in order

1. **Reproduce in a real browser** the "blank gallery" + "settings gear
   dead" reports. Use Chrome desktop + iPhone Safari. Capture console
   warns / errors verbatim.
2. **Resolve the diverged local repo** — see "Local git is diverged"
   section. Decide with the user whether to:
   - Resolve the manifest conflict and keep both new sets of prompts,
   - Or drop the local `780b0f8` (the 8-bit + Elegant 調整さん) if the
     user already pushed them from somewhere else.
3. **Fix or revert** the masthead inline-search if it's the cause of
   the settings-gear regression.
4. **Verify drafts end-to-end** — paste an HTML snippet, hit 投稿,
   confirm a real prompt lands in the feed and on GitHub.
5. **Continue Instagram polish** — likely candidates:
   - Keyboard nav in the search suggest (↑/↓/Enter/Esc)
   - Pull-to-refresh on the mobile feed
   - Story viewer: tap a story tile → full-screen preview overlay (not
     just the edit modal)
   - Auto-save drafts as the user types (2-sec debounce)

---

## Operational notes (Windows / PowerShell / etc.)

- `cd /c/Users/松村峻長/prompton` first in bash sessions — the Bash tool's
  CWD doesn't persist between calls.
- Git pull warns about LF→CRLF — harmless.
- UTF-8 BOM for `.ps1` files with non-ASCII.
- `2>&1` on native exes wraps stderr as `NativeCommandError` — don't redirect.
- Don't skip hooks unless explicitly asked.
- **Commits should be plain text with no `<` characters in the heredoc
  body** — PowerShell will complain. Use `1280 -> 640` not `1280→640`
  inside `cat <<'EOF'`.

---

## User preferences (from earlier sessions, still apply)

- **Allow everything, no permission prompts** — don't ask before write/edit/commit.
- **Respond in Japanese** when the user writes in Japanese, and stay in
  Japanese for the rest of the conversation if explicitly asked to switch
  (see `~/.claude/projects/.../memory/feedback_language.md`).
- **iPhone usage is real** — mobile UX matters; verify on small viewports.
- **Honest opinions** — first option in any list should be the recommendation.
- **Iterative shipping** — small commits, verify in browser between changes.
- **Instagram is the explicit design north star** — "インスタグラムを完全に師
  と仰いで". Strip ornamentation aggressively.

---

## Verification workflow (still valid)

1. Edit with `Edit` / `Write` tools.
2. Reload preview: `mcp__Claude_Preview__preview_eval` → `location.reload()`.
3. If edits don't appear: unregister SW + clear caches:

   ```js
   (async () => {
     for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
     for (const c of await caches.keys()) await caches.delete(c);
     location.reload();
   })()
   ```

4. Verify with `preview_eval` returning state JSON.
5. `preview_console_logs` for errors.
6. Commit + push:

   ```bash
   cd /c/Users/松村峻長/prompton && git add <files> && \
     git commit -m "..." && \
     git pull --rebase origin main && \
     git push origin main
   ```

**⚠️ Caveat from this session**: `mcp__Claude_Preview__preview_resize`
seemed to stick the viewport at narrow widths (164px) even after resetting
to desktop. If the in-tool preview is misbehaving, trust a real browser
over the preview tool.

---

**Start the next session with**: open
<https://morohami.github.io/prompton/> in Chrome with DevTools open. Confirm
or refute the "blank gallery" + "dead settings gear" reports. Then proceed
through the "What the next session should do" list.
