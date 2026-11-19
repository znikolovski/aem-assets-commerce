const { commerceHeaders } = require('../lib/commerce-auth');

const originalFetch = global.fetch;
let sequence = 0;
let connection;
const tokenResponse = (token = 'service-access-token', extra = {}) => Response.json({
  access_token: token, expires_in: 3600, token_type: 'bearer', scope: 'openid,commerce.accs', ...extra,
});
beforeEach(() => {
  connection = {
    commerceType: 'accs', commerceUrl: 'https://na1.api.commerce.adobe.com/tenant',
    authMode: 'server', commerceClientId: 'service-client', commerceClientSecret: `server-secret-${++sequence}`,
    imsOrg: 'org@AdobeOrg', storeCode: 'fr',
  };
  global.fetch = jest.fn(async () => tokenResponse());
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

test('reuses the current user token without generating or storing a separate Commerce token', async () => {
  const user = { ...connection, authMode: 'user', commerceClientId: undefined, commerceClientSecret: undefined };
  expect(await commerceHeaders(user, { token: 'host-token', apiKey: 'host-client' })).toEqual({
    Accept: 'application/json', Authorization: 'Bearer host-token',
    'x-api-key': 'host-client', 'x-gw-ims-org-id': 'org@AdobeOrg', Store: 'fr',
  });
  expect(await commerceHeaders({ ...user, commerceClientId: 'explicit-client' }, { token: 'new-host-token' })).toMatchObject({
    Authorization: 'Bearer new-host-token', 'x-api-key': 'explicit-client',
  });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('reports missing user identity or client ID rather than falling back to a service account', async () => {
  const user = { ...connection, authMode: 'user', commerceClientId: undefined };
  await expect(commerceHeaders(user, { token: 'host-token' })).rejects.toThrow('OAuth client ID');
  await expect(commerceHeaders(user, { apiKey: 'host-client' })).rejects.toMatchObject({ status: 401 });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('obtains and caches a scoped service token from the fixed Adobe IMS endpoint', async () => {
  const headers = await commerceHeaders(connection, { token: 'aem-user-token' });
  expect(headers).toMatchObject({
    Authorization: 'Bearer service-access-token', 'x-api-key': 'service-client',
    'x-gw-ims-org-id': 'org@AdobeOrg', Store: 'fr',
  });
  expect(JSON.stringify(headers)).not.toContain('server-secret');
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe('https://ims-na1.adobelogin.com/ims/token/v3');
  expect(options).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
  expect(options).not.toHaveProperty('parseResponse');
  const form = new URLSearchParams(options.body);
  expect(form.get('grant_type')).toBe('client_credentials');
  expect(form.get('client_id')).toBe(connection.commerceClientId);
  expect(form.get('client_secret')).toBe(connection.commerceClientSecret);
  expect(form.get('scope').split(',')).toContain('commerce.accs');
  expect(JSON.stringify(options)).not.toContain('aem-user-token');
  await commerceHeaders(connection);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('renews before expiration and supports explicit renewal after Commerce rejects a token', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  await commerceHeaders(connection);
  now.mockReturnValue(1000000 + 3539000);
  await commerceHeaders(connection);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1000000 + 3540000);
  global.fetch.mockResolvedValueOnce(tokenResponse('renewed-token'));
  expect(await commerceHeaders(connection)).toMatchObject({ Authorization: 'Bearer renewed-token' });
  global.fetch.mockResolvedValueOnce(tokenResponse('forced-token'));
  expect(await commerceHeaders(connection, {}, true)).toMatchObject({ Authorization: 'Bearer forced-token' });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});
test('deduplicates concurrent token creation and isolates cache entries by credential and tenant', async () => {
  await Promise.all([commerceHeaders(connection), commerceHeaders(connection)]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  global.fetch.mockResolvedValueOnce(tokenResponse('rotated-secret-token'));
  expect(await commerceHeaders({ ...connection, commerceClientSecret: 'rotated-secret' })).toMatchObject({
    Authorization: 'Bearer rotated-secret-token',
  });
  global.fetch.mockResolvedValueOnce(tokenResponse('other-tenant-token'));
  expect(await commerceHeaders({ ...connection, commerceUrl: 'https://na1.api.commerce.adobe.com/other-tenant' })).toMatchObject({
    Authorization: 'Bearer other-tenant-token',
  });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});
test.each([
  null, {}, { access_token: 'a\nb', expires_in: 3600 },
  { access_token: 'token', expires_in: 0 }, { access_token: 'token', expires_in: '3600' },
  { access_token: 'token', expires_in: 3600, scope: 'openid' },
  { access_token: 'token', expires_in: 3600, scope: 123 },
  { access_token: 'token', expires_in: 3600, token_type: 'other' },
])('rejects malformed or insufficient-scope IMS responses %j', async (data) => {
  global.fetch.mockResolvedValueOnce(Response.json(data));
  await expect(commerceHeaders(connection)).rejects.toMatchObject({ status: 502 });
  await expect(commerceHeaders(connection)).resolves.toMatchObject({ Authorization: 'Bearer service-access-token' });
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
test('sanitizes IMS errors and does not cache failures or switch to the user token', async () => {
  global.fetch.mockResolvedValueOnce(new Response('private failure details', { status: 401 }));
  await expect(commerceHeaders(connection, { token: 'user-token' })).rejects.toMatchObject({
    status: 502, message: expect.stringContaining('server profile OAuth credentials'),
  });
  await expect(commerceHeaders(connection)).resolves.toMatchObject({ Authorization: 'Bearer service-access-token' });
  global.fetch.mockResolvedValueOnce(new Response('', { status: 429 }));
  await expect(commerceHeaders(connection, {}, true)).rejects.toMatchObject({ status: 429 });
  global.fetch.mockRejectedValueOnce(new Error('secret network error'));
  await expect(commerceHeaders(connection)).rejects.toMatchObject({
    status: 502, message: expect.not.stringContaining('secret network error'),
  });
});
