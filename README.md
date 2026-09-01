# Guia Ilha Grande

Site estático (Astro SSG) do guia de turismo para Ilha Grande, RJ. Conteúdo editável via Decap CMS, deploy automático para Cloudflare Workers.

## Stack

- **Astro 5** (`output: 'static'`) — zero JS por padrão
- **Decap CMS** (`/admin`) — edição de conteúdo sem tocar em código
- **Cloudflare Workers** (Wrangler) — hospedagem do site e proxy de autenticação OAuth do CMS

## Comandos

- `npm install` — instala as dependências
- `npm run dev` — ambiente de desenvolvimento local (`http://localhost:4321`)
- `npm run build` — gera o site estático em `dist/`
- `npm run preview` — serve o build de `dist/` localmente
- `npm run cms` — sobe o Decap CMS local (`decap-server`) na porta padrão, para editar conteúdo sem precisar de GitHub/Cloudflare configurados. Rode em paralelo com `npm run dev` e acesse `/admin` — o `public/admin/config.yml` já tem `local_backend: true` para esse modo.

## Estrutura de conteúdo

- `src/content/articles/` — artigos (Markdown/MDX), cada um pertence a um silo (`onde-comer`, `o-que-fazer`, `onde-ficar`, `guia-pratico`)
- `src/content/pages/` — as 4 páginas institucionais fixas (Sobre, Contato, Política de Privacidade, Política Editorial)
- `src/data/site-config.json` — dados gerais do site, cores, textos dos silos e links de afiliados

Tudo isso é editável pelo painel `/admin` (Decap CMS) sem precisar mexer em código — o `public/admin/config.yml` espelha os campos de `src/content.config.ts` e de `site-config.json`.

## Deploy (produção)

O deploy é automático via GitHub Actions (`.github/workflows/deploy.yml`) a cada push na branch `main`: builda o site e publica no Cloudflare Workers com `npx wrangler deploy`.

Secrets necessários no GitHub (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Painel de administração (`/admin`)

Em produção, o login do Decap CMS usa um proxy de OAuth do GitHub rodando no próprio Worker (`worker/index.ts`, rotas `/api/auth` e `/api/callback`). Para isso funcionar, o Worker precisa de dois secrets — **não são secrets do GitHub Actions, são do Cloudflare Worker**, configurados via Wrangler:

```
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
```

Esses valores vêm de um GitHub OAuth App (**GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**) configurado com:

- **Homepage URL**: a URL de produção do site
- **Authorization callback URL**: `https://<domínio-ou-subdomínio-workers.dev>/api/callback`

## Dados pendentes

Alguns campos ainda estão com o marcador `[PENDENTE - editar no CMS]` no lugar de um dado real (ex.: WhatsApp, tags de afiliado) — nenhum deles aparece no site público enquanto estiver com esse valor; os blocos que dependem deles ficam ocultos até serem preenchidos. Edite direto pelo `/admin`, em "Configurações do Site → Dados do Site" e "→ Links de Afiliados".
