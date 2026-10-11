import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://costco.crawlsnek.com';
export const OLD_BASE = '/costco-price-jp/';

const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const jsString = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function page(target, script, refresh = true) {
  const href = escapeHtml(target);
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>新しいURLへ移動しました／網站已搬到新網址</title>
  <link rel="canonical" href="${href}">
  ${refresh ? `<meta http-equiv="refresh" content="0; url=${href}">` : ''}
  <meta name="robots" content="noindex">
  <script>${script}</script>
</head>
<body>
  <p>新しいURLへ移動しました。</p>
  <p lang="zh-Hant">網站已搬到新網址。</p>
  <a id="destination" href="${href}">${href}</a>
  <script>document.getElementById('destination').href = target;</script>
</body>
</html>
`;
}

async function indexPaths(dir, relative = '') {
  const paths = [];
  for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) paths.push(...await indexPaths(dir, name));
    else if (entry.isFile() && entry.name === 'index.html') {
      paths.push('/' + name.slice(0, -'index.html'.length));
    }
  }
  return paths;
}

export async function makeRedirectStubs(dist = 'dist', output = 'dist-redirect') {
  const paths = new Set(await indexPaths(dist));
  const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
  // The site's generated sitemap contains absolute URLs without XML entities.
  // Fail before replacing the old output if an unexpected host/path appears.
  for (const [, loc] of sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const url = new URL(loc);
    if (url.origin !== SITE || url.search || url.hash || /[&%\\]/.test(url.pathname)) {
      throw new Error(`Unexpected sitemap URL: ${loc}`);
    }
    paths.add(url.pathname);
  }
  if (!paths.has('/')) throw new Error('Missing built homepage');

  await rm(output, { recursive: true, force: true });
  for (const route of [...paths].sort()) {
    const filename = route.endsWith('/') ? route + 'index.html' : route;
    const destination = path.join(output, filename.slice(1));
    const target = SITE + route;
    const script = `const target = ${jsString(target)} + location.search + location.hash; if (location.origin !== ${jsString(SITE)}) location.replace(target);`;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, page(target, script));
  }

  // GitHub serves this file for old deep links without a prebuilt stub.
  // Construct from a fixed origin, so a double slash cannot change the host.
  const fallback = `const base = ${jsString(OLD_BASE)}; const route = location.pathname.startsWith(base) ? location.pathname.slice(base.length - 1) : '/'; const target = ${jsString(SITE)} + route + location.search + location.hash; if (location.origin !== ${jsString(SITE)}) location.replace(target);`;
  await writeFile(path.join(output, '404.html'), page(SITE + '/', fallback, false));
  await writeFile(path.join(output, '.nojekyll'), '');
  console.log(`Generated ${paths.size} redirect pages and 404.html in ${output}`);
  return paths.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await makeRedirectStubs();
}
