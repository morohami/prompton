# OAuth backend — deployment guide

Cloudflare Pages Functions live under `functions/`. They give Prompton a real
"sign in with GitHub" flow so contributors don't need to paste a PAT into
their browser. The master PAT stays on the server.

What ships today (foundation):

- `/auth/login` — start the OAuth flow
- `/auth/callback` — exchange the code, set an HTTP-only session cookie
- `/auth/logout` — clear the cookie
- `/auth/me` — return the current session user or `null`
- `/api/write` — auth-gated write proxy (single file PUT) using `MASTER_PAT`

What doesn't ship yet:

- Migrating the client's existing `ghPutFile` / `ghBulkCommit` callsites to
  go through `/api/...`. Plan to do that incrementally once we're confident
  the auth roundtrip is healthy in production.

## One-time setup

### 1. Create a GitHub OAuth App

<https://github.com/settings/developers> → **New OAuth App**

- **Application name**: Prompton
- **Homepage URL**: `https://prompton.<your-domain>.com` (or your Pages URL)
- **Authorization callback URL**: `https://<that same origin>/auth/callback`

Note the **Client ID** and generate a **Client Secret**.

### 2. Create a Cloudflare Pages project

<https://dash.cloudflare.com/> → Pages → **Create a project** → Connect to
GitHub → pick the `prompton` repo. Build settings:

- **Framework preset**: None
- **Build command**: (leave blank — this is a static repo with functions)
- **Build output directory**: `/`
- **Root directory**: `/`

CF will auto-detect `functions/` and deploy them as edge functions.

### 3. Mint a server-side PAT

<https://github.com/settings/tokens/new> — scope **`public_repo`** (or
`repo` if the repo is private). This is the **MASTER_PAT** — the server uses
it for all writes. Don't reuse the one in localStorage.

### 4. Add environment variables in CF Pages → Settings → Environment variables (Production)

| Name | Value |
|---|---|
| `GH_CLIENT_ID` | from step 1 |
| `GH_CLIENT_SECRET` | from step 1 |
| `MASTER_PAT` | from step 3 |
| `REPO` | `morohami/prompton` |
| `SESSION_SECRET` | 32+ random bytes (use `openssl rand -base64 32`) |
| `ALLOWED_USERS` | (optional) CSV of GitHub logins permitted to sign in, e.g. `morohami,chinchin`. Omit to allow any GitHub user. |

Mark `GH_CLIENT_SECRET`, `MASTER_PAT`, and `SESSION_SECRET` as **encrypted**.

### 5. Deploy + verify

CF deploys on every push to `main`. After the first deploy:

```
curl https://<your-pages-domain>/auth/me   # { "login": null }
```

Open `https://<your-pages-domain>/auth/login?return_to=/` in a browser, sign in,
then `curl --cookie cookies.txt https://<your-pages-domain>/auth/me` should
return your login.

### 6. (Optional) Wire the Settings page sign-in button

Once the deploy works, add a "Sign in with GitHub" affordance to the
Settings panel that links to `/auth/login?return_to=/#/settings`. The
existing PAT input can stay alongside it for local dev.

## Threat model notes

- Session cookies are HMAC-signed, HttpOnly, Secure, SameSite=Lax — JS can't
  read them, CSRF is gated by the `state` cookie at callback.
- `MASTER_PAT` never leaves the server.
- `ALLOWED_USERS` is the only gate on who can write. If unset, any GitHub
  user who completes the OAuth flow gets a session. Set it.
- `/api/write` refuses `..` paths and writes inside `.github/` to prevent
  workflow tampering.
