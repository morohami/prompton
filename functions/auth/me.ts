// GET /auth/me — returns the current session user or null. The client polls
// this on load to know whether to show "Sign in" or "Signed in as @x".
import { Env, currentSession, json } from '../_utils';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const s = await currentSession(request, env);
  if (!s) return json({ login: null });
  return json({ login: s.login, sub: s.sub });
};
