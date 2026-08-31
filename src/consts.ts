// Configuração central do site. Dados editáveis (nome, contatos, silos, afiliados) vivem em
// src/data/site-config.json — editável também pelo painel de admin (/admin). O que fica aqui
// (SiloKey, NAV_LINKS, AD_CONTACT_URL) é estrutural e ligado às rotas do site.

import siteConfig from './data/site-config.json';

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
  { title: string; slug: SiloKey; shortDescription: string; icon: string }
> = Object.fromEntries(
  Object.entries(siteConfig.silos).map(([slug, data]) => [slug, { ...data, slug }])
) as Record<SiloKey, { title: string; slug: SiloKey; shortDescription: string; icon: string }>;

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

export const AFFILIATE = siteConfig.affiliate as {
  amazon: { label: string; baseUrl: string; tag: string };
  mercadoLivre: { label: string; baseUrl: string; tag: string };
  booking: { label: string; baseUrl: string; aid: string };
  rentcar: { label: string; baseUrl: string; ref: string };
};

export const AD_CONTACT_URL = '/anuncie/';
