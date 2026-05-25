// GET /auth/login → 302 to GitHub OAuth authorize. Captures the page the
// user came from in `state` so the callback can return them there.
import type { Env } from '../_utils';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return_to') || '/';
  const state = btoa(JSON.stringify({ r: returnTo, n: crypto.randomUUID() }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const redirectUri = `${url.origin}/auth/callback`;
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GH_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'read:user');
  authorize.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      // Stash the state in a short-lived cookie so we can verify on callback.
      'Set-Cookie': `prompton_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`
    }
  });
};
