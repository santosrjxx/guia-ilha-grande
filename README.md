# Guia Ilha Grande

Site estático (Astro SSG) do guia de turismo para Ilha Grande, RJ. Conteúdo editável via Sveltia CMS, deploy automático para Cloudflare Workers.

## Stack

- **Astro 5** (`output: 'static'`) — zero JS por padrão
- **Sveltia CMS** (`/admin/cms/`) — edição de conteúdo sem tocar em código (sucessor moderno e compatível do Decap/Netlify CMS), atrás de um dashboard próprio em `/admin/`
- **Cloudflare Workers** (Wrangler) — hospedagem do site, proxy de autenticação OAuth do CMS e o encurtador de links de afiliado (`/go/...`)

## Comandos

- `npm install` — instala as dependências
- `npm run dev` — ambiente de desenvolvimento local do site (`http://localhost:4321`), via Astro
- `npm run build` — gera o site estático em `dist/`
- `npm run preview` — serve o build de `dist/` localmente
- `npx wrangler dev` — sobe o **Worker** localmente (útil pra testar `/go/<slug>` e o proxy OAuth de verdade, coisas que `npm run dev` não executa)

### Editar conteúdo localmente (sem precisar de GitHub)

O Sveltia CMS não usa mais `decap-server`/proxy local (o script `npm run cms` do `package.json` é resquício do Decap CMS antigo e não faz mais nada útil). O fluxo local do Sveltia é outro, e só funciona no Chrome ou Edge:

1. Rode `npm run dev` e abra `http://localhost:4321/admin/cms/`
2. Clique em "Trabalhar com Repositório Local" e selecione a pasta raiz do projeto
3. Edite normalmente — as mudanças vão direto pros arquivos locais. **Não há git automático**: dê `git add`/`commit`/`push` você mesmo quando terminar.

## Estrutura de conteúdo

- `src/content/articles/` — artigos (Markdown/MDX), cada um pertence a um silo (`onde-comer`, `o-que-fazer`, `onde-ficar`, `guia-pratico`)
- `src/content/pages/` — as 4 páginas institucionais fixas (Sobre, Contato, Política de Privacidade, Política Editorial)
- `src/data/site-config.json` — dados gerais do site, cores, textos dos silos
- `src/data/affiliate-links.json` — links de afiliado (ver seção abaixo)

Tudo isso é editável pelo editor em `/admin/cms/` sem precisar mexer em código — o `public/admin/cms/config.yml` espelha os campos de `src/content.config.ts` e dos arquivos em `src/data/`.

## Painel (`/admin/`) e editor (`/admin/cms/`)

`/admin/` é um dashboard estático (gerado pelo Astro, `src/pages/admin/index.astro`) com estatísticas reais do conteúdo (total de artigos, publicados, rascunhos, links de afiliado ativos) e atalhos organizados por seção — é só um "hall de entrada", não tem login nem edita nada diretamente. A edição de verdade (criar/editar artigos, páginas, configurações) acontece no Sveltia CMS, em `/admin/cms/`, pra onde os atalhos do dashboard levam direto (inclusive já abrindo a coleção ou o registro certo).

Como o dashboard só mostra contagens (nenhum título, nenhum conteúdo), não tem proteção própria — a mesma exposição que `/admin/cms/` já tinha antes.

## Links de afiliado (`/go/...`)

Em vez de colar a URL de afiliado crua em cada artigo, os links vivem centralizados em `src/data/affiliate-links.json` (editável em `/admin/cms/` → "Links de Afiliados"). Cada um tem um `slug` curto, e o Worker responde em `/go/<slug>/` redirecionando pro link real e contando o clique numa KV (`AFFILIATE_CLICKS`, ver `wrangler.jsonc`).

Vantagens: trocar a URL de destino (ex.: quando a tag de afiliado real estiver disponível) não exige editar artigo por artigo, e dá pra ver quantos cliques cada link recebeu.

Ver a contagem de cliques: `https://<domínio>/go/stats?key=<STATS_SECRET>` — o valor de `STATS_SECRET` está configurado como secret do Worker (veja abaixo); sem a chave certa, retorna 403.

## Deploy (produção)

O deploy é automático via GitHub Actions (`.github/workflows/deploy.yml`) a cada push na branch `main`: builda o site e publica no Cloudflare Workers com `npx wrangler deploy`.

Secrets necessários no GitHub (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Autenticação do editor (`/admin/cms/`)

Em produção, o login do Sveltia CMS usa um proxy de OAuth do GitHub rodando no próprio Worker (`worker/index.ts`). O Sveltia CMS sempre abre o popup de login em `<base_url>/auth` (caminho fixo, não configurável em `config.yml`) — o Worker também responde em `/api/auth`/`/api/callback` como alias do fluxo antigo (usado antes pelo Decap CMS), então funciona independentemente de qual URL estiver cadastrada no GitHub OAuth App.

Para isso funcionar, o Worker precisa de dois secrets — **não são secrets do GitHub Actions, são do Cloudflare Worker**, configurados via Wrangler:

```
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put STATS_SECRET
```

- `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` vêm de um GitHub OAuth App (**GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**) configurado com:
  - **Homepage URL**: a URL de produção do site
  - **Authorization callback URL**: `https://<domínio-ou-subdomínio-workers.dev>/api/callback`
- `STATS_SECRET` é uma string aleatória qualquer, escolhida por você — protege a página `/go/stats`.

Para testar localmente com esses valores, crie um arquivo `.dev.vars` na raiz (já está no `.gitignore`, nunca vai pro git) com:

```
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
STATS_SECRET=...
```

## Dados pendentes

Alguns campos ainda estão com o marcador `[PENDENTE - editar no CMS]` no lugar de um dado real (ex.: WhatsApp) — nenhum deles aparece no site público enquanto estiver com esse valor; os blocos que dependem deles ficam ocultos até serem preenchidos. Edite direto pelo `/admin/cms/`, em "Configurações do Site → Dados do Site".
