export const coreCnMarketIndexCodes = new Set([
  '000001',
  '399001',
  '399006',
  '000300',
  '000905',
  '000852',
  '000688',
  '000016',
  '399005',
])

export function isCoreCnMarketIndexCode(value: string): boolean {
  const match = value.trim().toUpperCase().match(/\d{6}/)
  return match ? coreCnMarketIndexCodes.has(match[0]) : false
}
