const { AppError } = require('./errors');
const { requestJson } = require('./http');

function filtersUrl(connection, filters, size) {
  const url = new URL(`${connection.commerceUrl}/rest/${connection.storeCode}/V1/products`);
  const query = url.searchParams;
  query.set('searchCriteria[pageSize]', String(size));
  query.set('searchCriteria[currentPage]', '1');
  query.set('searchCriteria[sortOrders][0][field]', 'sku');
  query.set('searchCriteria[sortOrders][0][direction]', 'ASC');
  query.set('fields', 'items[sku,name,type_id],total_count');
  filters.forEach(([field, value, condition], index) => {
    const prefix = `searchCriteria[filter_groups][0][filters][${index}]`;
    query.set(`${prefix}[field]`, field);
    query.set(`${prefix}[value]`, value);
    query.set(`${prefix}[condition_type]`, condition);
  });
  return url.href;
}

async function list(connection, filters, size) {
  const data = await requestJson(filtersUrl(connection, filters, size), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${connection.commerceToken}` },
  }, 'Adobe Commerce', connection.publicOnly);
  if (!data || !Array.isArray(data.items) || data.items.length > size ||
    !Number.isInteger(data.total_count) || data.total_count < data.items.length ||
    data.items.some((p) => typeof p?.sku !== 'string' || !p.sku || typeof p.name !== 'string' || typeof p.type_id !== 'string')) {
    throw new AppError('Adobe Commerce returned an invalid product list.', 502);
  }
  return { items: data.items.map((p) => ({ sku: p.sku, name: p.name, type: p.type_id })), total: data.total_count };
}

async function searchProducts(connection, { q = '' }) {
  if (typeof q !== 'string' || q.length > 200) throw new AppError('Search must be at most 200 characters.');
  // REST getList includes non-visible simple products used as configurable variants.
  const value = `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;
  return list(connection, [['sku', value, 'like'], ['name', value, 'like']], 50);
}

async function validateSkus(connection, skus) {
  if (!skus.length) return;
  // OR equality filters preserve commas and original SKU case; never uppercase SKUs.
  const result = await list(connection, skus.map((sku) => ['sku', sku, 'eq']), 100);
  const found = new Set(result.items.map((p) => p.sku));
  if (skus.some((sku) => !found.has(sku))) {
    throw new AppError('One or more selected SKUs no longer exist in this Commerce instance. Reload and select them again.');
  }
}
module.exports = { searchProducts, validateSkus };
