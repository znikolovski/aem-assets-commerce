const dns = require('node:dns');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { main } = require('../actions/manage');
const { callAssets } = require('../web-src/src/api');

jest.mock('node:dns', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));
jest.mock('@adobe/aio-lib-core-logging', () => () => ({ error: jest.fn() }));
jest.mock('../web-src/src/config.json', () => ({
  'assets-commerce/manage': 'https://test.adobeio-static.net/api/v1/web/assets-commerce/manage',
}), { virtual: true });

const originalFetch = global.fetch;
const author = 'https://author-p123-e456.adobeaemcloud.com';
const commerce = 'https://na1-sandbox.api.commerce.adobe.com/tenant-one';
const path = '/content/dam/products/product.jpg';
const runtime = 'https://test.adobeioruntime.net/api/v1/web/assets-commerce/manage';
let guest;
let profile;
let metadata;
let statuses;
let writes;
let issuedTokens;
let sequence = 0;
const catalog = (url) => new URL(url).pathname.startsWith('/tenant-two/')
  ? ['Second-SKU'] : ['Parent', 'Parent-red-S'];

beforeEach(() => {
  jest.clearAllMocks();
  metadata = { 'dc:title': 'Keep title', 'dam:status': 'approved', 'other:field': ['keep'] };
  writes = 0;
  issuedTokens = 0;
  statuses = [];
  profile = {
    commerceType: 'accs', authMode: 'server', commerceUrl: commerce,
    aemAuthorUrl: author, imsOrg: 'org@AdobeOrg', productsRoot: '/content/dam/products',
    storeCodes: ['default', 'fr'], commerceClientId: 'service-client',
    commerceClientSecret: `private-service-secret-${++sequence}`,
  };
  guest = {
    configuration: { commerceUrl: commerce, storeCode: 'fr' },
    host: {
      auth: {
        getIMSInfo: jest.fn(async () => ({ accessToken: 'host-ims-token', imsOrg: 'org@AdobeOrg' })),
        getApiKey: async () => 'host-oauth-client',
      },
      discovery: { getAemHost: async () => author },
      details: { getCurrentResourceInfo: async () => ({ path }) },
    },
  };
  dns.lookup.mockImplementation((_host, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]));
  https.request.mockImplementation((url, options, callback) => {
    const request = new EventEmitter();
    request.end = () => options.lookup(new URL(url).hostname, { all: true }, (error) => {
      if (error) return request.emit('error', error);
      const response = new PassThrough();
      response.statusCode = statuses.shift() || 200;
      callback(response);
      const query = new URL(url).searchParams;
      const search = query.get('searchCriteria[filter_groups][0][filters][0][condition_type]') === 'like';
      const requested = [...query].filter(([key]) => key.endsWith('[value]')).map(([, value]) => value);
      const skus = catalog(url).filter((sku) => search || requested.includes(sku));
      response.end(JSON.stringify({
        items: skus.map((sku) => ({ sku, name: `Product ${sku}`, type_id: 'simple' })), total_count: skus.length,
      }));
    });
    return request;
  });
  global.fetch = jest.fn(async (url, options) => {
    if (url === runtime) {
      const result = await main({
        __ow_method: options.method,
        __ow_headers: Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])),
        __ow_body: options.body, CONNECTIONS_JSON: JSON.stringify({ service: profile }),
      });
      return Response.json(result.body, { status: result.statusCode });
    }
    if (url === 'https://ims-na1.adobelogin.com/ims/token/v3') {
      issuedTokens += 1;
      return Response.json({ access_token: `service-token-${issuedTokens}`, expires_in: 3600 });
    }
    if (url.startsWith(`${author}/content/dam/products/`)) {
      if (options.method === 'POST') {
        writes += 1;
        const fields = new URLSearchParams(options.body);
        for (const key of ['commerce:isCommerce', 'commerce:skus', 'commerce:roles', 'commerce:positions']) {
          const field = `./jcr:content/metadata/${key}`;
          if (fields.has(`${field}@Delete`)) delete metadata[key];
          if (fields.has(field)) metadata[key] = key === 'commerce:isCommerce' ? fields.get(field) : fields.getAll(field);
        }
        return new Response('Saved');
      }
      return Response.json({
        'jcr:primaryType': 'dam:Asset', 'jcr:uuid': '12345678-1234-1234-1234-123456789012',
        'jcr:content': { metadata },
      });
    }
    throw new Error('Unexpected request');
  });
});
afterEach(() => { global.fetch = originalFetch; });
const save = (revision, override = {}) => callAssets(guest, 'asset.save', {
  assetPath: path, revision, skus: ['Parent-red-S'], roles: ['image', 'thumbnail'],
  positions: [2], isCommerce: true, ...override,
});

