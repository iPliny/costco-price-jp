import { defineConfig } from 'astro/config';

// SITE / BASE remain overridable for local builds and rollback deployments.
export default defineConfig({
  site: process.env.SITE || 'https://costco.crawlsnek.com',
  base: process.env.BASE || '/',
  trailingSlash: 'always',
});
