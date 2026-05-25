# Prompton — Handoff for next Claude Code session

**Repo**: `morohami/prompton` (public) · **Live**: https://morohami.github.io/prompton/
**Local working copy**: `C:\Users\松村峻長\prompton\` (Windows / PowerShell 5.1, Japanese Windows)
**gh CLI**: authenticated as `morohami` (scopes: gist, read:org, repo, workflow)
**Dev server**: port 3459, name `prompton`, started via `mcp__Claude_Preview__preview_start`. Script at `C:\Users\松村峻長\.claude\serve-prompton.ps1` rooted at `$env:USERPROFILE\prompton\`.

## File layout (post-refactor)

The original single-file SPA has been split:

```
index.html      ~1,150 lines (HTML + bootstrap IIFE + theme/data helpers + Compare view + Settings handlers + fetchSeed)
css/main.css    ~3,650 lines (extracted from <style>)
js/github.js    ~450 lines  (GitHub API + thumbnail generation + ghBulkCommit)
js/render.js    ~1,650 lines (renderGallery, renderDetail, renderProfile, renderRankings, version editor, metadata editor, fork helpers)
js/upload.js    ~450 lines  (file drop, single + bulk upload, parsePromptBlocks)
js/tags.js      ~280 lines  (tagConfig, normalizeTag, mountTagPicker, deriveCuratedTags, renderTagCurationPanel)
js/router.js    ~120 lines  (hash routing, showView, share popover)
manifest.json   prompt metadata (no html field)
profiles.json   author profiles
tags.json       { curated: [], aliases: {...} } — curated is auto-derived on save
sw.js           service worker v4 — network-first for shell + css/js, cache-first for htmls/* + thumbs/*
404.html        rewrites clean URLs like /prompton/p/<id> → /prompton/#/p/<id>
htmls/<id>.html top-level prompt HTML (latest version)
htmls/<id>_v<n>.html  per-version HTML when versions[] exists
thumbs/<id>.jpg JPG snapshots (480px square, ~25KB)
p/<id>/index.html  OG/Twitter card pages with JS redirect to SPA
```

**Loading order in index.html**:
```html
<script src="js/github.js"></script>
<script src="js/render.js"></script>
<script src="js/tags.js"></script>
<script src="js/router.js"></script>
<script src="js/upload.js"></script>
<script> /* inline bootstrap */ </script>
```

All extracted files are regular `<script>` (not modules) so functions stay as globals — callers didn't change.

## Architecture rules

- **Bootstrap is async**: `fetchSeed()` runs before render. Don't put module-level code that reads `prompts` synchronously — it'll see `[]`.
- **Owner ops** gated by `isOwner()` (true when PAT + repo in localStorage `prompton_sync_v1`).
- **Hash routes**: `#/`, `#/p/<id>`, `#/profile/<handle>`, `#/settings`, `#/rankings`, `#/rankings/forks`. `setRoute()` uses `replaceState` so internal nav doesn't double-fire the router.
- **Tags**: `tagConfig.curated` is auto-derived from prompt usage via `deriveCuratedTags()` at bootstrap and on Save. Aliases stay manual (e.g. `ai → AI`).
- **Lazy thumbnails**: `mountAlbumThumbs` mounts iframe previews when JPG thumb is missing. When `p.thumb` is set (path string), the card renders `<img class="thumb-img">` instead — instant paint.
- **Live preview iframe** in detail view: assigned via `iframe.srcdoc = view.html` in JS (not inline attribute) to avoid mobile Safari + Chrome parser stalls on 70KB+ payloads.

## Recent work (sessions to date)

