import fs from 'node:fs';
import path from 'node:path';

// 週報（中文）文章：data/blog/<slug>.html，一篇一個檔。
// 檔案開頭是 <!--POST {...}--> 的 JSON，之後是正文 HTML（h2、h3、p、a、strong、small、table、ul）。
// 網址：/zh-hant/blog/<slug>/，slug 就是檔名，發布後不再改。
export const BLOG_DIR = 'data/blog';
const META_RE = /^\s*<!--POST\s*([\s\S]*?)-->\s*/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const FIXED_LABELS = ['好市多', '日本物價', '週報'];
export const MAX_DESCRIPTION = 150;

export function parsePost(slug, text) {
  const m = text.match(META_RE);
  if (!m) throw new Error(`${slug}: 缺少開頭的 <!--POST {...}-->`);
  const meta = JSON.parse(m[1]);
  return { slug, ...meta, html: text.slice(m[0].length).trim() };
}

// 回傳錯誤訊息陣列；空陣列代表通過。
export function checkPost(p) {
  const e = [];
  if (!SLUG_RE.test(p.slug)) e.push('檔名只能用小寫英數與連字號');
  if (!p.title) e.push('缺少 title');
  if (!DATE_RE.test(p.date ?? '')) e.push('date 須為 YYYY-MM-DD');
  if (p.updated && !DATE_RE.test(p.updated)) e.push('updated 須為 YYYY-MM-DD');
  if (!p.description) e.push('缺少 description');
  else if ([...p.description].length > MAX_DESCRIPTION) e.push(`description 超過 ${MAX_DESCRIPTION} 字元`);
  if (!Array.isArray(p.labels) || p.labels.length !== 5) e.push('labels 須剛好 5 個');
  else if (!FIXED_LABELS.every((l) => p.labels.includes(l))) e.push(`labels 須包含 ${FIXED_LABELS.join('、')}`);
  else if (new Set(p.labels).size !== 5) e.push('labels 不可重複');
  if (/<script|<iframe|<style|\son\w+=/i.test(p.html)) e.push('正文不可含 script、iframe、style 或事件屬性');
  if (/ipliny\.github\.io/i.test(p.html)) e.push('正文仍有舊的 github.io 網址');
  return e;
}

export function loadPosts(dir = BLOG_DIR) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return [];
  const posts = fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.html'))
    .map((f) => parsePost(f.slice(0, -5), fs.readFileSync(path.join(abs, f), 'utf8')));
  for (const p of posts) {
    const errors = checkPost(p);
    if (errors.length) throw new Error(`data/blog/${p.slug}.html：${errors.join('；')}`);
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date) || (b.issue ?? 0) - (a.issue ?? 0));
}
