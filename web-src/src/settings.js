export function readSettings (guest) {
  const config = guest.configuration || {}
  const connectionId = config.connectionId
  if (typeof connectionId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(connectionId)) {
    throw new Error('Open Extension Manager > Configure and set connectionId to a configured Commerce connection.')
  }
  const settings = { connectionId }
  for (const key of ['commerceUrl', 'storeCode', 'productsRoot']) {
    if (config[key] !== undefined && config[key] !== '') {
      if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`Set ${key} to a text value in Extension Manager.`)
      settings[key] = config[key].trim()
    }
  }
  return settings
}
