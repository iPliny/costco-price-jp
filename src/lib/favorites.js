// 收藏（POYU 2026-10-10）：網站沒有登入，收藏的商品番号只存在這台裝置的瀏覽器（localStorage）。
// 日文與中文頁共用同一份清單；新加入的排在最前面。
export const STORAGE_KEY = 'costco-price-jp:favorites';

export function parseFavorites(raw) {
  try {
    const list = JSON.parse(raw ?? '[]');
    return Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === 'string' && x))] : [];
  } catch {
    return [];
  }
}

export function toggled(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
}

export function getFavorites() {
  try {
    return parseFavorites(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 無痕模式等無法儲存時，只在這一頁有效。
  }
  document.dispatchEvent(new CustomEvent('favorites-change', { detail: list }));
}

let memory = null;
const current = () => memory ?? getFavorites();

// 頁面上所有 [data-fav] 按鈕與 [data-fav-count] 數字跟著清單更新。
export function render(list = current()) {
  for (const b of document.querySelectorAll('[data-fav]')) {
    const on = list.includes(b.dataset.fav);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? b.dataset.labelOn : b.dataset.labelOff);
    b.title = on ? b.dataset.labelOn : b.dataset.labelOff;
    const text = b.querySelector('.fav-text');
    if (text) text.textContent = on ? b.dataset.textOn : b.dataset.textOff;
  }
  for (const c of document.querySelectorAll('[data-fav-count]')) {
    c.textContent = list.length ? String(list.length) : '';
    c.hidden = !list.length;
  }
}

export function initFavorites() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-fav]');
    if (!b) return;
    e.preventDefault();
    memory = toggled(current(), b.dataset.fav);
    save(memory);
    render(memory);
  });
  // 其他分頁改了收藏時同步。
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { memory = null; render(); document.dispatchEvent(new CustomEvent('favorites-change', { detail: current() })); }
  });
  render();
}
