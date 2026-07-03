import type * as adv from '../../../agent/data/eastmoney-advanced'
import type * as dm from '../../../agent/data/data-manager'
import { fetchSectorStocks } from '../../../agent/data/eastmoney-fetcher'
import * as eastmoneyAdvanced from '../../../agent/data/eastmoney-advanced'
import * as dataManager from '../../../agent/data/data-manager'
import { EASTMONEY_RUNTIME_TIMEOUT_MS } from '../../../agent/data/provider-timeouts'

export interface EastmoneyMarketProvider {
  readSectorStocks(
    sector: { code: string; name: string },
    sectorType: 'industry' | 'concept' | 'area',
    limit: number,
  ): Promise<dm.Quote[]>
  readSectors(type: 'industry' | 'concept' | 'area'): Promise<dm.SectorItem[]>
  readLimitUp(date?: string): Promise<adv.LimitUpItem[]>
  readLimitDown(date?: string): Promise<adv.LimitDownItem[]>
  readDragonTiger(limit: number): Promise<adv.DragonTigerItem[]>
  readNorthboundHolding(code: string, limit: number): Promise<adv.NorthboundHoldingItem[]>
  readNorthboundFlow(limit: number): Promise<adv.NorthboundFlowItem[]>
  readHotRank(limit: number): Promise<adv.HotRankItem[]>
  readFlowRank(days: number): Promise<adv.FlowRankItem[]>
  readUnusual(): Promise<adv.UnusualActivityItem[]>
  readChip(code: string): Promise<Array<Record<string, unknown>>>
  readEtf(limit: number): Promise<Array<Record<string, unknown>>>
  readEarnings(code: string): Promise<Array<Record<string, unknown>>>
}

export class DefaultEastmoneyMarketProvider implements EastmoneyMarketProvider {
  readSectorStocks(
    sector: { code: string; name: string },
    sectorType: 'industry' | 'concept' | 'area',
    limit: number,
  ) {
    return fetchSectorStocks(sector, sectorType, limit)
  }

  readSectors(type: 'industry' | 'concept' | 'area') {
    return dataManager.getSectors(type)
  }

  readLimitUp(date?: string) {
    return eastmoneyAdvanced.fetchLimitUpPool(date)
  }

  readLimitDown(date?: string) {
    return eastmoneyAdvanced.fetchLimitDownPool(date)
  }

  readDragonTiger(limit: number) {
    return eastmoneyAdvanced.fetchDragonTiger(undefined, limit)
  }

  readNorthboundHolding(code: string, limit: number) {
    return eastmoneyAdvanced.fetchNorthboundHolding(code, limit)
  }

  readNorthboundFlow(limit: number) {
    return eastmoneyAdvanced.fetchNorthboundFlow(undefined, limit)
  }

  readHotRank(limit: number) {
    return eastmoneyAdvanced.fetchHotRank(limit)
  }

  readFlowRank(days: number) {
    return eastmoneyAdvanced.fetchFlowRanking(days)
  }

  readUnusual() {
    return eastmoneyAdvanced.fetchUnusualActivity()
  }

  async readChip(code: string) {
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_CHIP_DISTRIBUTION&filter=(SECUCODE=%22${code}.${code.startsWith('6') ? 'SH' : 'SZ'}%22)&pageSize=5&sortColumns=TRADE_DATE&sortTypes=-1`
    const res = await fetch(url, { signal: AbortSignal.timeout(EASTMONEY_RUNTIME_TIMEOUT_MS) })
    const json = await res.json() as Record<string, any>
    return Array.isArray(json?.result?.data) ? json.result.data : []
  }

  async readEtf(_limit: number) {
    const url = 'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=30&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:MK0021,b:MK0022,b:MK0023,b:MK0024&fields=f12,f14,f2,f3,f5'
    const res = await fetch(url, { signal: AbortSignal.timeout(EASTMONEY_RUNTIME_TIMEOUT_MS) })
    const json = await res.json() as Record<string, any>
    return Array.isArray(json?.data?.diff) ? json.data.diff : []
  }

  async readEarnings(code: string) {
    const prefix = code.startsWith('6') ? 'SH' : (code.startsWith('9') || code.startsWith('4') ? 'BJ' : 'SZ')
    const url = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${prefix}${code}`
    const res = await fetch(url, { signal: AbortSignal.timeout(EASTMONEY_RUNTIME_TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) {
      throw Object.assign(new Error(`EastMoney earnings API returned HTTP ${res.status}`), {
        status: res.status,
        failureClass: res.status >= 500 ? 'provider_outage' : 'unknown',
      })
    }
    const body = await res.json() as Record<string, any>
    return Array.isArray(body?.data) ? body.data : []
  }
}