test('uses the host IMS identity through the complete panel API/action/catalog/save flow', async () => {
  const found = await callAssets(guest, 'products.search', { q: 'Parent' });
  expect(found).toMatchObject({ items: [{ sku: 'Parent' }, { sku: 'Parent-red-S' }], total: 2 });
  const [url, options] = https.request.mock.calls[0];
  expect(new URL(url).pathname).toBe('/tenant-one/V1/products');
  expect(new URL(url).searchParams.get('searchCriteria[pageSize]')).toBe('50');
  expect(options.headers).toEqual({
    Accept: 'application/json', Authorization: 'Bearer host-ims-token',
    'x-api-key': 'host-oauth-client', 'x-gw-ims-org-id': 'org@AdobeOrg', Store: 'fr',
  });
  const loaded = await callAssets(guest, 'asset.get', { assetPath: path });
  expect(await save(loaded.revision)).toMatchObject({
    skus: ['Parent-red-S'], positions: ['2'], roles: ['image', 'thumbnail'], syncPending: true, warning: null,
  });
  expect(writes).toBe(1);
  expect(metadata['dc:title']).toBe('Keep title');
  expect(metadata['other:field']).toEqual(['keep']);
  expect(issuedTokens).toBe(0);
  const validation = new URL(https.request.mock.calls[1][0]).searchParams;
  expect(validation.get('searchCriteria[filter_groups][0][filters][0][condition_type]')).toBe('eq');
  expect(validation.get('searchCriteria[filter_groups][0][filters][0][value]')).toBe('Parent-red-S');
});

test('picks up a different ACCS tenant/store and fresh user identity without builds or a stored token', async () => {
  await callAssets(guest, 'products.search', { q: 'Parent' });
  guest.configuration = {
    commerceType: 'accs', commerceUrl: 'https://eu1.api.commerce.adobe.com/tenant-two',
    storeCode: 'default', commerceClientId: 'matching-oauth-client',
  };
  guest.host.auth.getIMSInfo.mockResolvedValueOnce({ accessToken: 'renewed-host-token', imsOrg: 'org@AdobeOrg' });
  expect(await callAssets(guest, 'products.search', { q: 'Second' })).toMatchObject({ items: [{ sku: 'Second-SKU' }] });
  const [url, options] = https.request.mock.calls[1];
  expect(new URL(url).origin).toBe('https://eu1.api.commerce.adobe.com');
  expect(options.headers).toMatchObject({
    Authorization: 'Bearer renewed-host-token', 'x-api-key': 'matching-oauth-client', Store: 'default',
  });
  expect(issuedTokens).toBe(0);
  expect(JSON.stringify(global.fetch.mock.calls)).not.toContain('private-service-secret');
});

test.each([401, 403])('reports missing Commerce authorization for the AEM session (%s) without escalating privileges', async (status) => {
  statuses = [status];
  await expect(callAssets(guest, 'products.search')).rejects.toThrow('commerce.accs');
  expect(issuedTokens).toBe(0);
  expect(https.request).toHaveBeenCalledTimes(1);
  expect(writes).toBe(0);
});

