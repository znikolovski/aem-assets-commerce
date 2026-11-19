const { createHash } = require('node:crypto');
const { AppError } = require('./errors');
const { requestJson } = require('./http');

const SCOPES = 'openid,AdobeID,email,profile,additional_info.roles,additional_info.projectedProductContext,commerce.accs';
const tokens = new Map();
const cacheKey = (connection) => createHash('sha256').update(JSON.stringify([
  connection.commerceUrl, connection.imsOrg, connection.commerceClientId, connection.commerceClientSecret,
])).digest('hex');

async function createToken(connection) {
  const startedAt = Date.now();
  let data;
  try {
    data = await requestJson('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST', parseResponse: true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: connection.commerceClientId,
        client_secret: connection.commerceClientSecret, scope: SCOPES,
      }).toString(),
    }, 'Adobe IMS');
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    throw new AppError('ACCS authentication failed. Check the server profile OAuth credentials and Adobe Commerce API access in Developer Console.', error.status === 429 ? 429 : 502);
  }
  if (!data || typeof data.access_token !== 'string' || !/^[!-~]{1,16384}$/.test(data.access_token) ||
    !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
    data.expires_in > 2147483647 ||
    (data.token_type !== undefined && String(data.token_type).toLowerCase() !== 'bearer') ||
    (data.scope !== undefined && (typeof data.scope !== 'string' || !data.scope.split(/[,\s]+/).includes('commerce.accs')))) {
    throw new AppError('Adobe IMS returned an invalid Commerce token or did not grant commerce.accs.', 502);
  }
  return { token: data.access_token, expiresAt: startedAt + Math.max(0, data.expires_in - 60) * 1000 };
}

async function serviceToken(connection, refresh) {
  const key = cacheKey(connection);
  let entry = tokens.get(key);
  if (refresh || (entry && !entry.pending && entry.expiresAt <= Date.now())) {
    tokens.delete(key);
    entry = undefined;
  }
  if (!entry) {
    entry = { pending: createToken(connection) };
    tokens.set(key, entry);
    try {
      const result = await entry.pending;
      if (tokens.get(key) === entry) tokens.set(key, result);
      return result.token;
    } catch (error) {
      if (tokens.get(key) === entry) tokens.delete(key);
      throw error;
    }
  }
  return entry.pending ? (await entry.pending).token : entry.token;
}

async function commerceHeaders(connection, identity = {}, refresh = false) {
  if (connection.commerceType !== 'accs') {
    return { Accept: 'application/json', Authorization: `Bearer ${connection.commerceToken}` };
  }
  const server = connection.authMode === 'server';
  const clientId = connection.commerceClientId || identity.apiKey;
  if (typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(clientId)) {
    throw new AppError('An ACCS OAuth client ID is required. Set commerceClientId to the client that issued the user token, or select a server-side connectionId.');
  }
  if (!server && !identity.token) throw new AppError('Reopen the panel to refresh your Adobe IMS session.', 401);
  const token = server ? await serviceToken(connection, refresh) : identity.token;
  return {
    Accept: 'application/json', Authorization: `Bearer ${token}`,
    'x-api-key': clientId, 'x-gw-ims-org-id': connection.imsOrg, Store: connection.storeCode,
  };
}

module.exports = { commerceHeaders };
