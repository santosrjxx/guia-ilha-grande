// Cloudflare Pages Function — passo 2 do login do Decap CMS (github backend).
// Troca o "code" do GitHub por um access_token e devolve o token para a janela
// do CMS via postMessage, seguindo o protocolo de handshake que o Decap CMS espera
// de um "external OAuth client" (authorizing:github -> authorization:github:success:...).

interface Env {
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function html(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function renderError(message: string): string {
  return `<!doctype html><html><body><p>Erro de autenticação: ${escapeHtml(message)}</p></body></html>`;
}

function renderSuccess(token: string): string {
  const payload = 'authorization:github:success:' + JSON.stringify({ token, provider: 'github' });
  return `<!doctype html>
<html><body>
<script>
  (function () {
    var message = ${JSON.stringify(payload)};
    function receiveMessage(e) {
      window.opener.postMessage(message, e.origin);
      window.removeEventListener('message', receiveMessage, false);
    }
    window.addEventListener('message', receiveMessage, false);
    window.opener.postMessage('authorizing:github', '*');
  })();
</script>
</body></html>`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookieState = cookieHeader.match(/oauth_state=([^;]+)/)?.[1];

  if (!code || !state || state !== cookieState) {
    return html(renderError('Estado OAuth inválido ou expirado. Tente autenticar novamente.'));
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
    return html(renderError(tokenData.error_description || 'Não foi possível obter o token de acesso do GitHub.'));
  }

  return html(renderSuccess(tokenData.access_token));
};
