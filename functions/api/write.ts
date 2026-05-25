// POST /api/write — auth-gated GitHub Contents API write proxy. Body:
//   { path: string, content: string|base64, sha?: string, message?: string, encoding?: "utf-8"|"base64" }
// Server uses MASTER_PAT (kept secret) to PUT the file, and records the
// signed-in user's login in the commit message for audit.
//
// This is the minimum-viable migration target — the client can keep using
// its direct GitHub API path for now and switch to /api/write incrementally
// once we're confident the OAuth flow is healthy.
import { Env, currentSession, json } from '../_utils';

interface Body {
  path: string;
  content: string;
  sha?: string;
  message?: string;
  encoding?: 'utf-8' | 'base64';
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const s = await currentSession(request, env);
  if (!s) return json({ error: 'not signed in' }, 401);

  let body: Body;
  try { body = await request.json() as Body; }
  catch { return json({ error: 'invalid json' }, 400); }
  if (!body.path || typeof body.content !== 'string') {
    return json({ error: 'path + content required' }, 400);
  }

  // Path safety: only allow writes inside the project tree, no path traversal,
  // no .github/ tampering.
  const path = body.path.replace(/^\/+/, '');
  if (path.includes('..') || path.startsWith('.github/')) {
    return json({ error: 'path not allowed' }, 403);
  }

  const encoding = body.encoding || 'utf-8';
  const contentB64 = encoding === 'base64'
    ? body.content
    : btoa(unescape(encodeURIComponent(body.content)));

  const payload: Record<string, unknown> = {
    message: (body.message || ('Prompton: edit ' + path)) + ' (via @' + s.login + ')',
    content: contentB64,
    branch: 'main'
  };
  if (body.sha) payload.sha = body.sha;

  const ghRes = await fetch(
    `https://api.github.com/repos/${env.REPO}/contents/${encodeURIComponent(path)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + env.MASTER_PAT,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'prompton-write-proxy',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  const ghBody = await ghRes.json();
  return json(ghBody, ghRes.status);
};
