const dns = require('node:dns');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { main } = require('../actions/manage');
const { requestJson, lookupPublic } = require('../lib/http');
const { callAssets } = require('../web-src/src/api');

jest.mock('node:dns', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));
jest.mock('@adobe/aio-lib-core-logging', () => () => ({ error: jest.fn() }));
jest.mock('../web-src/src/config.json', () => ({
  'assets-commerce/manage': 'https://test.adobeio-static.net/api/v1/web/assets-commerce/manage',
}), { virtual: true });

const author = 'https://author-p123-e456.adobeaemcloud.com';
const assetPath = '/content/dam/products/product.jpg';
const originalFetch = global.fetch;
const direct = {
  __ow_method: 'post',
  __ow_headers: { authorization: 'Bearer adobe-user-token', 'x-gw-ims-org-id': 'org@AdobeOrg' },
  authorUrl: author, assetPath,
  commerceUrl: 'https://first.example.com', commerceToken: 'first-commerce-token',
};
let metadata;
let upstreamStatus;
let upstreamBody;
let writes;

beforeEach(() => {
  jest.clearAllMocks();
  metadata = { 'dc:title': 'Keep title', 'dam:status': 'approved' };
  writes = 0;
  upstreamStatus = 200;
  upstreamBody = null;
  dns.lookup.mockImplementation((_host, _options, callback) => callback(null, [{ address: '93.184.216.34', family: 4 }]));
  https.request.mockImplementation((url, options, callback) => {
    const request = new EventEmitter();
    request.end = () => options.lookup(new URL(url).hostname, { all: true }, (error) => {
      if (error) return request.emit('error', error);
      const response = new PassThrough();
      response.statusCode = upstreamStatus;
      callback(response);
      const sku = new URL(url).hostname.startsWith('first') ? 'First-SKU' : 'Second-SKU';
      response.end(upstreamBody ?? JSON.stringify({
        items: [{ sku, name: sku, type_id: 'simple' }], total_count: 1,
      }));
    });
    return request;
  });
  global.fetch = jest.fn(async (url, options) => {
    if (!url.startsWith(`${author}/content/dam/products/`)) throw new Error('Unexpected AEM URL');
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
  });
});
afterEach(() => { global.fetch = originalFetch; });

test('searches and saves with only Extension Manager details and separates both credentials', async () => {
  const search = await main({ ...direct, op: 'products.search', q: 'First' });
  expect(search).toMatchObject({ statusCode: 200, body: { items: [{ sku: 'First-SKU' }] } });
  const read = await main({ ...direct, op: 'asset.get' });
  const saved = await main({
    ...direct, op: 'asset.save', revision: read.body.revision,
    isCommerce: true, skus: ['First-SKU'], roles: ['image'], positions: [1],
  });
  expect(saved).toMatchObject({ statusCode: 200, body: { skus: ['First-SKU'], syncPending: true } });
  expect(writes).toBe(1);
  expect(metadata['dc:title']).toBe('Keep title');
  expect(JSON.stringify(saved)).not.toContain(direct.commerceToken);
  for (const [, options] of global.fetch.mock.calls) {
    expect(options.headers.Authorization).toBe('Bearer adobe-user-token');
    expect(JSON.stringify(options)).not.toContain(direct.commerceToken);
  }
  for (const [url, options] of https.request.mock.calls) {
    expect(url).toContain('https://first.example.com/rest/default/V1/products');
    expect(options.headers.Authorization).toBe('Bearer first-commerce-token');
    expect(JSON.stringify(options)).not.toContain('adobe-user-token');
    expect(options).toMatchObject({ lookup: lookupPublic, agent: false, signal: expect.any(AbortSignal) });
  }
});

test('switches to an entirely new URL and token without any server configuration or deployment', async () => {
  await main({ ...direct, op: 'products.search' });
  const second = await main({
    ...direct, op: 'products.search', commerceUrl: 'https://second.example.com/shop',
    commerceToken: 'second-commerce-token', storeCode: 'fr',
  });
  expect(second).toMatchObject({ statusCode: 200, body: { items: [{ sku: 'Second-SKU' }] } });
  const [url, options] = https.request.mock.calls[1];
  expect(url).toContain('https://second.example.com/shop/rest/fr/V1/products');
  expect(options.headers.Authorization).toBe('Bearer second-commerce-token');
  expect(JSON.stringify(options)).not.toContain(direct.commerceToken);
});

