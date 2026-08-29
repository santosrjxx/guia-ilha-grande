// Cloudflare Pages Function — passo 1 do login do Decap CMS (github backend).
// Redireciona o popup do CMS para a tela de autorização do GitHub.
// Requer as secrets GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET configuradas
// no projeto Cloudflare Pages (Settings > Environment variables).

interface Env {
  GITHUB_OAUTH_CLIENT_ID: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
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
};
