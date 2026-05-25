// POST /auth/logout — clears the session cookie. GET is allowed for plain
// link-style sign-out but returns the same response.
import { Env, clearSessionCookieHeader } from '../_utils';

const handler: PagesFunction<Env> = async () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookieHeader()
    }
  });

export const onRequestGet = handler;
export const onRequestPost = handler;
