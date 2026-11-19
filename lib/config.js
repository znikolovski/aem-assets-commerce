const { isIP } = require('node:net');
const { AppError } = require('./errors');

function httpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new AppError(`${label} must be a public HTTPS URL.`); }
  if (typeof value !== 'string' || value.length > 2048 || url.protocol !== 'https:' ||
    url.username || url.password || url.search || url.hash ||
    (url.port && url.port !== '443') || !url.hostname.includes('.') ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) ||
    /[\\%]/.test(value)) {
    throw new AppError(`${label} must be a public HTTPS URL without credentials, query or fragment.`);
  }
  return url.href.replace(/\/$/, '');
}

function damPath(value, label = 'DAM folder') {
  if (typeof value !== 'string' || !value.startsWith('/content/dam/') || value.length > 4096 ||
    /[\\?#%;]/.test(value) ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    value.slice(1).split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new AppError(`${label} must be an absolute path beneath /content/dam.`);
  }
  return value;
}

function commerceSettings(source, server = false) {
  const commerceType = source.commerceType === undefined
    ? (source.commerceToken === undefined ? 'accs' : 'paas') : source.commerceType;
  if (!['accs', 'paas'].includes(commerceType)) throw new AppError('Set commerceType to accs or paas.');
  const commerceUrl = httpsUrl(source.commerceUrl, 'Commerce URL');
  if (commerceType === 'paas') {
    if (new URL(commerceUrl).hostname.endsWith('.api.commerce.adobe.com')) {
      throw new AppError('For ACCS, set commerceType=accs and remove commerceToken.');
    }
    if (typeof source.commerceToken !== 'string' || !source.commerceToken ||
      source.commerceToken.length > 4096 || !/^[!-~]+$/.test(source.commerceToken)) {
      throw new AppError(server
        ? 'Configure a valid Commerce integration token in the server profile.'
        : 'Set commerceToken to a valid Commerce integration token in Extension Manager.');
    }
    return { commerceType, commerceUrl, commerceToken: source.commerceToken };
  }
  const url = new URL(commerceUrl);
  if (!/^[a-z0-9-]+\.api\.commerce\.adobe\.com$/.test(url.hostname) ||
    !/^\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname)) {
    throw new AppError('Set commerceUrl to https://<region>.api.commerce.adobe.com/<tenant-id>, without /V1 or /rest.');
  }
  if (source.commerceToken !== undefined) throw new AppError('ACCS uses Adobe IMS authentication. Remove commerceToken.');
  const authMode = source.authMode === undefined ? 'user' : source.authMode;
  if (!['user', 'server'].includes(authMode) || (!server && authMode !== 'user')) {
    throw new AppError('Use a server-side connectionId for ACCS server-to-server authentication.');
  }
  const { commerceClientId, commerceClientSecret } = source;
  if ((commerceClientId !== undefined || authMode === 'server') &&
    (typeof commerceClientId !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(commerceClientId))) {
    throw new AppError('Configure a valid commerceClientId for the Commerce-enabled OAuth client.');
  }
  if (authMode === 'server' && (typeof commerceClientSecret !== 'string' ||
    !/^[!-~]{1,4096}$/.test(commerceClientSecret))) {
    throw new AppError('Configure commerceClientSecret only in the server-side connection profile.');
  }
  if (authMode !== 'server' && commerceClientSecret !== undefined) {
    throw new AppError('Do not put commerceClientSecret in user-mode configuration. Use a server-side profile.');
  }
  return {
    commerceType, commerceUrl, authMode, publicOnly: true,
    ...(commerceClientId === undefined ? {} : { commerceClientId }),
    ...(authMode === 'server' ? { commerceClientSecret } : {}),
  };
}

