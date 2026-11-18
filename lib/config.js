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

function resolveConnection(params, input, org) {
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
  if (!profile.imsOrg || org !== profile.imsOrg) throw new AppError('Your IMS organization cannot use this connection.', 403);
  const author = httpsUrl(profile.aemAuthorUrl, 'Configured AEM author');
  if (new URL(author).pathname !== '/' || input.authorUrl !== author) {
    throw new AppError('This connection belongs to a different AEM author.', 403);
  }
  const commerceUrl = httpsUrl(profile.commerceUrl, 'Configured Commerce URL');
  if (input.commerceUrl !== undefined && httpsUrl(input.commerceUrl, 'Commerce URL') !== commerceUrl) {
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
  if (typeof profile.commerceToken !== 'string' || !profile.commerceToken.trim() || /[\r\n]/.test(profile.commerceToken)) {
    throw new AppError('Configure the Commerce integration token on the server, not in Extension Manager.', 503);
  }
  return { authorUrl: author, commerceUrl, productsRoot, storeCode, commerceToken: profile.commerceToken };
}
module.exports = { resolveConnection, httpsUrl, damPath };
