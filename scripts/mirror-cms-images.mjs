// Roda antes do `astro build` (veja package.json). Astro só otimiza imagens que ficam
// dentro de src/ (importadas pelo Vite) — arquivos em public/ são sempre copiados como
// estão, sem redimensionar nem comprimir. Mas as imagens do site são enviadas pelo CMS
// direto pra public/ (media_folder no config.yml), porque o painel precisa delas como URL
// pública pra pré-visualizar. Esse script resolve o conflito: copia (espelha) só os
// arquivos que algum artigo ou a config do site realmente usa pra dentro de
// src/assets/cms/, mantendo o mesmo caminho relativo — daí o componente CmsImage.astro usa
// essa cópia pra gerar a versão otimizada, e o arquivo original em public/ continua
// existindo normalmente (é inofensivo, só não é mais o que vai pro navegador).
import { readFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEST_DIR = path.join(ROOT, 'src/assets/cms');
const RASTER_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.avif', '.gif']);

async function collectReferencedPaths() {
  const paths = new Set();

  const siteConfig = JSON.parse(await readFile(path.join(ROOT, 'src/data/site-config.json'), 'utf8'));
  if (siteConfig.design?.logoUrl) paths.add(siteConfig.design.logoUrl);

  const articleFiles = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith('.mdx') || f.endsWith('.md'));
  for (const file of articleFiles) {
    const raw = await readFile(path.join(ARTICLES_DIR, file), 'utf8');
    const match = raw.match(/^heroImage:\s*(.+)$/m);
    if (!match) continue;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (value) paths.add(value);
  }

  return [...paths];
}

async function main() {
  const refs = await collectReferencedPaths();
  let copied = 0;

  for (const publicPath of refs) {
    if (!publicPath.startsWith('/')) continue;
    const ext = path.extname(publicPath).toLowerCase();
    if (!RASTER_EXT.has(ext)) continue; // SVG etc. não precisam (nem devem) passar pelo pipeline de raster

    const sourceFile = path.join(PUBLIC_DIR, publicPath);
    if (!existsSync(sourceFile)) {
      console.warn(`[mirror-cms-images] referenciado mas não encontrado em public${publicPath} — ignorando.`);
      continue;
    }

    const destFile = path.join(DEST_DIR, publicPath);
    await mkdir(path.dirname(destFile), { recursive: true });
    await copyFile(sourceFile, destFile);
    copied += 1;
  }

  console.log(`[mirror-cms-images] ${copied} imagem(ns) espelhada(s) em src/assets/cms/ pra otimização automática do build.`);
}

main();
