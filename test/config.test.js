const { resolveConnection, httpsUrl, damPath } = require('../lib/config');
const { readSettings } = require('../web-src/src/settings');

const profile = {
  imsOrg: 'org@AdobeOrg', aemAuthorUrl: 'https://author.example.com',
  productsRoot: '/content/dam/products', commerceUrl: 'https://shop.example.com/subdir',
  storeCodes: ['default', 'fr'], commerceToken: 'server-only-token',
};
const params = { CONNECTIONS_JSON: JSON.stringify({ store: profile, second: { ...profile, commerceUrl: 'https://second.example.com', commerceToken: 'different-token' } }) };
const input = { connectionId: 'store', authorUrl: profile.aemAuthorUrl };
test('selects server-bound credentials and permits allowed store/folder overrides', () => {
  expect(resolveConnection(params, { ...input, storeCode: 'fr', productsRoot: '/content/dam/products/shoes' }, profile.imsOrg)).toMatchObject({
    commerceUrl: profile.commerceUrl, commerceToken: profile.commerceToken, storeCode: 'fr',
    productsRoot: '/content/dam/products/shoes',
  });
  expect(resolveConnection(params, { ...input, connectionId: 'second' }, profile.imsOrg)).toMatchObject({
    commerceUrl: 'https://second.example.com', commerceToken: 'different-token',
  });
});
test.each([
  { connectionId: '__proto__' }, { connectionId: 'missing' }, { storeCode: 'all' },
  { storeCode: '../admin' }, { commerceUrl: 'https://attacker.example.com' },
  { authorUrl: 'https://other.example.com' }, { productsRoot: '/content/dam/products-sibling' },
  { productsRoot: '/content/dam' },
])('rejects untrusted or out-of-scope settings %j', (override) => {
  expect(() => resolveConnection(params, { ...input, ...override }, profile.imsOrg)).toThrow();
});
test('requires server configuration and the correct org even for a known connection', () => {
  expect(() => resolveConnection({}, input, profile.imsOrg)).toThrow('configure ASSETS_COMMERCE_CONNECTIONS');
  expect(() => resolveConnection(params, input, 'another-org')).toThrow('organization');
});
test.each(['http://shop.example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://shop.internal', 'https://user:pass@shop.example.com', 'https://shop.example.com/?key=1', 'https://shop.example.com/#fragment', 'https://shop.example.com:8443'])('rejects unsafe URLs %s', (url) => {
  expect(() => httpsUrl(url, 'Commerce URL')).toThrow();
});
test.each(['/content/dam/products/../secret', '/content/dam/products/image.jpg?q=1', '/content/dam/products/%2e%2e/file', '/content/dam/products/image.jpg;x=1', '/content/dam/products//file'])('rejects ambiguous DAM paths %s', (path) => {
  expect(() => damPath(path)).toThrow();
});
test('reads public settings from the guest connection, not window URL or globals', () => {
  expect(readSettings({ configuration: { connectionId: 'store', storeCode: 'fr', commerceUrl: profile.commerceUrl, productsRoot: '/content/dam/products/shoes', commerceToken: 'must-not-be-sent' } })).toEqual({
    connectionId: 'store', storeCode: 'fr', commerceUrl: profile.commerceUrl, productsRoot: '/content/dam/products/shoes',
  });
  expect(() => readSettings({})).toThrow('Extension Manager');
  expect(() => readSettings({ configuration: { connectionId: 'store', storeCode: 123 } })).toThrow('storeCode');
});
