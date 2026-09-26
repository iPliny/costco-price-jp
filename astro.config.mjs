import { defineConfig } from 'astro/config';

// SITE / BASE are set by the deploy workflow; defaults work for local use.
export default defineConfig({
  site: process.env.SITE || undefined,
  base: process.env.BASE || '/',
  trailingSlash: 'always',
});
