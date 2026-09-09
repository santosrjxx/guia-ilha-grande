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
//    guiadeilhagrande.com.br/mochila-trilha/) → redireciona pro link real (definido em
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
//
// 4. Comentários nos artigos: POST /api/comments (público, qualquer visitante manda um
//    comentário, que fica pendente de aprovação — nunca aparece no ar sozinho), GET
//    /api/comments?slug=... (público, só os comentários já aprovados daquele artigo — é o
//    que o componente Comments.astro busca ao vivo no navegador), GET
//    /api/comments/pending?key=... e POST /api/comments/moderate (protegidos pelo mesmo
//    STATS_SECRET do item 3) — alimentam a tela de moderação em /admin/comments. Guardados
//    numa KV própria (COMMENTS), uma lista JSON por artigo, mais um índice separado
//    (comments:_index) com a lista de slugs que já receberam algum comentário, pra dar pra
//    achar tudo que está pendente sem precisar varrer a KV inteira.

import affiliateLinks from '../src/data/affiliate-links.json';

export interface Env {
  ASSETS: Fetcher;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  AFFILIATE_CLICKS: KVNamespace;
  COMMENTS: KVNamespace;
  STATS_SECRET: string;
}

interface Comment {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  approved: boolean;
}

interface AffiliateLink {
  slug: string;
  label: string;
  provider: string;
  destinationUrl: string;
  active: boolean;
}

const AFFILIATE_LINKS = (affiliateLinks as { links: AffiliateLink[] }).links;

// Código de 2 letras anexado ao fim do link curto, derivado automaticamente do campo
// "Provedor" escolhido no CMS — não é um campo separado no JSON, pra não ter como ficar
// dessincronizado. Ex.: guiadeilhagrande.com.br/mochila-trilha/am/ (Amazon).
const PROVIDER_CODES: Record<string, string> = {
  amazon: 'am',
  mercadoLivre: 'ml',
  booking: 'bk',
  rentcar: 'rc',
  outro: 'ot',
};

function providerCode(provider: string): string {
  return PROVIDER_CODES[provider] ?? 'ot';
}

// Chave usada na KV de cliques. Inclui o provedor porque dois links diferentes (ex.: a
// mesma mochila na Amazon e no Mercado Livre) podem compartilhar o mesmo slug base e
// precisam de contadores separados.
function clickKey(link: AffiliateLink): string {
  return `${link.slug}::${providerCode(link.provider)}`;
}

function findLinkBySlugAndCode(slug: string, code: string): AffiliateLink | undefined {
  return AFFILIATE_LINKS.find(
    (l) => l.slug === slug && providerCode(l.provider) === code && l.active !== false
  );
}

// Usado só pelos formatos antigos (/go/<slug>/ e /<slug>/ sem código de provedor), de antes
// dessa mudança — pega o primeiro link ativo com aquele slug, ignorando o provedor.
function findLinkBySlug(slug: string): AffiliateLink | undefined {
  return AFFILIATE_LINKS.find((l) => l.slug === slug && l.active !== false);
}

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

// Domínios de onde o painel /admin pode ser aberto. O popup de OAuth roda sempre em
// guia-ilha-grande.moiclub.workers.dev (é o "base_url" fixo no config.yml), que é uma
// origem DIFERENTE do domínio do site — comparar com window.location.origin (bug antigo)
// nunca dava match e travava o login numa tela branca. Por isso validamos contra uma
// lista explícita do(s) domínio(s) do site em vez da origem do próprio popup.
const ALLOWED_OPENER_ORIGINS = [
  'https://www.guiadeilhagrande.com.br',
  'https://guiadeilhagrande.com.br',
];

