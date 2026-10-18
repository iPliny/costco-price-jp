// 結構化資料只描述資訊頁與導覽，不把歷史觀測價當成商店可購買的 Offer。
export function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function breadcrumb(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, item], index) => ({
      '@type': 'ListItem', position: index + 1, name, item,
    })),
  };
}

export function pageMetadata({ title, description, url, home, brand, language, isHome }) {
  const site = { '@type': 'WebSite', '@id': `${home}#website`, name: brand, url: home, inLanguage: language };
  const nodes = [{ '@context': 'https://schema.org', '@type': 'WebPage',
    '@id': `${url}#webpage`, name: title, description, url, inLanguage: language,
    isPartOf: { '@id': site['@id'] },
  }];
  if (isHome) nodes.push({ '@context': 'https://schema.org', ...site });
  return nodes;
}
