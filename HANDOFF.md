# Prompton — Handoff for next session

**Repo**: `morohami/prompton` (public) · **Live**: <https://morohami.github.io/prompton/>
**Local working copy**: `C:\Users\松村峻長\prompton\` (Windows / PowerShell 5.1)
**gh CLI**: authenticated as `morohami`
**Dev server**: name `prompton`, port 3459, via the Browser-pane preview tool
(`preview_start {name:"prompton"}`). Script: `C:\Users\松村峻長\.claude\serve-prompton.ps1`.

_Last updated: 2026-07-16. No known open bugs. Working tree clean, local = origin/main._

---

## Vocabulary & branding rules (user decisions — follow these)

- **The unit of content is a "prompton"** (lowercase, Latin script even in
  Japanese copy). Gallery counts, playlists, rankings, tooltips all say
  prompton / promptons. Commit `f667aa0`.
- **"prompt" is reserved for the actual prompt text** — Prompt Anatomy,
  System prompt / User instruction blocks, copy-prompt buttons, version
  editor fields. Do not rename those.
- **No AI-vendor branding in site copy.** Works may be made with any AI, so
  taglines say "made with AI" / 「AIと作った」. Claude appears only as:
  (a) a factual option in the model pickers (alongside GPT / Gemini /
  DeepSeek; neutral "AI" is the first/default option), and (b) the
  functional "↗ Open in Claude.ai" button, which names its real
  destination the way "Share on LINE" does. New-prompton defaults use
  `model: 'AI'`.
- Site title: `Prompton — live promptons, made with AI`.
- Respond to the user in Japanese. Honest opinions; recommendation first.
- Instagram-informed minimalism, but the stories bar experiment is OVER
  (removed deliberately — don't bring it back).

## Security posture (established 2026-07-15/16 — do not regress)

- **All prompton-content iframes are sandboxed WITHOUT `allow-same-origin`**
  (`e1035c9`): detail preview, spotlight, compare L/R, upload preview.
  Prompton HTML runs in an opaque origin and cannot read localStorage
  (which holds the GitHub PAT). Gallery thumbs were already opaque.
  A prompton that itself uses localStorage will throw inside previews —
  known trade-off; standalone/fullscreen open unsandboxed in a new tab.
- **PAT field is `type="text"` + `-webkit-text-security` mask** with a
  表示/隠す toggle (`25b5b43`). Never change it back to `type=password` —
  iOS Safari's strong-password overlay made the field completely
  uneditable (user-reported bug).
- User uses a **fine-grained PAT** (Contents R/W, this repo only). The
  Settings hint links to the fine-grained creation page.
- A PAT was once pasted into the assistant chat and treated as leaked —
  the user rotated it. **Never ask for or echo tokens in chat.**
- Sharing the site URL does NOT expose the PAT (localStorage is
  per-browser; visitors get read-only UI, owner buttons gated by
  `isOwner()`).

---

## What shipped recently (newest first)

| Wave | Highlights | Commits |
|---|---|---|
| Multi-AI neutral copy | Title/ledes "made with AI", paste button → 会話から貼り付け, model default + picker option "AI" | (after `f667aa0`) |
| prompton framing | All UI copy: prompt→prompton where it means the work; prompt kept for prompt-text UI | `f667aa0` |
| Stories bar removed | Drafts moved to masthead 下書き button (count badge) + dropdown: ＋新規 + saved drafts, 3-file chip for multi-file drafts. `renderStoriesBar()` keeps its name but now renders the dropdown | `bcd211e` |
| PAT field fix | iOS strong-password overlay bug; masked text input + toggle; fine-grained token hint | `25b5b43` |
| 3-tab draft editor | HTML/CSS/JS tabs; css/js content ⇒ folder publish with `<link>`/`<script>` auto-injection (no double-inject); paste routes fences by language; drafts schema +css/js; folder delete support | `a453b9a` |
| iframe sandbox hardening | allow-same-origin dropped everywhere prompton HTML renders | `e1035c9` |
| Multi-file (folder) promptons | `layout:"folder"` manifest flag; `htmls/<id>/index.html` + sidecars; `promptHtmlPath()`/`promptPreviewAttrs()` helpers; fetchSeed skips prefetch; thumbnails workflow keyed by prompt ID and layout-aware; `_folder_demo` proves E2E incl. auto-thumbnail | `14a67b5`, `ca244e0` |
| Draft auto-save | 2s debounce on all draft fields, 未保存…/保存済 indicator, flush-on-close via MutationObserver | earlier |
| Search suggest keyboard nav | ↑/↓ with wrap, Enter selects, Esc closes, hover syncs; `.focused` accent edge | earlier |
| Emoji purge | Typography glyphs only (✦ ↗ ※ ✎ · …). ⇄ ♫ ↰ ↳ style glyphs remain by design | earlier |
| Owner edit/delete visibility | Owner actions (編集/新バージョン/削除, `.owner-action` accent edge) sit right after the primary CTA — they were scrolled off-screen on mobile | earlier |
| issueDate crash fix | The "blank gallery / dead gear" regression: unguarded `getElementById('issueDate')` halted the inline script before `currentLocale` init (TDZ). Both guards in place; SW bumped to v8 | `73dd95f`, `952d4fa` |

User-content commits also land continuously (東京被災マップ steps, georef
annotations, etc.) — don't be surprised by non-app commits in the log.

---

## Architecture (current)

### Two prompton layouts

- **flat** (default, no manifest flag): `htmls/<id>.html`, self-contained.
  Pre-fetched in `fetchSeed()`, previewed via `iframe.srcdoc`.
- **folder** (`"layout": "folder"`): `htmls/<id>/index.html` + `style.css`
  + `app.js` (+ future `lib/`, `assets/`). NOT pre-fetched; every preview
  uses `iframe.src` so relative subresources resolve. Versions:
  `htmls/<id>_v<n>/index.html`.
- Helpers in `js/render.js`: `promptHtmlPath(p, viewing)` and
  `promptPreviewAttrs(p, viewing)` — use these, never hand-build paths.
- Publish: `publishDraftDirect(title, body, css, js)` → folder iff css/js
  non-empty → `pushFolderPromptToGitHub()` = ONE bulk commit (Git Data API
  via `ghBulkCommit`) containing index/style/app + manifest + OG page.
- Delete: `deletePromptFromGitHub` enumerates `htmls/<id>/` contents for
  folder promptons (git has no directory objects).
- Thumbnails workflow (`.github/scripts/generate-thumbs.mjs`) works off
  prompt IDs; any change under `htmls/<id>.html` or `htmls/<id>/**`
  re-screenshots that ID. Output always `thumbs/<id>.jpg`.

### Drafts

- localStorage `prompton_drafts_v1`; fields: id, title, body, css, js,
  createdAt, updatedAt. Old drafts without css/js load fine.
- Entry point: masthead 下書き button → dropdown. Auto-save 2s debounce.
- Draft modal: 3 tabs (HTML/CSS/JS), 会話から貼り付け (fence routing:
  ```css→CSS, ```js→JS, longest other→HTML), GitHub URL import (HTML tab).

### Everything else (unchanged)

- Bootstrap try/catch hardened; hash routes; `isOwner()` = PAT+repo in
  `prompton_sync_v1`; i18n `t()` TDZ-safe, `i18n/{en,ja}.json`;
  `body.mobile-app` via matchMedia 680px; SW **v8** network-first for
  shell/JSON, cache-first for htmls/thumbs; OG cards at `p/<id>/index.html`;
  OAuth backend (`functions/`, `OAUTH_SETUP.md`) written but NOT deployed —
  it's the foundation for the Cloudflare work-version plan below.

### File layout deltas vs old handoff

```
htmls/<id>/…              folder-layout promptons (index.html + sidecars)
htmls/_folder_demo/       3-file infra demo — delete once a real folder
                          prompton exists (also drop its manifest entry,
                          thumbs/_folder_demo.jpg, p/_folder_demo/)
js/render.js              +promptHtmlPath/promptPreviewAttrs, drafts menu,
                          3-tab modal, owner-action ordering
js/github.js              +pushFolderPromptToGitHub, folder-aware delete
```

---

## Backlog (user-agreed, in rough priority order)

1. **AI-chat bookmarklet** — one click on claude.ai (and friends) →
   structured conversation → opens Prompton `#/import?d=<base64>` with a
   pre-filled draft. Kills copy-paste. Needs an import route handler +
   a bookmarklet generator page. ~2-3h. (The paste path already routes
   fenced blocks, so the import handler can reuse `extractFromClaudePaste`.)
2. **制作ノート / conversation log** — store the AI conversation as a
   sidecar (`htmls/<id>/conversation.json` fits the folder layout), show
   it as a collapsible "making-of" section on the detail page, with each
   assistant HTML attachment = a version (v1/v2/v3 auto-versioning).
   Design agreed with user: structured turns
   `{role: user|assistant, text, html?}`.
3. **Cloudflare work version** — private repo + CF Pages + CF Access +
   the already-written `functions/` OAuth backend. Public site stays on
   GitHub Pages. ~half a day. See OAUTH_SETUP.md.
4. **Folder-layout version editor** — "Save new version" currently
   flat-only.
5. Delete `_folder_demo` once a real folder prompton is published.

---

## Operational notes (THIS ENVIRONMENT — read before running commands)

- **PowerShell is the reliable shell.** In the last session the Bash
  tool's coreutils (`mkdir`, `cat`, `gh`…) intermittently vanished from
  PATH. Use the PowerShell tool for git/gh.
- **Commit messages: write to a scratchpad file, commit with
  `git commit -F <file>`.** PowerShell here-strings inside the command
  args broke on `<`-containing lines; bash heredocs broke on missing
  `cat`. The `-F` file approach always works.
- Always `git -C "C:\Users\松村峻長\prompton" …` (don't rely on CWD).
- Chain with `; if ($LASTEXITCODE -eq 0) { … }` — PowerShell 5.1 has no `&&`.
- Preview: Browser-pane tools (`mcp__Claude_Browser__*`). `preview_start
  {name:"prompton"}` returns a tabId; drive it with `javascript_tool` /
  `navigate` / `read_page`. **`computer {action:"screenshot"}` times out
  in this pane** — verify via `javascript_tool` returning JSON instead.
  A stale `body.mobile-app` class can linger after pane resizes; call
  `applyMobileMode()` before layout assertions.
- The preview tab's SW/caches can hold old shell: nuke via
  `serviceWorker.getRegistrations()→unregister` + `caches.delete`, or
  navigate with `?v=<anything>`.
- GitHub Pages deploy ≈1-2 min after push; SW v8 is network-first so a
  normal reload picks up new shell. `gh run list/watch -R morohami/prompton`
  to monitor; Pages builds occasionally fail on GitHub-side incidents —
  check githubstatus.com before debugging yourself, then
  `gh run rerun <id> --failed`.
- LF→CRLF warnings from git are harmless. UTF-8 BOM for `.ps1` with
  Japanese. Don't skip hooks.

---

**Start the next session by** reading this file, then asking the user
which backlog item to take (recommend #1, the bookmarklet — it's the
biggest UX win and unblocks #2's data capture).
