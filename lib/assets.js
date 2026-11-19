const { createHash } = require('node:crypto');
const { AppError } = require('./errors');
const { damPath } = require('./config');
const { requestJson } = require('./http');
const { validateSkus } = require('./commerce');

const FIELDS = ['commerce:isCommerce', 'commerce:skus', 'commerce:roles', 'commerce:positions'];
const ROLES = ['image', 'small_image', 'thumbnail', 'swatch_image', 'hero'];
const encodedPath = (path) => path.split('/').map(encodeURIComponent).join('/');
const asArray = (value) => (value == null ? [] : (Array.isArray(value) ? value : [value]).map(String));
const revision = (metadata) => createHash('sha256')
  .update(JSON.stringify(FIELDS.map((key) => metadata[key] ?? null))).digest('hex');
const isCommerce = (value) => /^(yes|true|1)$/i.test(String(value));

async function readAsset(connection, identity, path) {
  damPath(path, 'Asset path');
  if (!path.startsWith(`${connection.productsRoot}/`)) throw new AppError(`Select an asset beneath ${connection.productsRoot}.`, 403);
  const data = await requestJson(`${connection.authorUrl}${encodedPath(path)}.2.json`, {
    headers: {
      Accept: 'application/json', Authorization: `Bearer ${identity.token}`,
      ...(identity.apiKey ? { 'x-api-key': identity.apiKey } : {}),
    },
  }, 'AEM');
  const metadata = data?.['jcr:content']?.metadata;
  if (data?.['jcr:primaryType'] !== 'dam:Asset' || !metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data['jcr:uuid'] || '')) {
    throw new AppError('AEM returned an asset without readable metadata or identity.', 502);
  }
  return { assetId: `urn:aaid:aem:${data['jcr:uuid']}`, path, metadata };
}

function assetResult(asset) {
  const { metadata } = asset;
  return {
    assetId: asset.assetId, name: asset.path.split('/').pop(), path: asset.path,
    revision: revision(metadata), isCommerce: isCommerce(metadata['commerce:isCommerce']),
    skus: asArray(metadata['commerce:skus']), roles: asArray(metadata['commerce:roles']),
    positions: asArray(metadata['commerce:positions']), approval: metadata['dam:status'] || null,
  };
}

function valuesFor(input) {
  if (typeof input.isCommerce !== 'boolean') throw new AppError('Commerce eligibility must be true or false.');
  if (!Array.isArray(input.skus) || input.skus.length > 100 || input.skus.some((sku) =>
    typeof sku !== 'string' || !sku.trim() || sku !== sku.trim() || sku.length > 255 ||
    [...sku].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) ||
    new Set(input.skus).size !== input.skus.length) {
    throw new AppError('Select up to 100 unique product SKUs.');
  }
  if (input.isCommerce && !input.skus.length) throw new AppError('Select a product or disable commerce use.');
  if (!Array.isArray(input.roles) || input.roles.length > 20 || new Set(input.roles).size !== input.roles.length ||
    input.roles.some((role) => typeof role !== 'string' || (!ROLES.includes(role) && !/^custom_[a-z0-9_-]{1,60}$/i.test(role)))) {
    throw new AppError('Select valid, unique image roles.');
  }
  if (!Array.isArray(input.positions) || input.positions.length !== input.skus.length ||
    input.positions.some((p) => !Number.isInteger(p) || p < 1 || p > 9999)) {
    throw new AppError('Provide a whole-number position from 1 to 9999 for each selected SKU.');
  }
  return {
    'commerce:isCommerce': input.isCommerce ? 'yes' : 'no',
    'commerce:skus': input.skus,
    'commerce:roles': input.roles,
    'commerce:positions': input.positions.map(String),
  };
}

function metadataForm(values) {
  const fields = ['_charset_=utf-8'];
  const append = (key, value) => fields.push(`${key}=${encodeURIComponent(String(value))}`);
  Object.entries(values).forEach(([key, value]) => {
    const property = `./jcr:content/metadata/${key}`;
    if (Array.isArray(value)) {
      append(`${property}@Delete`, '');
      if (value.length) {
        append(`${property}@TypeHint`, 'String[]');
        value.forEach((item) => append(property, item));
      }
    } else {
      append(`${property}@TypeHint`, 'String');
      append(property, value);
    }
  });
  return fields.join('&');
}

async function saveAsset(connection, identity, input) {
  const values = valuesFor(input);
  // Always validate the current selection against this connection, not a local catalog cache.
  await validateSkus(connection, input.skus, identity);
  const before = await readAsset(connection, identity, input.assetPath);
  if (input.revision !== revision(before.metadata)) throw new AppError('Commerce metadata changed. Reload the asset before saving.', 409);
  try {
    await requestJson(`${connection.authorUrl}${encodedPath(before.path)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${identity.token}`,
        ...(identity.apiKey ? { 'x-api-key': identity.apiKey } : {}),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: metadataForm(values),
    }, 'AEM');
  } catch (error) {
    throw new AppError(`AEM did not confirm the save. Reload before retrying. ${error.message}`, error.status || 502);
  }
  let saved;
  try {
    saved = await readAsset(connection, identity, input.assetPath);
    if (saved.assetId !== before.assetId || FIELDS.some((key) =>
      JSON.stringify(saved.metadata[key] ?? (Array.isArray(values[key]) ? [] : null)) !== JSON.stringify(values[key]))) {
      throw new Error('Read-back mismatch');
    }
  } catch {
    throw new AppError('AEM accepted the save but metadata could not be verified. Reload before retrying.', 502);
  }
  const approved = String(saved.metadata['dam:status'] || '').toLowerCase() === 'approved';
  return {
    ...assetResult(saved),
    syncPending: true,
    warning: approved
      ? null
      : 'Metadata saved. Approve this asset in AEM and ensure the AEM Assets Integration is enabled before it can synchronize to Commerce.',
  };
}
module.exports = { readAsset, assetResult, saveAsset, valuesFor, metadataForm };
