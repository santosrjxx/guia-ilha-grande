// Configuração central do site. Dados editáveis (nome, contatos, silos, afiliados) vivem em
// src/data/site-config.json — editável também pelo painel de admin (/admin). O que fica aqui
// (SiloKey, NAV_LINKS, AD_CONTACT_URL) é estrutural e ligado às rotas do site.

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
  whatsapp: string;
  founderName: string;
};

export type SiloKey = 'onde-comer' | 'o-que-fazer' | 'onde-ficar' | 'guia-pratico';

export const SILOS: Record<
  SiloKey,
  { title: string; heading: string; slug: SiloKey; shortDescription: string; icon: string }
> = Object.fromEntries(
  Object.entries(siteConfig.silos).map(([slug, data]) => [slug, { ...data, slug }])
) as Record<SiloKey, { title: string; heading: string; slug: SiloKey; shortDescription: string; icon: string }>;

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
// sincronizados porque vêm do mesmo arquivo. O link curto fica na raiz do domínio
// (ex.: /mochila-trilha/, não /go/mochila-trilha/); o worker só ativa esse redirecionamento
// quando não existe nenhuma página ou artigo real com o mesmo slug.
export const AFFILIATE_LINKS = (affiliateLinksData as { links: AffiliateLink[] }).links;

export const goLink = (slug: string) => `/${slug}/`;

export const AD_CONTACT_URL = '/anuncie/';

// Marcador para campos de dado real que ainda não foram preenchidos (ex.: WhatsApp,
// tag de afiliado). Nunca deve aparecer visível pro visitante — todo trecho que
// consome um desses campos precisa checar `isPending` antes de renderizar.
export const PENDING = '[PENDENTE - editar no CMS]';
export const isPending = (value: string) => value.trim() === PENDING;
