// Peter API — Cloudflare Worker
// 1. POST /claude          → forwards planning requests to Claude with your secret API key
// 2. GET  /notion/login    → sends the user to Notion's "Connect Peter" screen
// 3. GET  /notion/callback → swaps Notion's one-time code for an access token, then reopens Peter

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/claude' && request.method === 'POST') return handleClaude(request, env);
      if (url.pathname === '/notion/login') return notionLogin(env);
      if (url.pathname === '/notion/callback') return notionCallback(url, env);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------- Claude proxy ----------

async function handleClaude(request, env) {
  // Light check so random people can't use your proxy. Not bulletproof (the token ships
  // inside the app), so keep a monthly spend limit set in the Anthropic Console too.
  if (request.headers.get('X-Peter-App') !== env.PETER_APP_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  const body = await request.json();
  const payload = {
    model: env.CLAUDE_MODEL || 'claude-haiku-5-5',
    max_tokens: Math.min(body.max_tokens || 1500, 2000),
    system: body.system,
    messages: body.messages,
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------- Notion OAuth ----------

function notionLogin(env) {
  const auth = new URL('https://api.notion.com/v1/oauth/authorize');
  auth.searchParams.set('client_id', env.NOTION_CLIENT_ID);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('owner', 'user');
  auth.searchParams.set('redirect_uri', env.NOTION_REDIRECT_URI);
  return Response.redirect(auth.toString(), 302);
}

async function notionCallback(url, env) {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return backToPeter(`peter://notion-error?reason=${encodeURIComponent(error || 'missing_code')}`,
      'Notion connection was cancelled.');
  }

  const res = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`),
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.NOTION_REDIRECT_URI,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return backToPeter(`peter://notion-error?reason=${encodeURIComponent(data.error || 'token_exchange_failed')}`,
      'Something went wrong connecting Notion.');
  }

  const params = new URLSearchParams({
    token: data.access_token,
    template: data.duplicated_template_id || '',
    workspace: data.workspace_name || '',
  });
  return backToPeter(`peter://notion-connected?${params}`, 'Notion connected! You can close this tab.');
}

// Small page that reopens Peter and tells the user what happened.
function backToPeter(deepLink, message) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Peter</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#f7f7f8;color:#222}
.card{text-align:center;padding:32px}a{color:#2563eb}</style></head>
<body><div class="card"><h2>${message}</h2>
<p><a href="${deepLink}">Open Peter</a> if it didn't open by itself.</p></div>
<script>window.location.href = ${JSON.stringify(deepLink)};</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
