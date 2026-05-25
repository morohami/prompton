// Shared helpers for Cloudflare Pages Functions.
//
// Sessions are stateless HMAC-signed cookies. Payload is JSON-encoded then
// base64url + a SHA-256 HMAC of the payload using env.SESSION_SECRET. No DB
// needed — the cookie is the session.

export interface Env {
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  MASTER_PAT: string;       // PAT with repo write access — never exposed to the browser
  REPO: string;             // e.g. "morohami/prompton"
  SESSION_SECRET: string;   // 32+ random bytes, used as HMAC key
  ALLOWED_USERS?: string;   // optional CSV allow-list of GitHub logins ("morohami,chinchin")
}

export interface Session {
  sub: number;     // GitHub user id
  login: string;   // GitHub login (handle)
  exp: number;     // unix seconds
}

const SESSION_COOKIE = 'prompton_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;  // 7 days

function b64urlEncode(bytes: Uint8Array | string): string {
  const u8 = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signSession(s: Session, secret: string): Promise<string> {
  const payload = b64urlEncode(JSON.stringify(s));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return payload + '.' + b64urlEncode(new Uint8Array(sig));
}

export async function verifySession(token: string, secret: string): Promise<Session | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sigB64] = parts;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(sigB64),
    new TextEncoder().encode(payload)
  );
  if (!ok) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as Session;
    if (typeof s.exp !== 'number' || s.exp < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
}

export async function currentSession(request: Request, env: Env): Promise<Session | null> {
  const tok = readSessionCookie(request);
  if (!tok) return null;
  return verifySession(tok, env.SESSION_SECRET);
}

export function newSession(sub: number, login: string): Session {
  return { sub, login, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
}

export function isAllowed(login: string, env: Env): boolean {
  const allow = (env.ALLOWED_USERS || '').trim();
  if (!allow) return true;  // no list configured → anyone with a GitHub login can sign in
  const set = new Set(allow.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
  return set.has(login.toLowerCase());
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}