function resolveConnection(params, input, org) {
  if (input.commerceClientSecret !== undefined) {
    throw new AppError('Commerce OAuth client secrets must stay in server-side connection profiles.');
  }
  if (input.connectionId === undefined || input.connectionId === '') {
    const authorUrl = httpsUrl(input.authorUrl, 'AEM author');
    if (!/^https:\/\/author-p\d+-e\d+\.adobeaemcloud\.com$/.test(authorUrl)) {
      throw new AppError('Direct configuration requires an AEM Cloud Service author host.', 403);
    }
    if (typeof org !== 'string' || !/^[a-zA-Z0-9_@.-]{1,256}$/.test(org)) throw new AppError('Your IMS organization is unavailable.', 401);
    const commerce = commerceSettings(input);
    const storeCode = input.storeCode === undefined ? 'default' : input.storeCode;
    if (typeof storeCode !== 'string' || !/^[a-zA-Z0-9_]{1,64}$/.test(storeCode)) {
      throw new AppError('Set storeCode to a valid Commerce store view code in Extension Manager.');
    }
    return {
      authorUrl, ...commerce, storeCode,
      ...(commerce.commerceType === 'accs' ? { imsOrg: org } : {}),
      productsRoot: damPath(input.productsRoot === undefined ? '/content/dam/products' : input.productsRoot),
      publicOnly: true,
    };
  }
  let profiles;
  try { profiles = JSON.parse(params.CONNECTIONS_JSON); } catch {
    throw new AppError('The administrator must configure ASSETS_COMMERCE_CONNECTIONS before using this extension.', 503);
  }
  const id = input.connectionId;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
    !profiles || typeof profiles !== 'object' || Array.isArray(profiles) ||
    !Object.hasOwn(profiles, id)) {
    throw new AppError('Choose a configured connectionId in Extension Manager.', 400);
  }
  const profile = profiles[id];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new AppError('The selected server connection profile is invalid.', 503);
  }
  if (input.commerceToken !== undefined) {
    throw new AppError('Remove connectionId to supply a Commerce token directly, or use the server profile without commerceToken.');
  }
  if (!profile.imsOrg || org !== profile.imsOrg) throw new AppError('Your IMS organization cannot use this connection.', 403);
  const author = httpsUrl(profile.aemAuthorUrl, 'Configured AEM author');
  if (new URL(author).pathname !== '/' || input.authorUrl !== author) {
    throw new AppError('This connection belongs to a different AEM author.', 403);
  }
  const commerce = commerceSettings(profile, true);
  if (input.commerceType !== undefined && input.commerceType !== commerce.commerceType) {
    throw new AppError('Commerce type does not match the selected server profile.', 403);
  }
  if (input.commerceClientId !== undefined && input.commerceClientId !== commerce.commerceClientId) {
    throw new AppError('Commerce client ID does not match the selected server profile.', 403);
  }
  if (input.commerceUrl !== undefined && httpsUrl(input.commerceUrl, 'Commerce URL') !== commerce.commerceUrl) {
    throw new AppError('Commerce URL does not match the selected trusted connection. Ask the administrator to add a profile for this instance.', 403);
  }
  const allowedRoot = damPath(profile.productsRoot);
  const productsRoot = input.productsRoot === undefined ? allowedRoot : damPath(input.productsRoot);
  if (productsRoot !== allowedRoot && !productsRoot.startsWith(`${allowedRoot}/`)) {
    throw new AppError('The requested DAM folder is outside this connection.', 403);
  }
  if (!Array.isArray(profile.storeCodes) || !profile.storeCodes.length ||
    profile.storeCodes.some((code) => typeof code !== 'string' || !/^[a-zA-Z0-9_]{1,64}$/.test(code))) {
    throw new AppError('Configure allowed storeCodes in the server connection profile.', 503);
  }
  const storeCode = input.storeCode === undefined ? profile.storeCodes[0] : input.storeCode;
  if (!profile.storeCodes.includes(storeCode)) throw new AppError('This store view is not allowed by the selected connection.', 403);
  return {
    authorUrl: author, ...commerce, productsRoot, storeCode,
    ...(commerce.commerceType === 'accs' ? { imsOrg: profile.imsOrg } : {}),
  };
}
module.exports = { resolveConnection, httpsUrl, damPath };
