// One-off probe: does the discount show for a logged-out visitor once JS runs?
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ userAgent: 'costco-price-jp research bot (+https://ipliny.github.io/costco-price-jp/)', locale: 'ja-JP' });
const apis = [];
p.on('response', async (r) => {
  const u = r.url();
  if (/rest\/v2\/japan\/.*(product|price|discount|coupon)/i.test(u)) {
    let body = '';
    try { body = await r.text(); } catch {}
    const hits = [...body.matchAll(/"[^"]*(?:[Dd]iscount|[Cc]oupon|[Pp]rice)[^"]*"\s*:\s*[^,\n]{0,80}/g)].map((m) => m[0]).slice(0, 25);
    apis.push(u.slice(0, 160) + '\n     ' + hits.join('\n     '));
  }
});
for (const item of ['84838']) {
  await p.goto('https://www.costco.co.jp/p/' + item, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(4000);
  const t = await p.evaluate(() => { const e = document.querySelector('.product-price-container, sip-product-details .price, .price'); return e ? e.closest('div').parentElement.innerText : '(no price block)'; });
  console.log('===== ' + item + ' rendered price block =====\n' + t);
}
console.log('===== API calls =====\n' + apis.join('\n'));
await b.close();
