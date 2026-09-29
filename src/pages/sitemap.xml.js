import { loadProducts, populatedCategories } from '../lib/data.js';
import { LANGS } from '../lib/i18n.js';

export function GET({ site }) {
  const base = import.meta.env.BASE_URL;
  const paths = ['', 'ranking/', ...loadProducts().map((p) => `item/${p.id}/`), ...populatedCategories().map((c) => `category/${c.id}/`)];
  const url = (lang, path) => new URL(base + LANGS[lang].prefix + path, site).href;
  const entries = paths.flatMap((path) =>
    Object.keys(LANGS).map(
      (lang) => `  <url>
    <loc>${url(lang, path)}</loc>
${Object.entries(LANGS)
  .map(([l, v]) => `    <xhtml:link rel="alternate" hreflang="${v.htmlLang}" href="${url(l, path)}"/>`)
  .join('\n')}
  </url>`
    )
  );
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