| Feature | Commit |
|---|---|
| JPG thumbnails (#1) | `0f2b0aa` |
| Remove draft flow (#2) | `69df76b` |
| Split GitHub layer to js/github.js (#3) | `b782d0f` |
| Bulk upload via Tree API (#4) | `b9dac7e` |
| Unused-curated-tag detector (#5) | `3325d1e` |
| Bulk upload moved into Share section + "Share prompton" rename | `34f2010` |
| Auto-derive tags, drop manual entry, junk-tag cleanup | `baf8911` |
| Extract CSS to css/main.css | `76dab88` |
| Extract render layer to js/render.js | `30e6819` |
| Extract upload/bulk to js/upload.js | `5e18457` |
| Extract tag system to js/tags.js | `f7d74c4` |
| Extract router to js/router.js | `3d6489c` |
| SW v4 + precache split shell | `9759f5e` |
| iframe.srcdoc → JS assignment | `b29d91c` |
| Rankings view + profile DL visible on mobile + tag input width | `7f4e484` |
| Responsive: nav stays 1-row on iPhone-mini | `3fb7cfd` |

## OPEN ASKS (with user decisions from final turn)

User confirmed in the migration message:
- **#5 mobile redesign**: **Instagram app風** (vertical scrolling feed, bottom-tab nav, full-bleed media)
- **#8 genre = playlist**: User-defined like Spotify playlists (so: any user creates a "playlist" / collection of prompts, gives it a name + color)
- **#10 @you rename**: `@chinchin` is the target new handle
- **#3 thumbnails via GitHub Actions + Playwright**: **YES, proceed**

### Pending items (all from one big feedback dump — see chat history above this handoff if available)

1. **Download/Fork counts must persist accurately**
   - Currently `p.downloads++` only updates memory + localStorage; not pushed to manifest. Lost on reload.
   - Owner-only fix is easy (PUT manifest on increment). True multi-user counts need backend (#4).

2. **Live preview slow / requires Open Standalone first**
   - Fix: switch detail iframe from `srcdoc=` to `src="htmls/<id>.html"`. Browser streams + parses faster. Same URL as standalone → guaranteed render.
   - Edit `js/render.js` around the `previewIframe.srcdoc =` line (added recently in detail render).

3. **Thumbnails: smarter pipeline** ⭐ **user said YES**
   - Add `.github/workflows/thumbnails.yml` that on push of `htmls/*.html`:
     - Uses Playwright headless Chrome
     - Loads each new/changed HTML, waits for network idle + ~2s
     - Screenshots 1280×1280 → WebP @ q=82
     - Commits `thumbs/<id>.webp` + updates manifest's `thumb` field
   - Then remove client-side html2canvas dependency (and Brave-shield problem from #14).
   - First implementation tip: trigger only on `htmls/*` changes, skip if manifest-only commit, use `[skip ci]` in bot commits.

4. **Account system** (multi-user)
   - GitHub OAuth via Cloudflare Pages Functions (free tier). Each user logs in, server holds the master PAT for writes, audits who wrote what.
   - Big lift; not started.

5. **Mobile redesign — Instagram app風** ⭐ user choice
   - Bottom tab nav: 🏠 Feed / 🔍 Search / ❤ Favorites / 👤 Profile / ＋ Share (center FAB)
   - Feed: vertical scroll, one prompt per row, large thumbnail (full-bleed width), title + author below, hearts + downloads on the right
   - Stories-bar at top showing recent uploads as circular avatars (optional)
   - Tap row → detail (slide-up modal)
   - Use `@media (max-width: 680px)` or a `body.mobile-app` class added via JS based on viewport + ua.

6. **Rankings: drop emoji** — change `🏆 Rankings` to just `Rankings` in nav (`index.html`) and the H1 in `renderRankings()` (`js/render.js`).

7. **i18n (Japanese)**
   - `i18n/ja.json` + `i18n/en.json` (key→value)
   - `t(key, vars)` helper, detects `navigator.language` first time, language toggle in Settings
   - Wrap every visible string — there are MANY. Start with: nav, gallery headers, filter bar, detail action buttons, profile stats, rankings, settings.

8. **Playlists / Genres** ⭐ user choice: user-defined like Spotify
   - New `playlists.json` (server-side state) — `{ id, name, color, owner, promptIds: [], cover?: string }`
   - New view `#/playlists` showing playlist tiles in colored grid
   - "+ New playlist" button (owner only)
   - Detail page `#/playlists/<id>` shows prompts in that playlist
   - "Add to playlist" button on prompt detail (owner only — needs auth from #4 for multi-user)
   - For solo use, localStorage-only mode works; for shared, push to repo.

9. **Favorites + replace profile "Downloads" with "Favorites"**
   - `localStorage` key: `prompton_favorites_v1: [id, id, ...]`
   - Heart button (filled = favorited) on card overlay + detail header
   - Profile stat card "Downloads" → "Favorites" with count = `favorites.length`
   - New profile tab "Favorites" listing those prompts
   - **Privacy**: localStorage is per-device so naturally private — no sharing logic needed yet
   - Note: this conflicts with #1 (which asked for download count display) — resolve by KEEPING download count in card stats but using FAVORITES as the profile headline metric.

10. **@you handle rename to @chinchin** ⭐ user choice
    - In Settings/profile editor, add a "Username" field (validation: `^[a-z0-9_.-]{3,20}$`, must not collide with existing handles in `profiles.json`)
    - On save: rewrite `profiles.json` (rename key from old handle to new), rewrite every `prompt.author === oldHandle` to new handle across manifest, push as one commit
    - Initial action for this user: change `you` → `chinchin` everywhere

11. **"+ Share a prompt" button → "Share a prompton"**
    - `index.html` line ~21: `<button class="btn-upload" data-nav="upload">＋ Share a prompton</button>`
    - Also: at ≤380px the button collapses to just `＋` via the mobile CSS rule.

12. **Color palette refresh** — Stanford / California / San Francisco vibe, both light + dark
    - Light: paper `#fafaf6`, ink `#1c1c20`, accent **Stanford Cardinal** `#8C1515`, gold `#c9a14a`, rule `#c4c4c2` (issue-line border needs to be darker than current)
    - Dark: bg `#0e1014` (Bay night), text `#e8e6e1`, accent `#b53a3a` (warm cardinal) or `#7a8b95` (SF fog), rule `#2a2e35`
    - Edit CSS variables at top of `css/main.css` (`:root, :root[data-theme="light"]` and `:root[data-theme="dark"]`)

13. **Stale thumbnails** — current thumbs sometimes show outdated content
    - Add `thumbVer` field to manifest entries (Date.now() on regen)
    - Card render: `src="${p.thumb}?v=${p.thumbVer || ''}"` to bust browser cache
    - Change SW from cache-first to stale-while-revalidate for `/thumbs/*` so fresh thumbs propagate within a refresh

14. **Brave compatibility**
    - Brave Shields blocks cdnjs.cloudflare.com by default → html2canvas load fails → thumbnail generation silently breaks → Brave users may see other issues too
    - Quick fix: download html2canvas 1.4.1 locally to `js/html2canvas.min.js`, change `loadHtml2Canvas()` in `js/github.js` to load from same origin
    - Better fix: ship #3 (Playwright workflow), then client never needs html2canvas

## Implementation order recommended for next session

**Phase A — Quick wins** (~30 min total):
- #11 button rename
- #6 drop emoji
- #2 iframe.srcdoc → iframe.src
- #12 palette refresh (CSS variables only)
- #13 thumb cache bust
- #14 html2canvas local copy (so Brave works today)

**Phase B — Solo user features** (~2 hours):
- #9 Favorites (with localStorage)
- #10 rename @you → @chinchin (one-shot rewrite + ongoing editable field)
- #7 i18n scaffolding (just `t()` + JP/EN toggle + translate visible strings)
- #1 download counter persistence (owner-only first)

**Phase C — Big lifts** (each is its own session):
- #3 GitHub Actions + Playwright thumbnails
- #5 Instagram-style mobile redesign
- #8 Playlists feature
- #4 OAuth multi-user backend

## Known operational notes

- `git pull --rebase origin main && git push origin main` is the standard publish loop after commits.
- Service worker v4 is current. Bump to v5 if shell assets change to force refresh.
- `_uploadTagPicker` is a global mounted at bootstrap. Calls: `.getTags()`, `.setTags([])`.
- `compareMode = true` no longer shows floating pill; selecting 2 cards auto-jumps to compare.
- `cleanupHtml(raw)` is the canonical HTML normalizer (BOM strip, CRLF→LF, comment strip, blank-line collapse).
- Any template literal that emits HTML containing `</script>` MUST use `const SC = '<' + '/script>'` — see `generateOGPageHtml` in `js/github.js` for the pattern.

## User preferences

- **Allow everything, NO permission prompts** — don't ask before write/edit/commit
- Japanese + English mixed — respond in Japanese when user writes in Japanese
- iPhone usage is real — mobile UX matters
- Wants honest opinions; first option in any list should be the recommendation
- Iterative shipping: small commits, verify in browser between changes

## Windows / PowerShell gotchas

- UTF-8 BOM for `.ps1` files with non-ASCII
- `2>&1` on native exes wraps stderr as `NativeCommandError` — don't redirect
- Bash tool's CWD doesn't persist between calls — chain commands or use `cd /c/Users/松村峻長/prompton && …`
- Git pull warns about LF→CRLF — harmless

## Verification workflow

1. Edit with `Edit` tool
2. Reload preview: `mcp__Claude_Preview__preview_eval` → `location.reload()`
3. If edits don't appear: unregister SW + clear caches:
   ```js
   (async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const c of await caches.keys()) await caches.delete(c); location.reload(); })()
   ```
4. Verify with `preview_eval` returning state JSON
5. `preview_console_logs` for errors
6. Commit + push: `cd /c/Users/松村峻長/prompton && git add <file> && git commit -m "..." && git pull --rebase origin main && git push origin main`

---

**Start the next session with**: read this file, confirm the phase A items are still wanted, then begin with #11 + #6 + #2 as the warm-up.
