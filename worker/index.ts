// Worker do Cloudflare que serve o site estático (Astro, via binding ASSETS) e cuida de
// três coisas dinâmicas:
//
// 1. Proxy de OAuth do GitHub para o painel /admin (Sveltia CMS, backend "github" com
//    base_url apontando pra cá). Sveltia CMS sempre abre o popup em "/auth" (caminho fixo,
//    não configurável via config.yml) e espera de volta uma mensagem
//    "authorization:github:success:{...}" via postMessage. Mantemos "/api/auth" e
//    "/api/callback" como aliases do fluxo antigo (usado antes pelo Decap CMS) — não custa
//    nada mantê-los e evita qualquer risco de o login quebrar caso o callback URL
//    registrado no GitHub OAuth App ainda aponte pra lá.
//
// 2. Encurtador/redirecionador de links de afiliado: /<slug> (na raiz do domínio, ex.:
//    guiailhagrande.com.br/mochila-trilha/) → redireciona pro link real (definido em
//    src/data/affiliate-links.json, editável pelo painel /admin) e conta o clique numa KV.
//    Equivalente caseiro ao Pretty Links. Uma página ou artigo real do site SEMPRE tem
//    prioridade sobre um slug de afiliado igual (só tentamos o afiliado depois de a busca
//    normal pelo arquivo estático dar 404) — assim um link de afiliado nunca derruba uma
//    página existente. /go/<slug> antigo continua funcionando (redireciona direto, sem
//    passo intermediário) pra não quebrar links já publicados em artigos antes da migração
//    pra links na raiz.
//
// 3. /go/stats?key=... (HTML) e /go/stats.json?key=... — painel com a contagem de cliques
//    por link, protegido por um segredo (STATS_SECRET) pra não ficar público. O JSON
//    alimenta a tela "Cliques em Afiliados" dentro de /admin.

import affiliateLinks from '../src/data/affiliate-links.json';

export interface Env {
  ASSETS: Fetcher;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  AFFILIATE_CLICKS: KVNamespace;
  STATS_SECRET: string;
}

interface AffiliateLink {
  slug: string;
  label: string;
  provider: string;
  destinationUrl: string;
  active: boolean;
}

const AFFILIATE_LINKS = (affiliateLinks as { links: AffiliateLink[] }).links;

