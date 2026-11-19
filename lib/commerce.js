const { AppError } = require('./errors');
const { requestJson } = require('./http');
const { commerceHeaders } = require('./commerce-auth');

function filtersUrl(connection, filters, size) {
  const path = connection.commerceType === 'accs' ? '/V1/products' : `/rest/${connection.storeCode}/V1/products`;
  const url = new URL(`${connection.commerceUrl}${path}`);
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

async function list(connection, filters, size, identity) {
  let data;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = await commerceHeaders(connection, identity, attempt > 0);
    try {
      data = await requestJson(filtersUrl(connection, filters, size), { headers }, 'Adobe Commerce', connection.publicOnly);
      break;
    } catch (error) {
      if (connection.commerceType === 'accs' && error instanceof AppError && [401, 403].includes(error.status)) {
        if (error.status === 401 && connection.authMode === 'server' && attempt === 0) continue;
        throw new AppError(connection.authMode === 'server'
          ? 'ACCS rejected the service account. Check its commerce.accs scope, Commerce catalog permissions, organization and tenant.'
          : 'Your AEM IMS session is not authorized for ACCS. Commerce requires commerce.accs, a Commerce-enabled OAuth client and catalog permissions. Reopen the panel with an authorized session or select a server-side connectionId.', error.status);
      }
      throw error;
    }
  }
  if (!data || !Array.isArray(data.items) || data.items.length > size ||
    !Number.isInteger(data.total_count) || data.total_count < data.items.length ||
    data.items.some((p) => typeof p?.sku !== 'string' || !p.sku || typeof p.name !== 'string' || typeof p.type_id !== 'string')) {
    throw new AppError('Adobe Commerce returned an invalid product list.', 502);
  }
  return { items: data.items.map((p) => ({ sku: p.sku, name: p.name, type: p.type_id })), total: data.total_count };
}

async function searchProducts(connection, { q = '' }, identity) {
  if (typeof q !== 'string' || q.length > 200) throw new AppError('Search must be at most 200 characters.');
  // REST getList includes non-visible simple products used as configurable variants.
  const value = `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;
  return list(connection, [['sku', value, 'like'], ['name', value, 'like']], 50, identity);
}

async function validateSkus(connection, skus, identity) {
  if (!skus.length) return;
  // OR equality filters preserve commas and original SKU case; never uppercase SKUs.
  const result = await list(connection, skus.map((sku) => ['sku', sku, 'eq']), 100, identity);
  const found = new Set(result.items.map((p) => p.sku));
  if (skus.some((sku) => !found.has(sku))) {
    throw new AppError('One or more selected SKUs no longer exist in this Commerce instance. Reload and select them again.');
  }
}
module.exports = { searchProducts, validateSkus };
