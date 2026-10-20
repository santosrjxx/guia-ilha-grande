// Configuração central do site. Dados editáveis (nome, contatos, silos, afiliados) vivem em
// src/data/site-config.json — editável também pelo painel de admin (/admin). O que fica aqui
// (SiloKey, NAV_LINKS) é estrutural e ligado às rotas do site.

import siteConfig from './data/site-config.json';
import affiliateLinksData from './data/affiliate-links.json';

export const SITE = siteConfig.site as {
  name: string;
  tagline: string;
  description: string;
  url: string;
  locale: string;
  lang: string;
  email: string;
  founderName: string;
};

export const ANALYTICS = siteConfig.analytics as {
  gaMeasurementId: string;
  searchConsoleVerification: string;
};

export type SiloKey = 'onde-comer' | 'o-que-fazer' | 'onde-ficar' | 'guia-pratico';

export const SILOS: Record<
  SiloKey,
  { title: string; heading: string; slug: SiloKey; shortDescription: string; icon: string }
> = Object.fromEntries(
  Object.entries(siteConfig.silos).map(([slug, data]) => [slug, { ...data, slug }])
) as Record<SiloKey, { title: string; heading: string; slug: SiloKey; shortDescription: string; icon: string }>;

// Transforma texto livre num slug de URL (minúsculas, sem acento, só letras/números/hífen).
// Usado como fallback quando o artigo não tem o campo "Slug" preenchido no CMS.
export const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

type ArticleLike = { data: { silo: SiloKey; slug?: string | null; title: string } };

// Slug final do artigo: usa o campo "Slug" do CMS se preenchido, senão deriva do título.
export const articleSlug = (article: ArticleLike) => article.data.slug || slugify(article.data.title);

// Artigo "pilar" de cada silo — o único que ocupa a URL raiz da categoria (ex.: /guia-pratico/),
// igual sempre foi. Fixo aqui no código (não é um campo do CMS) justamente pra nunca ser
// trocado sem querer só por escolher a categoria de um artigo novo no painel — pra trocar o
// pilar de um silo, é preciso mexer neste mapa. Artigos que têm essa categoria mas não são
// o pilar (ex.: "Barca para Ilha Grande" em "guia-pratico") ganham uma URL própria e direta
// na raiz do site (/[slug]/) — a categoria neles vira só uma etiqueta, não muda a silo.
export const SILO_PILLAR_SLUG: Record<SiloKey, string> = {
  'onde-comer': 'onde-comer-ilha-grande',
  'o-que-fazer': 'o-que-fazer-em-ilha-grande',
  'onde-ficar': 'onde-ficar-em-ilha-grande',
  'guia-pratico': 'como-chegar-custos-e-logistica',
};

export const isPillarArticle = (article: ArticleLike) =>
  SILO_PILLAR_SLUG[article.data.silo] === articleSlug(article);

// URL completa do artigo: o pilar de cada silo mora na URL raiz da categoria (ex.: /guia-pratico/);
// qualquer outro artigo mora direto na raiz do site (ex.: /barca-ilha-grande-horarios-precos/).
export const articleUrl = (article: ArticleLike) =>
  isPillarArticle(article) ? `/${article.data.silo}/` : `/${articleSlug(article)}/`;

export const NAV_LINKS = [
  { href: '/', label: 'Início' },
  { href: '/onde-comer/', label: SILOS['onde-comer'].title },
  { href: '/o-que-fazer/', label: SILOS['o-que-fazer'].title },
  { href: '/onde-ficar/', label: SILOS['onde-ficar'].title },
  { href: '/guia-pratico/', label: SILOS['guia-pratico'].title },
  { href: '/sobre/', label: 'Sobre' },
  { href: '/contato/', label: 'Contato' },
];

export const DESIGN = siteConfig.design as {
  logoUrl: string;
  faviconUrl: string;
  colors: {
    primary: string;
    primaryDark: string;
    accent: string;
    accentDark: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    border: string;
  };
  fonts: { body: string; heading: string };
  radius: string;
};

export interface AffiliateLink {
  slug: string;
  label: string;
  provider: 'amazon' | 'mercadoLivre' | 'booking' | 'rentcar' | 'outro';
  destinationUrl: string;
  active: boolean;
}

// Links de afiliado editáveis em /admin ("Links de Afiliados"). O redirecionador em si
// roda no worker (worker/index.ts), que importa o mesmo JSON — os dois lados ficam sempre
// sincronizados porque vêm do mesmo arquivo. O link curto fica na raiz do domínio, com um
// código de 2 letras do provedor no final (ex.: /mochila-trilha/am/ pra Amazon); o worker só
// ativa esse redirecionamento quando não existe nenhuma página ou artigo real com o mesmo
// endereço. Precisa bater exatamente com PROVIDER_CODES em worker/index.ts.
export const AFFILIATE_LINKS = (affiliateLinksData as { links: AffiliateLink[] }).links;

const PROVIDER_CODES: Record<AffiliateLink['provider'], string> = {
  amazon: 'am',
  mercadoLivre: 'ml',
  booking: 'bk',
  rentcar: 'rc',
  outro: 'ot',
};

export const goLink = (slug: string, provider: AffiliateLink['provider']) =>
  `/${slug}/${PROVIDER_CODES[provider]}/`;

// Marcador para campos de dado real que ainda não foram preenchidos (ex.: WhatsApp,
// tag de afiliado). Nunca deve aparecer visível pro visitante — todo trecho que
// consome um desses campos precisa checar `isPending` antes de renderizar.
export const PENDING = '[PENDENTE - editar no CMS]';
export const isPending = (value: string) => value.trim() === PENDING;

// Tolera o erro comum de colar a tag <meta ...> inteira em vez de só o código de
// verificação: se o valor vier com content="...", extrai só o que está dentro das aspas.
export const extractVerificationCode = (value: string) => {
  const match = value.match(/content=["']([^"']+)["']/);
  return match ? match[1] : value.trim();
};
