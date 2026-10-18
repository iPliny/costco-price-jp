// 在 npm run build（或 build:preview）後檢查真正產出的頁面。
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = process.argv[2] || 'dist';
const preview = process.argv.includes('--preview');
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((e) => e.isDirectory() ? files(join(dir, e.name)) : join(dir, e.name)))).flat();
}
const pages = new Map();
for (const file of await files(root)) {
  if (!file.endsWith('.html')) continue;
  const html = await readFile(file, 'utf8');
  const path = relative(root, file).replaceAll('\\', '/').replace(/index\.html$/, '');
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
  pages.set(path, { html, canonical });
}
let alternates = 0;
for (const [path, { html, canonical }] of pages) {
  if (path === '404.html') {
    assert.ok(html.includes('noindex'), path);
    assert.ok(!canonical, '404 cannot canonicalize to homepage');
    continue;
  }
  // 既有 github.io 舊網址轉址頁不屬於一般資訊頁。
  if (html.includes('http-equiv="refresh"')) continue;
  assert.ok(canonical?.startsWith('https://costco.crawlsnek.com/'), `canonical ${path}`);
  assert.ok(/<meta\b[^>]*name="description"[^>]*content="[^"]+"/.test(html), `description ${path}`);
  assert.ok(html.includes('property="og:title"'), `OG ${path}`);
  assert.equal(html.includes('name="robots" content="noindex"'), preview || path.includes('favorites/'), `robots ${path}`);
  const nodes = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((m) => JSON.parse(m[1]));
  assert.ok(nodes.some((x) => x['@type'] === 'WebPage'), `WebPage ${path}`);
  if (/(?:^|\/)(item|category)\//.test(path)) assert.ok(nodes.some((x) => x['@type'] === 'BreadcrumbList'), `breadcrumbs ${path}`);
  assert.ok(!nodes.some((x) => ['Offer', 'AggregateOffer'].includes(x['@type'])), `historical price is not an offer: ${path}`);
  for (const m of html.matchAll(/<link\b[^>]*rel="alternate"[^>]*hreflang="[^"]+"[^>]*href="([^"]+)"/g)) {
    const target = new URL(m[1]);
    assert.equal(pages.get(target.pathname.slice(1))?.canonical, m[1], `hreflang target must be canonical: ${path}`);
    alternates++;
  }
}
assert.ok(pages.has('404.html'), 'root 404.html disables the Cloudflare Pages SPA fallback');
console.log(`SEO checks passed: ${pages.size} HTML pages, ${alternates} canonical language alternates; preview=${preview}`);