function renderSuccess(token: string): Response {
  const payload = 'authorization:github:success:' + JSON.stringify({ token, provider: 'github' });
  return html(`<!doctype html>
<html><body>
<script>
  (function () {
    var message = ${JSON.stringify(payload)};
    var allowedOrigins = ${JSON.stringify(ALLOWED_OPENER_ORIGINS)};
    function receiveMessage(e) {
      // Só repassa o token se a mensagem for exatamente o handshake esperado
      // ("authorizing:github") E tiver vindo da aba do /admin que abriu este popup
      // (um dos domínios do site) — evita repassar o token a uma origem arbitrária.
      if (allowedOrigins.indexOf(e.origin) === -1) return;
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
// (ctx.waitUntil). Retorna null se `link` for undefined (nenhum link de afiliado bateu).
function redirectAffiliate(
  link: AffiliateLink | undefined,
  env: Env,
  ctx: ExecutionContext
): Response | null {
  if (!link) return null;
  const key = clickKey(link);

  ctx.waitUntil(
    (async () => {
      const current = Number((await env.AFFILIATE_CLICKS.get(key)) ?? '0') || 0;
      await env.AFFILIATE_CLICKS.put(key, String(current + 1));
    })()
  );

  return Response.redirect(link.destinationUrl, 302);
}

async function getStatsRows(env: Env, origin: string) {
  const rows = await Promise.all(
    AFFILIATE_LINKS.map(async (link) => ({
      ...link,
      shortUrl: `${origin}/${link.slug}/${providerCode(link.provider)}/`,
      clicks: Number((await env.AFFILIATE_CLICKS.get(clickKey(link))) ?? '0') || 0,
    }))
  );
  rows.sort((a, b) => b.clicks - a.clicks);
  return rows;
}

function checkStatsKey(request: Request, env: Env): boolean {
  const key = new URL(request.url).searchParams.get('key');
  return Boolean(env.STATS_SECRET) && key === env.STATS_SECRET;
}

const COMMENTS_INDEX_KEY = 'comments:_index';
const commentsKey = (slug: string) => `comments:${slug}`;

async function getComments(env: Env, slug: string): Promise<Comment[]> {
  const raw = await env.COMMENTS.get(commentsKey(slug));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Comment[];
  } catch {
    return [];
  }
}

async function putComments(env: Env, slug: string, comments: Comment[]): Promise<void> {
  await env.COMMENTS.put(commentsKey(slug), JSON.stringify(comments));
}

async function getSlugIndex(env: Env): Promise<string[]> {
  const raw = await env.COMMENTS.get(COMMENTS_INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function addToSlugIndex(env: Env, slug: string): Promise<void> {
  const index = await getSlugIndex(env);
  if (!index.includes(slug)) {
    index.push(slug);
    await env.COMMENTS.put(COMMENTS_INDEX_KEY, JSON.stringify(index));
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex' },
  });
}

// Aceita comentário novo. Nunca fica visível sozinho — entra como pendente e só aparece pro
// público depois que alguém aprovar em /admin/comments (POST /api/comments/moderate).
async function handleCommentSubmit(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: { slug?: string; name?: string; message?: string; honeypot?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Corpo inválido' }, 400);
  }

  const slug = (body.slug ?? '').trim();
  const name = (body.name ?? '').trim();
  const message = (body.message ?? '').trim();

  // Campo-armadilha: invisível pra gente de verdade (escondido via CSS no formulário),
  // mas robôs de spam costumam preencher todo campo que encontram. Se veio preenchido,
  // finge que deu certo (não avisa o robô) mas não guarda nada.
  if (body.honeypot) {
    return jsonResponse({ ok: true });
  }

  if (!slug || name.length < 2 || name.length > 80 || message.length < 3 || message.length > 2000) {
    return jsonResponse({ error: 'Dados inválidos' }, 400);
  }

  const comment: Comment = {
    id: crypto.randomUUID(),
    name,
    message,
    createdAt: new Date().toISOString(),
    approved: false,
  };

  ctx.waitUntil(
    (async () => {
      const comments = await getComments(env, slug);
      comments.push(comment);
      await putComments(env, slug, comments);
      await addToSlugIndex(env, slug);
    })()
  );

  return jsonResponse({ ok: true });
}

// Lista pública: só os comentários já aprovados de um artigo, pro componente Comments.astro
// exibir na página. Nunca revela os pendentes.
async function handleCommentsList(request: Request, env: Env): Promise<Response> {
  const slug = new URL(request.url).searchParams.get('slug') ?? '';
  if (!slug) return jsonResponse([]);

  const comments = await getComments(env, slug);
  const approved = comments
    .filter((c) => c.approved)
    .map((c) => ({ id: c.id, name: c.name, message: c.message, createdAt: c.createdAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return jsonResponse(approved);
}

// Lista protegida (mesma chave do painel de cliques): todos os comentários pendentes de
// todo o site, pra tela de moderação em /admin/comments.
async function handleCommentsPending(request: Request, env: Env): Promise<Response> {
  if (!checkStatsKey(request, env)) {
    return jsonResponse({ error: 'Acesso negado' }, 403);
  }

  const slugs = await getSlugIndex(env);
  const pending = (
    await Promise.all(
      slugs.map(async (slug) => {
        const comments = await getComments(env, slug);
        return comments.filter((c) => !c.approved).map((c) => ({ ...c, slug }));
      })
    )
  )
    .flat()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return jsonResponse(pending);
}

// Aprova ou apaga um comentário pendente (ou já aprovado, no caso de apagar). Protegido pela
// mesma chave do painel de cliques.
async function handleCommentModerate(request: Request, env: Env): Promise<Response> {
  let body: { key?: string; slug?: string; id?: string; action?: 'approve' | 'delete' };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Corpo inválido' }, 400);
  }

  if (!env.STATS_SECRET || body.key !== env.STATS_SECRET) {
    return jsonResponse({ error: 'Acesso negado' }, 403);
  }

  const slug = body.slug ?? '';
  const id = body.id ?? '';
  if (!slug || !id || (body.action !== 'approve' && body.action !== 'delete')) {
    return jsonResponse({ error: 'Dados inválidos' }, 400);
  }

  const comments = await getComments(env, slug);
  const next =
    body.action === 'delete'
      ? comments.filter((c) => c.id !== id)
      : comments.map((c) => (c.id === id ? { ...c, approved: true } : c));

  await putComments(env, slug, next);
  return jsonResponse({ ok: true });
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

    if (pathname === '/api/comments' && request.method === 'POST') {
      return handleCommentSubmit(request, env, ctx);
    }
    if (pathname === '/api/comments' && request.method === 'GET') {
      return handleCommentsList(request, env);
    }
    if (pathname === '/api/comments/pending') {
      return handleCommentsPending(request, env);
    }
    if (pathname === '/api/comments/moderate' && request.method === 'POST') {
      return handleCommentModerate(request, env);
    }

    // Compatibilidade: links antigos publicados como /go/<slug>/ (formato usado antes da
    // migração pra links na raiz do domínio) continuam funcionando e contando clique.
    if (pathname.startsWith('/go/')) {
      const legacySlug = pathname.slice('/go/'.length).replace(/\/$/, '');
      const redirect = redirectAffiliate(findLinkBySlug(legacySlug), env, ctx);
      if (redirect) return redirect;
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;

    // Nenhuma página ou artigo real bate com esse endereço: tenta como link de afiliado na
    // raiz. Uma página real SEMPRE tem prioridade — um link de afiliado só "ativa" quando
    // não existe nenhuma página com o mesmo endereço.
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 2) {
      // Formato atual: /<slug>/<código-do-provedor>/ (ex.: /mochila-trilha/am/).
      const redirect = redirectAffiliate(findLinkBySlugAndCode(segments[0], segments[1]), env, ctx);
      if (redirect) return redirect;
    } else if (segments.length === 1) {
      // Compatibilidade com o formato de raiz sem código de provedor (/<slug>/), usado
      // brevemente antes da introdução do código de 2 letras.
      const redirect = redirectAffiliate(findLinkBySlug(segments[0]), env, ctx);
      if (redirect) return redirect;
    }

    return assetResponse;
  },
};
