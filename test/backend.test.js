const { main } = require('../actions/manage');
const { assetResult, metadataForm, valuesFor } = require('../lib/assets');
const { searchProducts } = require('../lib/commerce');
jest.mock('@adobe/aio-lib-core-logging', () => () => ({ error: jest.fn() }));

const author = 'https://author.example.com';
const commerce = 'https://shop.example.com';
const path = '/content/dam/products/shoes/product.jpg';
const uuid = '12345678-1234-1234-1234-123456789012';
const profile = { imsOrg: 'org@AdobeOrg', aemAuthorUrl: author, commerceUrl: commerce, productsRoot: '/content/dam/products', storeCodes: ['default', 'fr'], commerceToken: 'commerce-only-token' };
const params = {
  __ow_method: 'post', __ow_headers: { authorization: 'Bearer aem-user-token', 'x-gw-ims-org-id': profile.imsOrg },
  CONNECTIONS_JSON: JSON.stringify({ store: profile }),
  connectionId: 'store', authorUrl: author, assetPath: path, apiKey: 'host-api-key',
};
const originalFetch = global.fetch;
let metadata;
let writes;
const product = (sku) => ({ sku, name: `Product ${sku}`, type_id: 'simple' });
beforeEach(() => {
  metadata = { 'dc:title': 'Keep title', 'dam:status': 'approved', 'other:field': ['keep'] };
  writes = 0;
  global.fetch = jest.fn(async (url, options) => {
    if (url.startsWith(commerce)) {
      const filters = new URL(url).searchParams;
      const search = filters.get('searchCriteria[filter_groups][0][filters][0][condition_type]') === 'like';
      const skus = search ? ['Parent', 'Parent-red-S'] : [...filters].filter(([key]) => key.endsWith('[value]')).map(([, value]) => value);
      return Response.json({ items: skus.map(product), total_count: skus.length });
    }
    if (url.startsWith(author)) {
      if (options.method === 'POST') {
        writes += 1;
        const fields = new URLSearchParams(options.body);
        for (const key of ['commerce:isCommerce', 'commerce:skus', 'commerce:roles', 'commerce:positions']) {
          const field = `./jcr:content/metadata/${key}`;
          if (fields.has(`${field}@Delete`)) delete metadata[key];
          if (fields.has(field)) metadata[key] = key === 'commerce:isCommerce' ? fields.get(field) : fields.getAll(field);
        }
        return new Response('<html>Saved</html>');
      }
      return Response.json({ 'jcr:primaryType': 'dam:Asset', 'jcr:uuid': uuid, 'jcr:content': { metadata } });
    }
    throw new Error('Unexpected origin');
  });
});
afterEach(() => { global.fetch = originalFetch; });
async function saveArgs(changes = {}) {
  const read = await main({ ...params, op: 'asset.get' });
  return { ...params, op: 'asset.save', revision: read.body.revision, skus: ['Parent-red-S'], roles: ['image', 'thumbnail'], positions: [2], isCommerce: true, ...changes };
}
test('searches real REST product names and SKUs, including hidden variants, in the chosen store', async () => {
  const result = await main({ ...params, op: 'products.search', q: 'red', storeCode: 'fr' });
  expect(result).toMatchObject({ statusCode: 200, body: { total: 2, items: [{ sku: 'Parent' }, { sku: 'Parent-red-S' }] } });
  const url = new URL(global.fetch.mock.calls.find(([url]) => url.startsWith(commerce))[0]);
  expect(url.pathname).toBe('/rest/fr/V1/products');
  expect(url.searchParams.get('searchCriteria[pageSize]')).toBe('50');
  expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][0][field]')).toBe('sku');
  expect(url.searchParams.get('searchCriteria[filter_groups][0][filters][1][field]')).toBe('name');
});
test('verifies metadata without copying assets or rewriting editorial fields and SKU case', async () => {
  const response = await main(await saveArgs());
  expect(response.statusCode).toBe(200);
  expect(response.body).toMatchObject({ skus: ['Parent-red-S'], positions: ['2'], roles: ['image', 'thumbnail'], isCommerce: true });
  expect(response.body.syncPending).toBe(true);
  expect(response.body.warning).toBeNull();
  expect(metadata['dc:title']).toBe('Keep title');
  expect(metadata['other:field']).toEqual(['keep']);
  expect(metadata['dam:status']).toBe('approved');
  expect(writes).toBe(1);
  for (const [url, options] of global.fetch.mock.calls) {
    const isAem = url.startsWith(author);
    expect(options.headers.Authorization).toBe(`Bearer ${isAem ? 'aem-user-token' : 'commerce-only-token'}`);
    expect(JSON.stringify(options)).not.toContain(isAem ? 'commerce-only-token' : 'aem-user-token');
  }
});
test('supports permanent unlink, deletes empty arrays, and never needs catalog access to remove all links', async () => {
  const args = await saveArgs({ skus: [], roles: [], positions: [], isCommerce: false });
  global.fetch.mockClear();
  const response = await main(args);
  expect(response).toMatchObject({ statusCode: 200, body: { skus: [], roles: [], positions: [], isCommerce: false } });
  expect(metadata['commerce:skus']).toBeUndefined();
  expect(global.fetch.mock.calls.some(([url]) => url.startsWith(commerce))).toBe(false);
});
test('does not approve a rejected asset and reports sync as pending', async () => {
  metadata['dam:status'] = 'rejected';
  const response = await main(await saveArgs());
  expect(response.statusCode).toBe(200);
  expect(response.body.warning).toContain('Approve');
  expect(metadata['dam:status']).toBe('rejected');
});
test('checks AEM user access before using Commerce credentials even with a spoofed org header', async () => {
  global.fetch.mockResolvedValueOnce(new Response('', { status: 403 }));
  const response = await main({ ...params, op: 'products.search', q: 'shoe' });
  expect(response.statusCode).toBe(403);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toContain(author);
});
test('rejects unknown SKU and stale revision without writing AEM', async () => {
  const args = await saveArgs();
  metadata['commerce:skus'] = ['Other'];
  expect((await main(args)).statusCode).toBe(409);
  const fresh = await saveArgs();
  const original = global.fetch.getMockImplementation();
  global.fetch.mockImplementation((url, options) => url.startsWith(commerce)
    ? Promise.resolve(Response.json({ items: [], total_count: 0 })) : original(url, options));
  expect((await main(fresh)).statusCode).toBe(400);
  expect(writes).toBe(0);
});
test('refuses success when AEM accepts POST without actually persisting metadata', async () => {
  const args = await saveArgs();
  const original = global.fetch.getMockImplementation();
  global.fetch.mockImplementation((url, options) => options.method === 'POST'
    ? Promise.resolve(new Response('saved')) : original(url, options));
  const response = await main(args);
  expect(response.statusCode).toBe(502);
  expect(response.body.error).toContain('could not be verified');
});
test.each([
  [{ __ow_method: 'get' }, 405],
  [{ __ow_headers: {} }, 401],
  [{ __ow_headers: { authorization: 'Bearer aem-user-token', 'x-gw-ims-org-id': 'wrong' } }, 403],
  [{ connectionId: 'absent' }, 400],
  [{ commerceUrl: 'https://attacker.example.com' }, 403],
  [{ assetPath: '/content/dam/elsewhere/a.jpg' }, 403],
  [{ assetPath: '/content/dam/products/%2e%2e/a.jpg' }, 400],
  [{ op: 'asset.delete' }, 400],
  [{ __ow_body: 'bad json' }, 400],
])('rejects invalid requests %j', async (changes, status) => {
  const response = await main({ ...params, op: 'asset.get', ...changes });
  expect(response.statusCode).toBe(status);
  expect(response.body.error).toEqual(expect.any(String));
  expect(writes).toBe(0);
});
test.each([{ isCommerce: 'yes' }, { skus: ['X', 'X'], positions: [1, 1] }, { positions: [0] }, { positions: [1.5] }, { roles: ['invalid'] }])('rejects invalid mappings %j', async (changes) => {
  const response = await main(await saveArgs(changes));
  expect(response.statusCode).toBe(400);
  expect(writes).toBe(0);
});
test('returns a sanitized 502 for network failure and never logs or returns secrets', async () => {
  global.fetch.mockRejectedValueOnce(new Error('private upstream token data'));
  const response = await main({ ...params, op: 'asset.get' });
  expect(response.statusCode).toBe(502);
  expect(JSON.stringify(response)).not.toMatch(/private upstream|commerce-only-token|aem-user-token/);
});
test('accepts raw and base64 JSON bodies without letting request input replace server profiles', async () => {
  const body = JSON.stringify({ connectionId: 'store', authorUrl: author, assetPath: path, op: 'asset.get', CONNECTIONS_JSON: '{}' });
  for (const encoded of [false, true]) {
    const response = await main({ ...params, __ow_body: encoded ? Buffer.from(body).toString('base64') : body, __ow_isBase64Encoded: encoded });
    expect(response.statusCode).toBe(200);
  }
});
test('keeps Sling field names literal and uses typed arrays, including one value', () => {
  const body = metadataForm({ 'commerce:skus': ['ONE'], 'commerce:roles': [] });
  expect(body).toContain('./jcr:content/metadata/commerce:skus@TypeHint=String%5B%5D');
  expect(new URLSearchParams(body).getAll('./jcr:content/metadata/commerce:skus')).toEqual(['ONE']);
  expect(valuesFor({ skus: ['CamelCase'], roles: [], positions: [1], isCommerce: true })['commerce:skus']).toEqual(['CamelCase']);
  expect(assetResult({ assetId: uuid, path, metadata: { 'commerce:positions': [1], 'commerce:isCommerce': 'Yes' } })).toMatchObject({ positions: ['1'], isCommerce: true });
});
test('encodes wildcard searches and does not follow redirects with Commerce credentials', async () => {
  await searchProducts(profile, { q: 'a%b_c' });
  const [url, options] = global.fetch.mock.calls[0];
  expect(new URL(url).searchParams.get('searchCriteria[filter_groups][0][filters][0][value]')).toBe('%a\\%b\\_c%');
  expect(options.redirect).toBe('error');
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test('selecting another trusted instance uses only that instance token and URL', async () => {
  const secondProfile = { ...profile, commerceUrl: 'https://second.example.com', commerceToken: 'second-private-token' };
  const original = global.fetch.getMockImplementation();
  global.fetch.mockImplementation((url, options) => url.startsWith(secondProfile.commerceUrl)
    ? Promise.resolve(Response.json({ items: [product('Second-instance-SKU')], total_count: 1 })) : original(url, options));
  const response = await main({
    ...params, op: 'products.search', q: 'Second',
    connectionId: 'second', commerceUrl: secondProfile.commerceUrl,
    CONNECTIONS_JSON: JSON.stringify({ store: profile, second: secondProfile }),
  });
  expect(response).toMatchObject({ statusCode: 200, body: { items: [{ sku: 'Second-instance-SKU' }] } });
  const [url, options] = global.fetch.mock.calls.find(([url]) => url.startsWith(secondProfile.commerceUrl));
  expect(url).toContain('second.example.com/rest/default/V1/products');
  expect(options.headers.Authorization).toBe('Bearer second-private-token');
  expect(JSON.stringify(options)).not.toContain('commerce-only-token');
  expect(JSON.stringify(response)).not.toContain('private-token');
});

test('reports malformed upstream product data explicitly rather than an empty success', async () => {
  const original = global.fetch.getMockImplementation();
  global.fetch.mockImplementation((url, options) => url.startsWith(commerce)
    ? Promise.resolve(Response.json({ items: 'not-an-array', total_count: 10 })) : original(url, options));
  expect(await main({ ...params, op: 'products.search' })).toMatchObject({
    statusCode: 502, body: { error: expect.stringContaining('invalid product list') },
  });
});
