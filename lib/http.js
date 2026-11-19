const { AppError } = require('./errors');
const dns = require('node:dns');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');

const privateAddresses = new BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([address, prefix]) => privateAddresses.addSubnet(address, prefix, 'ipv4'));
[
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
].forEach(([address, prefix]) => privateAddresses.addSubnet(address, prefix, 'ipv6'));
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

function lookupPublic(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => {
      const family = isIP(address);
      return !family || (family === 6 && !globalV6.check(address, 'ipv6')) ||
        privateAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4');
    })) {
      return callback(new Error('Commerce must resolve only to public IP addresses.'));
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function publicRequest(url, options) {
  return new Promise((resolve, reject) => {
    // Validate and pin DNS at socket connection time, not in a separate preflight.
    const request = https.request(url, {
      method: 'GET', headers: options.headers, signal: options.signal,
      lookup: lookupPublic, agent: false,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          response.destroy(new Error('Commerce response is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function requestJson(url, options, service, publicOnly = false) {
  const { parseResponse = options.method !== 'POST', ...requestOptions } = options;
  let response;
  try {
    const bounded = { ...requestOptions, redirect: 'error', signal: AbortSignal.timeout(10000) };
    response = await (publicOnly ? publicRequest(url, bounded) : fetch(url, bounded));
  } catch {
    throw new AppError(`${service} could not be reached. Check the connection and retry.`, 502);
  }
  if (!response.ok) {
    const status = [401, 403, 404, 409, 429].includes(response.status) ? response.status : 502;
    throw new AppError(`${service} returned HTTP ${response.status}. Check permissions and connection settings.`, status);
  }
  // Sling POST may return HTML rather than JSON; only reads require a JSON body.
  if (!parseResponse) return null;
  try { return await response.json(); } catch {
    throw new AppError(`${service} returned an unreadable response.`, 502);
  }
}
module.exports = { requestJson, lookupPublic };