test('carries live guest configuration through the real panel API and action after a connection change', async () => {
  const aemFetch = global.fetch.getMockImplementation();
  global.fetch.mockImplementation(async (url, options) => {
    if (url !== 'https://test.adobeioruntime.net/api/v1/web/assets-commerce/manage') return aemFetch(url, options);
    const result = await main({
      __ow_method: options.method,
      __ow_headers: Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])),
      __ow_body: options.body,
    });
    return Response.json(result.body, { status: result.statusCode });
  });
  const guest = {
    configuration: { commerceUrl: direct.commerceUrl, commerceToken: direct.commerceToken },
    host: {
      auth: {
        getIMSInfo: async () => ({ accessToken: 'adobe-user-token', imsOrg: 'org@AdobeOrg' }),
        getApiKey: async () => 'host-api-key',
      },
      discovery: { getAemHost: async () => author },
      details: { getCurrentResourceInfo: async () => ({ path: assetPath }) },
    },
  };
  expect(await callAssets(guest, 'products.search', { q: 'First' })).toMatchObject({ items: [{ sku: 'First-SKU' }] });
  guest.configuration = {
    commerceUrl: 'https://second.example.com', commerceToken: 'new-config-token', storeCode: 'fr',
  };
  expect(await callAssets(guest, 'products.search', { q: 'Second' })).toMatchObject({ items: [{ sku: 'Second-SKU' }] });
  expect(https.request.mock.calls[1][0]).toContain('/rest/fr/V1/products');
  expect(https.request.mock.calls[1][1].headers.Authorization).toBe('Bearer new-config-token');
});

test('denied AEM access prevents any Commerce request in direct mode', async () => {
  global.fetch.mockResolvedValueOnce(new Response('', { status: 403 }));
  expect(await main({ ...direct, op: 'products.search' })).toMatchObject({ statusCode: 403 });
  expect(https.request).not.toHaveBeenCalled();
});

test.each([
  '0.0.0.0', '10.0.0.1', '100.100.100.100', '127.0.0.1', '169.254.169.254',
  '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1',
  '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::',
])('rejects a dynamic Commerce hostname resolving to non-public %s', async (address) => {
  dns.lookup.mockImplementation((_host, _options, callback) => callback(null, [{ address, family: address.includes(':') ? 6 : 4 }]));
  expect(await main({ ...direct, op: 'products.search' })).toMatchObject({
    statusCode: 502, body: { error: expect.stringContaining('could not be reached') },
  });
  expect(writes).toBe(0);
});

test('rejects mixed public/private DNS answers and propagates lookup errors', async () => {
  dns.lookup.mockImplementationOnce((_host, _options, callback) => callback(null, [
    { address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 },
  ]));
  expect(await main({ ...direct, op: 'products.search' })).toMatchObject({ statusCode: 502 });
  dns.lookup.mockImplementationOnce((_host, _options, callback) => callback(new Error('DNS unavailable')));
  expect(await main({ ...direct, op: 'products.search' })).toMatchObject({ statusCode: 502 });
});

test('pins public IPv4 and IPv6 addresses for both Node lookup callback formats', () => {
  const callback = jest.fn();
  lookupPublic('first.example.com', { family: 4 }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, '93.184.216.34', 4);
  dns.lookup.mockImplementationOnce((_host, _options, done) => done(null, [{ address: '2606:4700:4700::1111', family: 6 }]));
  lookupPublic('first.example.com', { all: true }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, [{ address: '2606:4700:4700::1111', family: 6 }]);
});

test('does not follow redirects and sanitizes transport and parsing failures', async () => {
  upstreamStatus = 302;
  expect(await main({ ...direct, op: 'products.search' })).toMatchObject({ statusCode: 502 });
  expect(https.request).toHaveBeenCalledTimes(1);
  upstreamStatus = 200;
  upstreamBody = 'private non-JSON data';
  const unreadable = await main({ ...direct, op: 'products.search' });
  expect(unreadable).toMatchObject({ statusCode: 502, body: { error: expect.stringContaining('unreadable') } });
  expect(JSON.stringify(unreadable)).not.toContain('private non-JSON');
  upstreamBody = 'x'.repeat(2 * 1024 * 1024 + 1);
  expect(await main({ ...direct, op: 'products.search' })).toMatchObject({ statusCode: 502 });
  https.request.mockImplementationOnce(() => { throw new Error('private connection details'); });
  await expect(requestJson(direct.commerceUrl, {}, 'Adobe Commerce', true)).rejects.toMatchObject({
    status: 502, message: expect.not.stringContaining('private'),
  });
});
