import { loadMonthly, loadProducts, populatedCategories, inCategory, latestPublicDate, latestDate, loadLatestPublicDate } from '../lib/data.js';
import { LANGS } from '../lib/i18n.js';
import { loadPosts } from '../lib/blog.js';

export function GET({ site }) {
  const base = import.meta.env.BASE_URL;
  const products = loadProducts();
  const latest = loadLatestPublicDate();
  const productDates = new Map(products.map((p) => [p.id, latestPublicDate(p.observations)]));
  const paths = [
    ...['', 'deals/', 'recent/', 'recent/online/'].map((path) => ({ path, lastmod: latest })),
    ...['about/', 'ranking/'].map((path) => ({ path })),
    ...loadMonthly().map((e) => ({ path: `ranking/monthly/${e.month}/`, lastmod: latestDate([e.to]) })),
    ...products.map((p) => ({ path: `item/${p.id}/`, lastmod: productDates.get(p.id) })),
    ...populatedCategories(products).map((c) => ({ path: `category/${c.id}/`,
      lastmod: latestDate(products.filter((p) => inCategory(p, c.id)).map((p) => productDates.get(p.id))) })),
  ];
  const url = (lang, path) => new URL(base + LANGS[lang].prefix + path, site).href;
  const entries = paths.flatMap(({ path, lastmod }) =>
    Object.keys(LANGS).map(
      (lang) => `  <url>
    <loc>${url(lang, path)}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}${Object.entries(LANGS)
  .map(([l, v]) => `    <xhtml:link rel="alternate" hreflang="${v.htmlLang}" href="${url(l, path)}"/>`)
  .join('\n')}
  </url>`
    )
  );
  // 週報只有中文版，不加 hreflang。
  const zhOnly = ['blog/', ...loadPosts().map((p) => `blog/${p.slug}/`)].map((path) => `  <url>
    <loc>${url('zh', path)}</loc>
  </url>`);
  entries.push(...zhOnly);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
