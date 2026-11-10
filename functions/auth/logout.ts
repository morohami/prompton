// POST /auth/logout — clears the session cookie. POST only: allowing GET let any
// page log the visitor out with an <img src="/auth/logout"> (logout CSRF).
import { Env, clearSessionCookieHeader } from '../_utils';

const handler: PagesFunction<Env> = async () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookieHeader()
    }
  });

export const onRequestPost = handler;
