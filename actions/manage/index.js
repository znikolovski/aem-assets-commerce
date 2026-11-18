const logging = require('@adobe/aio-lib-core-logging');
const { AppError } = require('../../lib/errors');
const { resolveConnection } = require('../../lib/config');
const { readAsset, assetResult, saveAsset } = require('../../lib/assets');
const { searchProducts } = require('../../lib/commerce');

async function main(params) {
  const response = (statusCode, body) => ({
    statusCode, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }, body,
  });
  if (params.__ow_method?.toLowerCase() !== 'post') return response(405, { error: 'Use POST.' });
  const headers = params.__ow_headers || {};
  const token = /^Bearer ([^\s]+)$/i.exec(headers.authorization || '')?.[1];
  if (!token) return response(401, { error: 'Sign in to AEM Assets.' });
  try {
    let input = params;
    if (params.__ow_body !== undefined) {
      try {
        input = JSON.parse(params.__ow_isBase64Encoded
          ? Buffer.from(params.__ow_body, 'base64').toString('utf8') : params.__ow_body);
      } catch { throw new AppError('The request must contain valid JSON.'); }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('The request must be a JSON object.');
    if (!['products.search', 'asset.get', 'asset.save'].includes(input.op)) throw new AppError('Choose a supported operation.');
    const connection = resolveConnection(params, input, headers['x-gw-ims-org-id']);
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || !/^[a-z0-9_-]{1,256}$/i.test(input.apiKey))) {
      throw new AppError('The Assets host API key is invalid.');
    }
    const identity = { token, apiKey: input.apiKey };
    // The organization header alone is not authorization. Gate even catalog searches
    // on a real AEM read with this user's token and the configured asset root.
    const asset = await readAsset(connection, identity, input.assetPath);
    if (input.op === 'asset.get') return response(200, assetResult(asset));
    if (input.op === 'products.search') return response(200, await searchProducts(connection, input));
    return response(200, await saveAsset(connection, identity, input));
  } catch (error) {
    const expected = error instanceof AppError;
    // Never log upstream response bodies, credentials, request input or tokens.
    logging('assets-commerce', { level: params.LOG_LEVEL || 'info' }).error(
      `${expected ? 'Request failed' : 'Unexpected failure'} (${expected ? error.status : 500})`,
    );
    return response(expected ? error.status : 500, {
      error: expected ? error.message : 'Asset product linking failed. Contact the extension administrator.',
    });
  }
}
exports.main = main;
