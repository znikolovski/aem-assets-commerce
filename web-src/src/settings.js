export function readSettings (guest) {
  const config = guest.configuration || {}
  const connectionId = config.connectionId
  const settings = {}
  if (connectionId !== undefined && connectionId !== '') {
    if (typeof connectionId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(connectionId)) {
      throw new Error('Set connectionId to a configured Commerce connection in Extension Manager, or remove it to configure the connection directly.')
    }
    settings.connectionId = connectionId
  }
  const keys = ['commerceUrl', 'storeCode', 'productsRoot']
  if (!settings.connectionId) keys.push('commerceToken')
  for (const key of keys) {
    if (config[key] !== undefined && config[key] !== '') {
      if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`Set ${key} to a text value in Extension Manager.`)
      settings[key] = config[key].trim()
    }
  }
  if (!settings.connectionId && (!settings.commerceUrl || !settings.commerceToken)) {
    throw new Error('Open Extension Manager > Configure and set commerceUrl and commerceToken, or select a server-side connectionId.')
  }
  return settings
}
