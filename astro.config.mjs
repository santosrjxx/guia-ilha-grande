import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// Protocolo Jenival: Astro SSG estático, zero JS por padrão, foco em Core Web Vitals.
export default defineConfig({
  site: 'https://www.guiailhagrande.com.br',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap(), mdx()],
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
  },
});
