const { AppError } = require('./errors');

async function requestJson(url, options, service) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new AppError(`${service} could not be reached. Check the connection and retry.`, 502);
  }
  if (!response.ok) {
    const status = [401, 403, 404, 409, 429].includes(response.status) ? response.status : 502;
    throw new AppError(`${service} returned HTTP ${response.status}. Check permissions and connection settings.`, status);
  }
  // Sling POST may return HTML rather than JSON; only reads require a JSON body.
  if (options.method === 'POST') return null;
  try { return await response.json(); } catch {
    throw new AppError(`${service} returned an unreadable response.`, 502);
  }
}
module.exports = { requestJson };
