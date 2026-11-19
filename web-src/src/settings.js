export function readSettings (guest) {
  const config = guest.configuration || {}
  if (config.commerceClientSecret !== undefined && config.commerceClientSecret !== '') {
    throw new Error('Remove commerceClientSecret from Extension Manager. OAuth client secrets belong in a server-side connection profile.')
  }
  const connectionId = config.connectionId
  const settings = {}
  if (connectionId !== undefined && connectionId !== '') {
    if (typeof connectionId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(connectionId)) {
      throw new Error('Set connectionId to a configured Commerce connection in Extension Manager, or remove it to configure the connection directly.')
    }
    settings.connectionId = connectionId
  }
  const keys = ['commerceUrl', 'storeCode', 'productsRoot', 'commerceType', 'commerceClientId']
  if (!settings.connectionId) keys.push('commerceToken')
  for (const key of keys) {
    if (config[key] !== undefined && config[key] !== '') {
      if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`Set ${key} to a text value in Extension Manager.`)
      settings[key] = config[key].trim()
    }
  }
  if (settings.commerceType !== undefined && !['accs', 'paas'].includes(settings.commerceType)) {
    throw new Error('Set commerceType to accs or paas in Extension Manager.')
  }
  if (!settings.connectionId) {
    const type = settings.commerceType || (settings.commerceToken ? 'paas' : 'accs')
    if (!settings.commerceUrl || (type === 'paas' && !settings.commerceToken)) {
      throw new Error('Open Extension Manager > Configure and set commerceUrl (and commerceToken for PaaS), or select a server-side connectionId.')
    }
    if (type === 'accs' && settings.commerceToken) {
      throw new Error('ACCS uses your Adobe IMS identity. Remove commerceToken from Extension Manager.')
    }
  }
  return settings
}
