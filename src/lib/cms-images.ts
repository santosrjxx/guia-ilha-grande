// Resolve o caminho público de uma imagem enviada pelo CMS (ex.: "/articles/foo.webp",
// vindo direto do campo heroImage/logoUrl) pra sua cópia espelhada em src/assets/cms,
// gerada por scripts/mirror-cms-images.mjs antes do build. Só imagens que passam por essa
// cópia (dentro de src/) entram no pipeline de otimização do Astro — arquivos que ficam
// direto em public/ são sempre copiados como estão, sem processamento algum.
import type { ImageMetadata } from 'astro';

const modules = import.meta.glob<{ default: ImageMetadata }>('/src/assets/cms/**/*', { eager: true });

export function resolveCmsImage(publicPath?: string | null): ImageMetadata | undefined {
  if (!publicPath) return undefined;
  return modules[`/src/assets/cms${publicPath}`]?.default;
}