test('obtains a server-only IMS token after the AEM permission gate and never substitutes it on AEM requests', async () => {
  guest.configuration = { connectionId: 'service', storeCode: 'fr' };
  await callAssets(guest, 'asset.get', { assetPath: path });
  expect(issuedTokens).toBe(0);
  expect(https.request).not.toHaveBeenCalled();
  await callAssets(guest, 'products.search');
  expect(issuedTokens).toBe(1);
  expect(https.request.mock.calls[0][1].headers).toMatchObject({
    Authorization: 'Bearer service-token-1', 'x-api-key': 'service-client', Store: 'fr',
  });
  const loaded = await callAssets(guest, 'asset.get', { assetPath: path });
  const saved = await save(loaded.revision);
  expect(saved).toMatchObject({ skus: ['Parent-red-S'], syncPending: true });
  expect(JSON.stringify(saved)).not.toContain('service-token');
  expect(JSON.stringify(saved)).not.toContain(profile.commerceClientSecret);
  expect(issuedTokens).toBe(1);
  for (const [url, options] of global.fetch.mock.calls.filter(([url]) => url.startsWith(author))) {
    expect(url).toContain('/content/dam/products/');
    expect(options.headers.Authorization).toBe('Bearer host-ims-token');
    expect(JSON.stringify(options)).not.toContain('service-token');
    expect(JSON.stringify(options)).not.toContain(profile.commerceClientSecret);
  }
  const imsRequest = global.fetch.mock.calls.find(([url]) => url.includes('/ims/token/v3'))[1];
  expect(new URLSearchParams(imsRequest.body).get('client_secret')).toBe(profile.commerceClientSecret);
});

test('renews a rejected service token once, retrying only the catalog GET', async () => {
  guest.configuration = { connectionId: 'service' };
  statuses = [401, 200];
  await expect(callAssets(guest, 'products.search')).resolves.toMatchObject({ total: 2 });
  expect(issuedTokens).toBe(2);
  expect(https.request.mock.calls.map(([, options]) => options.headers.Authorization)).toEqual([
    'Bearer service-token-1', 'Bearer service-token-2',
  ]);
  expect(writes).toBe(0);
});

test.each([[401, 401], [403], [429], [502]])('does not retry forbidden, throttled or repeatedly unauthorized catalog calls %j', async (...responses) => {
  guest.configuration = { connectionId: 'service' };
  statuses = [...responses];
  await expect(callAssets(guest, 'products.search')).rejects.toThrow();
  expect(https.request).toHaveBeenCalledTimes(responses.length);
  expect(issuedTokens).toBe(responses.length);
  expect(writes).toBe(0);
});

test('does not acquire any Commerce token or send the caller identity when AEM denies the asset', async () => {
  guest.configuration = { connectionId: 'service' };
  const upstream = global.fetch.getMockImplementation();
  global.fetch.mockImplementation((url, options) => url.startsWith(author)
    ? Promise.resolve(new Response('', { status: 403 })) : upstream(url, options));
  await expect(callAssets(guest, 'products.search')).rejects.toThrow('403');
  expect(issuedTokens).toBe(0);
  expect(https.request).not.toHaveBeenCalled();
});

test('rejects unknown SKUs before writing and permits unlinking without catalog authentication', async () => {
  const loaded = await callAssets(guest, 'asset.get', { assetPath: path });
  await expect(save(loaded.revision, { skus: ['Unknown-SKU'] })).rejects.toThrow('no longer exist');
  expect(writes).toBe(0);
  guest.configuration = { connectionId: 'service' };
  statuses = [403];
  expect(await save(loaded.revision, { skus: [], roles: [], positions: [], isCommerce: false })).toMatchObject({ skus: [] });
  expect(issuedTokens).toBe(0);
  expect(writes).toBe(1);
});

test('rejects non-Adobe destinations before forwarding the host token', async () => {
  guest.configuration = { commerceType: 'accs', commerceUrl: 'https://attacker.example.com/tenant' };
  await expect(callAssets(guest, 'products.search')).rejects.toThrow('commerceUrl');
  expect(https.request).not.toHaveBeenCalled();
  expect(issuedTokens).toBe(0);
});
