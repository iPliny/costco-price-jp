import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { makeRedirectStubs, OLD_BASE } from '../tools/make_redirect_stubs.mjs';

const site = 'https://costco.crawlsnek.com';

function navigate(html, pathname, search = '?q=%E7%B1%B3&sort=new', hash = '#prices') {
  let target;
  vm.runInNewContext(html.match(/<script>(.*?)<\/script>/s)[1], {
    location: { origin: 'https://old.example', pathname, search, hash, replace: (url) => { target = url; } },
  });
  return target;
}

test('redirects cover built indexes and sitemap-only URLs while preserving query and hash', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'redirect-stubs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dist = path.join(dir, 'dist'), output = path.join(dir, 'redirect');
  for (const route of ['', 'item/123/', 'zh-hant/', 'favorites/']) {
    await mkdir(path.join(dist, route), { recursive: true });
    await writeFile(path.join(dist, route, 'index.html'), '<html>not copied</html>');
  }
  await writeFile(path.join(dist, 'sitemap.xml'), `<urlset>
    <url><loc>${site}/</loc></url>
    <url><loc>${site}/item/123/</loc></url>
    <url><loc>${site}/sitemap-only/</loc></url>
  </urlset>`);
  await mkdir(output);
  await writeFile(path.join(output, 'stale.html'), 'stale');
  assert.equal(await makeRedirectStubs(dist, output), 5);
  await assert.rejects(access(path.join(output, 'stale.html')));
  await access(path.join(output, '.nojekyll'));
  for (const route of ['', 'item/123/', 'zh-hant/', 'favorites/', 'sitemap-only/']) {
    const html = await readFile(path.join(output, route, 'index.html'), 'utf8');
    assert.ok(html.includes(`<link rel="canonical" href="${site}/${route}">`));
    assert.ok(html.includes(`<meta http-equiv="refresh" content="0; url=${site}/${route}">`));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
    assert.ok(html.includes('新しいURLへ移動しました'));
    assert.ok(html.includes('網站已搬到新網址'));
    assert.equal(navigate(html, OLD_BASE + route), `${site}/${route}?q=%E7%B1%B3&sort=new#prices`);
    assert.equal(navigate(html, OLD_BASE + route, '', ''), `${site}/${route}`);
    assert.ok(!html.includes('not copied'));
  }
  const fallback = await readFile(path.join(output, '404.html'), 'utf8');
  assert.equal(navigate(fallback, OLD_BASE + 'zh-hant/item/999/'), `${site}/zh-hant/item/999/?q=%E7%B1%B3&sort=new#prices`);
  assert.equal(navigate(fallback, OLD_BASE.slice(0, -1), '', ''), `${site}/`);
  assert.equal(navigate(fallback, '/unrelated/', '', ''), `${site}/`);
  assert.equal(new URL(navigate(fallback, OLD_BASE + '/external.example/')).origin, site);
  assert.ok(!fallback.includes('http-equiv="refresh"'), '404 must not drop the requested path via a homepage refresh');

  await writeFile(path.join(dist, 'sitemap.xml'), '<urlset><url><loc>https://unexpected.example/</loc></url></urlset>');
  await assert.rejects(makeRedirectStubs(dist, output), /Unexpected sitemap URL/);
  await access(path.join(output, 'item/123/index.html'));
});
