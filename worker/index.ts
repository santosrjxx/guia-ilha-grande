// Worker do Cloudflare que serve o site estático (Astro, via binding ASSETS) e,
// para as rotas /api/auth e /api/callback, roda o proxy de OAuth do GitHub usado
// pelo painel de admin (Decap CMS, backend "github" com base_url apontando pra cá).
//
// Protocolo de handshake com o Decap CMS: a janela popup avisa "authorizing:github"
// e recebe de volta "authorization:github:success:{token,provider}" via postMessage.

export interface Env {
  ASSETS: Fetcher;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderError(message: string): Response {
  return html(`<!doctype html><html><body><p>Erro de autenticação: ${escapeHtml(message)}</p></body></html>`);
}

function renderSuccess(token: string): Response {
  const payload = 'authorization:github:success:' + JSON.stringify({ token, provider: 'github' });
  return html(`<!doctype html>
<html><body>
<script>
  (function () {
    var message = ${JSON.stringify(payload)};
    function receiveMessage(e) {
      // Só repassa o token se o pedido de confirmação veio da própria origem
      // (a aba do /admin que abriu este popup) — evita repassar o token a
      // uma origem arbitrária que consiga mandar uma mensagem pra esta janela.
      if (e.origin !== window.location.origin) return;
      window.opener.postMessage(message, e.origin);
      window.removeEventListener('message', receiveMessage, false);
    }
    window.addEventListener('message', receiveMessage, false);
    window.opener.postMessage('authorizing:github', '*');
  })();
</script>
</body></html>`);
}

async function handleAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const redirectUri = `${url.origin}/api/callback`;

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'repo,user');
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookieState = cookieHeader.match(/oauth_state=([^;]+)/)?.[1];

  if (!code || !state || state !== cookieState) {
    return renderError('Estado OAuth inválido ou expirado. Tente autenticar novamente.');
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/callback`,
    }),
  });

  const tokenData: { access_token?: string; error_description?: string } = await tokenResponse.json();

  if (!tokenData.access_token) {
    return renderError(tokenData.error_description || 'Não foi possível obter o token de acesso do GitHub.');
  }

  return renderSuccess(tokenData.access_token);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/auth' || pathname === '/api/auth/') {
      return handleAuth(request, env);
    }
    if (pathname === '/api/callback' || pathname === '/api/callback/') {
      return handleCallback(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
