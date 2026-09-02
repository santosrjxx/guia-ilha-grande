import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/articles' }),
  schema: z.object({
      title: z.string(),
      seoTitle: z.string().nullish(),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use apenas letras minúsculas, números e hífens')
        .nullish(),
      description: z.string(),
      silo: z.enum(['onde-comer', 'o-que-fazer', 'onde-ficar', 'guia-pratico']),
      heroImage: z.string().nullish(),
      heroImageAlt: z.string().nullish(),
      // Dimensões reais da imagem (evita layout shift no hero do artigo, que é
      // renderizado responsivo sem object-fit). Padrão 16:9, igual às ilustrações
      // SVG do site — só precisa ser preenchido quando a imagem for uma foto com
      // outra proporção.
      heroImageWidth: z.number().int().positive().nullable().optional().transform((v) => v ?? 1200),
      heroImageHeight: z.number().int().positive().nullable().optional().transform((v) => v ?? 675),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().nullish(),
      author: z.string().default('Equipe Guia Ilha Grande'),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      popular: z.boolean().default(false),
      faq: z
        .array(
          z.object({
            question: z.string(),
            answer: z.string(),
          })
        )
        .nullish(),
    }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { articles, pages };