function html(body: string, extraHeaders: Record<string, string> = {}, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...extraHeaders,
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
      // Só repassa o token se a mensagem for exatamente o handshake esperado
      // ("authorizing:github") E tiver vindo da própria origem (a aba do /admin
      // que abriu este popup) — evita repassar o token a uma origem arbitrária.
      if (e.origin !== window.location.origin) return;
      if (e.data !== 'authorizing:github') return;
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
  // Aponta sempre pro alias antigo: é o valor já cadastrado como "Authorization callback
  // URL" no GitHub OAuth App (confirmado funcionando). Trocar exigiria atualizar isso lá
  // também, então não há motivo pra mudar.
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

// Conta o clique numa KV (get-then-put: não é atômico, então sob rajadas concorrentes pode
// subcontar um pouco — aceitável pro volume de tráfego deste site, não é uma métrica
// financeira crítica) e devolve o redirecionamento pro link real. Não bloqueia a resposta
// (ctx.waitUntil). Retorna null se o slug não corresponde a nenhum link de afiliado ativo.
function redirectAffiliate(slug: string, env: Env, ctx: ExecutionContext): Response | null {
  const link = AFFILIATE_LINKS.find((l) => l.slug === slug && l.active !== false);
  if (!link) return null;

  ctx.waitUntil(
    (async () => {
      const current = Number((await env.AFFILIATE_CLICKS.get(slug)) ?? '0') || 0;
      await env.AFFILIATE_CLICKS.put(slug, String(current + 1));
    })()
  );

  return Response.redirect(link.destinationUrl, 302);
}

async function getStatsRows(env: Env, origin: string) {
  const rows = await Promise.all(
    AFFILIATE_LINKS.map(async (link) => ({
      ...link,
      shortUrl: `${origin}/${link.slug}/`,
      clicks: Number((await env.AFFILIATE_CLICKS.get(link.slug)) ?? '0') || 0,
    }))
  );
  rows.sort((a, b) => b.clicks - a.clicks);
  return rows;
}

function checkStatsKey(request: Request, env: Env): boolean {
  const key = new URL(request.url).searchParams.get('key');
  return Boolean(env.STATS_SECRET) && key === env.STATS_SECRET;
}

async function handleStatsJson(request: Request, env: Env): Promise<Response> {
  if (!checkStatsKey(request, env)) {
    return new Response(JSON.stringify({ error: 'Acesso negado' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    });
  }

  const rows = await getStatsRows(env, new URL(request.url).origin);
  return new Response(JSON.stringify(rows), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });
}

async function handleStats(request: Request, env: Env): Promise<Response> {
  if (!checkStatsKey(request, env)) {
    return html(
      '<!doctype html><html><body><p>Acesso negado.</p></body></html>',
      { 'X-Robots-Tag': 'noindex' },
      403
    );
  }

  const rows = await getStatsRows(env, new URL(request.url).origin);

  const tableRows = rows
    .map(
      (r) => `<tr>
        <td><a href="${escapeHtml(r.shortUrl)}">${escapeHtml(r.shortUrl)}</a>${r.active ? '' : ' <em>(inativo)</em>'}</td>
        <td>${escapeHtml(r.label)}</td>
        <td>${escapeHtml(r.provider)}</td>
        <td style="text-align:right">${r.clicks}</td>
        <td><a href="${escapeHtml(r.destinationUrl)}" target="_blank" rel="noopener noreferrer">abrir destino</a></td>
      </tr>`
    )
    .join('');

  return html(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
      <title>Cliques em links de afiliado</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 2rem; color: #10201d; }
        table { border-collapse: collapse; width: 100%; max-width: 900px; }
        th, td { border: 1px solid #dde5e3; padding: 0.5rem 0.75rem; text-align: left; }
        th { background: #f4f8f7; }
      </style>
      </head><body>
      <h1>Cliques em links de afiliado</h1>
      <p>Versão mais fácil de usar: <a href="/admin/links/">/admin/links/</a> (dentro do painel, sem precisar digitar a chave toda vez).</p>
      <table>
        <thead><tr><th>Link curto</th><th>Rótulo</th><th>Provedor</th><th>Cliques</th><th>Destino</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </body></html>`,
    { 'X-Robots-Tag': 'noindex' }
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/auth' || pathname === '/auth/' || pathname === '/api/auth' || pathname === '/api/auth/') {
      return handleAuth(request, env);
    }
    if (
      pathname === '/callback' ||
      pathname === '/callback/' ||
      pathname === '/api/callback' ||
      pathname === '/api/callback/'
    ) {
      return handleCallback(request, env);
    }

    if (pathname === '/go/stats' || pathname === '/go/stats/') {
      return handleStats(request, env);
    }
    if (pathname === '/go/stats.json') {
      return handleStatsJson(request, env);
    }

    // Compatibilidade: links antigos publicados como /go/<slug>/ (formato usado antes da
    // migração pra links na raiz do domínio) continuam funcionando e contando clique.
    if (pathname.startsWith('/go/')) {
      const legacySlug = pathname.slice('/go/'.length).replace(/\/$/, '');
      const redirect = redirectAffiliate(legacySlug, env, ctx);
      if (redirect) return redirect;
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;

    // Nenhuma página ou artigo real bate com esse endereço: tenta como link de afiliado na
    // raiz (ex.: /mochila-trilha/). Uma página real SEMPRE tem prioridade — um link de
    // afiliado só "ativa" quando não existe nenhuma página com o mesmo slug.
    const rootSlug = pathname.replace(/^\/+|\/+$/g, '');
    if (rootSlug && !rootSlug.includes('/')) {
      const redirect = redirectAffiliate(rootSlug, env, ctx);
      if (redirect) return redirect;
    }

    return assetResponse;
  },
};
