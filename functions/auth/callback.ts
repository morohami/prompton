// GET /auth/callback?code=…&state=…
// Exchanges the OAuth code for an access token, fetches the user's GitHub
// profile, verifies the login against ALLOWED_USERS (if configured), and
// sets the prompton_session cookie. Then 302s back to the original page.
import {
  Env,
  newSession,
  signSession,
  sessionCookieHeader,
  isAllowed,
  json
} from '../_utils';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return json({ error: 'missing code or state' }, 400);

  // CSRF: state in query must equal the cookie we set at /auth/login.
  const cookie = request.headers.get('Cookie') || '';
  const stateCookie = cookie.match(/(?:^|;\s*)prompton_oauth_state=([^;]+)/);
  if (!stateCookie || stateCookie[1] !== state) {
    return json({ error: 'state mismatch' }, 403);
  }

  // Exchange code for token.
  const tokRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GH_CLIENT_ID,
      client_secret: env.GH_CLIENT_SECRET,
      code
    })
  });
  if (!tokRes.ok) return json({ error: 'token exchange failed' }, 502);
  const tok = await tokRes.json() as { access_token?: string; error?: string };
  if (!tok.access_token) return json({ error: tok.error || 'no access_token' }, 502);

  // Identify the user.
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + tok.access_token,
      'User-Agent': 'prompton-auth',
      Accept: 'application/vnd.github+json'
    }
  });
  if (!userRes.ok) return json({ error: 'user lookup failed' }, 502);
  const user = await userRes.json() as { id: number; login: string };
  if (!isAllowed(user.login, env)) {
    return json({ error: 'user not in allow-list', login: user.login }, 403);
  }

  // Mint session, clear oauth state cookie, redirect to return_to.
  const sess = newSession(user.id, user.login);
  const sessionToken = await signSession(sess, env.SESSION_SECRET);
  let returnTo = '/';
  try {
    const decoded = atob(state.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(decoded);
    if (typeof parsed?.r === 'string' && parsed.r.startsWith('/')) returnTo = parsed.r;
  } catch { /* ignore */ }
  const headers = new Headers({ Location: returnTo });
  headers.append('Set-Cookie', sessionCookieHeader(sessionToken));
  headers.append('Set-Cookie', 'prompton_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return new Response(null, { status: 302, headers });
};
