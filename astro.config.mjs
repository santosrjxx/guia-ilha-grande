import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import remarkFixNbsp from './src/remark-fix-nbsp.mjs';

// Protocolo Genilson: Astro SSG estático, zero JS por padrão, foco em Core Web Vitals.
export default defineConfig({
  site: 'https://www.guiailhagrande.com.br',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap(), mdx()],
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
  },
  markdown: {
    remarkPlugins: [remarkFixNbsp],
  },
});
