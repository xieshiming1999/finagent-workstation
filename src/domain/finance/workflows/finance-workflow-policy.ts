export function isFinanceEvidenceTool(name: string): boolean {
  return ['MarketData', 'DataStore', 'DataProcess', 'WindMcp', 'Research', 'WebFetch'].includes(name)
}
