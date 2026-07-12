import { Role, type Message, type ToolUse } from '../../../agent/message'

interface MacroEvidence {
  hasMacroEvidence: boolean
  hasNewsRefresh: boolean
  contextLines: string[]
  nonMacroLines: string[]
  factorLines: string[]
  sourceLines: string[]
  contentLines: string[]
  evidenceLines: string[]
  newsLines: string[]
  missingLines: string[]
  reliabilityLines: string[]
  assetImpactLines: string[]
  decisionLines: string[]
}

export function maybeBuildMacroEvidenceAnswer(
  messages: Message[],
  options: {
    failureSummary: string
    suffix?: string
  },
): string | null {
  const evidence = collectMacroEvidence(messages)
  if (!evidence.hasMacroEvidence || !hasActionableMacroEvidence(evidence)) return null
  return [
    '已取得受治理的宏观证据，下面直接使用这些证据作答；未继续调用通用搜索、网页抓取、文件读取、脚本或交易工具。',
    '',
    ...buildMacroEvidenceSection(evidence),
    '',
    '## 回测 / 策略边界',
    '',
    '- 宏观研究、政策、商品、利率和资金流证据只能作为策略假设、观察条件或失效条件。',
    '- 这些证据不能直接编译成可执行交易信号；如果要进入回测，需要先把可量化变量改写为 StrategySpec 支持的指标、阈值、数据窗口和风险规则。',
    '- 本轮没有执行下单、保存策略或把宏观观点硬塞进交易信号。',
    '',
    '## 本轮限制',
    '',
    `- ${options.failureSummary}`,
    ...(options.suffix?.trim() ? [`- ${options.suffix.trim()}`] : []),
  ].join('\n')
}

function hasActionableMacroEvidence(evidence: MacroEvidence): boolean {
  return evidence.factorLines.length > 0 ||
    evidence.sourceLines.length > 0 ||
    evidence.contentLines.length > 0 ||
    evidence.evidenceLines.length > 0
}

export function collectMacroEvidence(messages: Message[]): MacroEvidence {
  const factorLines: string[] = []
  const sourceLines: string[] = []
  const contentLines: string[] = []
  const evidenceLines: string[] = []
  const newsLines: string[] = []
  const missingLines: string[] = []
  const reliabilityLines: string[] = []
  const assetImpactLines: string[] = []
  const decisionLines: string[] = []
  const contextLines: string[] = []
  const nonMacroLines: string[] = []
  let sawMacroAction = false
  let hasNewsRefresh = false
  const toolCallsById = new Map<string, ToolUse>()
  for (const message of messages) {
    if (message.role !== Role.Assistant) continue
    for (const call of message.toolUses ?? []) toolCallsById.set(call.id, call)
  }

  for (const message of messages) {
    if (message.role === Role.Assistant) {
      for (const call of message.toolUses ?? []) {
        const action = text(call.input.action)
        if (action.includes('macro')) {
          contextLines.push(...callContextLines(call.input))
        } else {
          const line = nonMacroCallLine(call.name, call.input)
          if (line) nonMacroLines.push(line)
        }
      }
      continue
    }
    if (message.role !== Role.Tool || !message.toolResult || message.toolResult.isError) continue
    const financeNewsLine = financeNewsResultLine(message.toolResult.content)
    if (financeNewsLine) {
      hasNewsRefresh = true
      newsLines.push(financeNewsLine)
      continue
    }
    const decoded = parseJsonObject(message.toolResult.content)
    if (!decoded) {
      const call = toolCallsById.get(message.toolResult.toolUseId)
      const line = call
        ? nonMacroTextResultLine(call, message.toolResult.content)
        : nonMacroTextResultLineFromContent(message.toolResult.content)
      if (line) nonMacroLines.push(line)
      continue
    }
    const action = text(decoded.action)
    const sourceReaderMacroPayload = sourceReaderMacroPayloadFrom(decoded)
    if (sourceReaderMacroPayload) {
      sawMacroAction = true
      factorLines.push(...factorRows(sourceReaderMacroPayload))
      reliabilityLines.push(...reliabilityRows(sourceReaderMacroPayload))
      assetImpactLines.push(...assetImpactRows(sourceReaderMacroPayload))
      decisionLines.push(...decisionRows(sourceReaderMacroPayload))
      evidenceLines.push(...evidenceRows(sourceReaderMacroPayload))
      continue
    }
    if (action === 'query_finance_news') {
      const line = financeNewsPayloadLine(decoded)
      if (line) newsLines.push(line)
      reliabilityLines.push(...reliabilityRows(decoded, 'linked_news_evidence'))
      assetImpactLines.push(...assetImpactRows(decoded))
      decisionLines.push(...decisionRows(decoded, 'linked_news_evidence'))
      continue
    }
    if (!action.includes('macro')) {
      const line = nonMacroResultLine(decoded)
      if (line) nonMacroLines.push(line)
      continue
    }
    sawMacroAction = true
    if (text(decoded.status) === 'missing') {
      const reason = text(decoded.missingReason)
      if (reason) missingLines.push(`${action}: ${reason}`)
    }
    reliabilityLines.push(...reliabilityRows(decoded))
    assetImpactLines.push(...assetImpactRows(decoded))
    decisionLines.push(...decisionRows(decoded))
    switch (action) {
      case 'query_macro_factors':
      case 'query_macro_numeric_series':
        factorLines.push(...factorRows(decoded))
        break
      case 'macro_research_sources':
        sourceLines.push(...sourceRows(decoded))
        break
      case 'query_macro_research_content':
        contentLines.push(...contentRows(decoded))
        break
      case 'query_macro_research_evidence':
      case 'macro_research_provenance':
      case 'macro_research_extract':
      case 'macro_research_extraction_status':
      case 'query_macro_attribution':
        evidenceLines.push(...evidenceRows(decoded))
        break
      default:
        evidenceLines.push(...evidenceRows(decoded))
        break
    }
  }

  return {
    hasMacroEvidence: sawMacroAction,
    hasNewsRefresh,
    contextLines: dedupe(contextLines),
    nonMacroLines: dedupe(nonMacroLines),
    factorLines: dedupe(factorLines),
    sourceLines: dedupe(sourceLines),
    contentLines: dedupe(contentLines),
    evidenceLines: dedupe(evidenceLines),
    newsLines: dedupe(newsLines),
    missingLines: dedupe(missingLines),
    reliabilityLines: dedupe(reliabilityLines),
    assetImpactLines: dedupe(assetImpactLines),
    decisionLines: dedupe(decisionLines),
  }
}

function financeNewsPayloadLine(payload: Record<string, unknown>): string {
  const dataRows = rows(payload, 'data')
  const sourceDataTime = text(payload.sourceDataTime)
  const fetchedAt = text(payload.fetchedAt)
  const query = text(payload.query ?? payload.keyword)
  const headlines = dataRows.slice(0, 2).map((row) =>
    compact([text(row.published_at), `[${text(row.source)}]`, text(row.title), text(row.url)].filter(Boolean).join(' '), 120)
  ).join('；')
  if (dataRows.length === 0 && !sourceDataTime && !fetchedAt) return query
    ? `query=${query} / cacheStatus=${text(payload.cacheStatus)} / evidenceTier=linked_news_evidence / limitation=target_news_query_miss`
    : ''
  return [
    query ? `query=${query}` : '',
    sourceDataTime ? `sourceTime=${sourceDataTime}` : '',
    fetchedAt ? `fetchedAt=${fetchedAt} / 获取时间=${fetchedAt}` : '',
    `count=${text(payload.count) || dataRows.length}`,
    'evidenceTier=linked_news_evidence',
    'limitation=news_clue_not_official_fact',
    headlines,
  ].filter(Boolean).join(' / ')
}

function buildMacroEvidenceSection(evidence: MacroEvidence): string[] {
  const lines = [
    '## 宏观证据与来源状态',
    '',
  ]
  if (evidence.factorLines.length === 0) {
    lines.push('- 宏观因子：本轮没有命中可复用 `market_moving_factor_v1` 行；这表示证据缺口，不表示宏观因素无关。')
  } else {
    lines.push(`- 宏观因子：${evidence.factorLines.slice(0, 3).join('；')}。`)
  }
  if (evidence.contextLines.length > 0) {
    lines.push(`- 分析对象/口径：${evidence.contextLines.slice(0, 4).join('；')}。`)
  }
  if (hasFundContext(evidence)) {
    lines.push('- 基金分类口径：消费基金关注消费复苏、居民收入、白酒/零售政策和风险偏好；科技基金关注流动性、产业政策、外部限制和成长股估值折现率；债券基金关注利率、信用、流动性和久期风险。缺失任一类别的高等级证据时，应降低对应结论置信度。')
  }
  if (evidence.nonMacroLines.length > 0) {
    lines.push(`- 非宏观证据状态：${sortEvidenceLines(evidence.nonMacroLines).slice(0, 12).join('；')}。`)
  }
  if (evidence.sourceLines.length > 0) {
    lines.push(`- 来源目录读回：${evidence.sourceLines.slice(0, 4).join('；')}。`)
  }
  if (evidence.contentLines.length > 0) {
    lines.push(`- 内容证据：${evidence.contentLines.slice(0, 3).join('；')}。`)
  }
  if (evidence.evidenceLines.length > 0) {
    lines.push(`- 访问/检索证据：${evidence.evidenceLines.slice(0, 4).join('；')}。`)
  }
  if (evidence.newsLines.length > 0) {
    const prefix = evidence.hasNewsRefresh
      ? '新闻刷新与读回'
      : '新闻线索读回'
    lines.push(`- ${prefix}：${evidence.newsLines.slice(0, 4).join('；')}。新闻只作为发现和当前事件线索，不能替代官方数据或内容级研究证据。`)
  }
  if (evidence.missingLines.length > 0) {
    lines.push(`- 不确定性/数据缺口/缺失证据：${evidence.missingLines.slice(0, 4).join('；')}。`)
  }
  if (evidence.reliabilityLines.length > 0) {
    lines.push(`- 可靠性（证据等级/新鲜度/访问/置信度）：${evidence.reliabilityLines.slice(0, 5).join('；')}。`)
  }
  if (evidence.assetImpactLines.length > 0) {
    lines.push(`- 资产影响（行业/基金/策略口径）：${evidence.assetImpactLines.slice(0, 5).join('；')}。`)
  }
  if (evidence.decisionLines.length > 0) {
    lines.push(`- 信心影响/置信度/下一步：${evidence.decisionLines.slice(0, 5).join('；')}。`)
  }
  lines.push(
    '',
    '## 宏观假设和失效条件',
    '',
    '- 利率/流动性：如果政策利率、资金利率或期限利差与当前假设相反，股票、债券基金或策略结论需要重新验证。',
    '- 信用：如果信用利差、违约风险、融资环境或评级迁移证据与当前假设相反，债券基金和信用类资产结论需要重新验证。',
    '- 商品/能源：如果商品库存、关税、供需或能源价格出现反向变化，资源品、制造业成本和风险偏好判断需要重估。',
    '- 外资/指数事件：如果指数公司调整、被动资金流或跨境流动证据缺失，应把相关结论降级为观察假设。',
    '- 政策/监管：官方政策和交易所规则应作为独立证据层，不能用研究文章替代。',
    '- 更新要求：在保存、复跑或监控策略前，应先更新宏观来源目录、新闻线索和可用官方/研究证据，并重新读回证据层级。',
  )
  return lines
}

function nonMacroCallLine(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Watchlist') {
    const action = text(input.action)
    return action === 'list' || action === 'list_groups'
      ? `自选股: 已请求 ${action}，需以工具结果或本地读回为准`
      : ''
  }
  if (toolName !== 'DataStore' && toolName !== 'MarketData') return ''
  const action = text(input.action)
  const label = actionLabel(action)
  if (!label) return ''
  const target = text(input.code) || text(input.symbol) || listText(input.symbols) || listText(input.codes) || text(input.type)
  return `${label}: 已请求${target ? ` ${target}` : ''}，需以工具结果或本地读回为准`
}

function nonMacroResultLine(payload: Record<string, unknown>): string {
  const action = text(payload.action)
  const label = actionLabel(action) || dataProcessActionLabel(action)
  if (!label) return ''
  const evidenceDetail = structuredEvidenceDetail(action, payload)
  if (evidenceDetail) return `${label}: ${evidenceDetail}`
  const count = text(payload.count ?? (Array.isArray(payload.rows) ? payload.rows.length : ''))
  const status = text(payload.status)
  const source = text(payload.source ?? payload.provider)
  const code = text(payload.code ?? payload.symbol)
  const detail = [
    code,
    source ? `source=${source}` : '',
    status ? `status=${status}` : '',
    count ? `count=${count}` : '',
  ].filter(Boolean).join(' / ')
  return `${label}${detail ? `: ${detail}` : ': 已返回结构化结果'}`
}

function nonMacroTextResultLine(call: ToolUse, content: string): string {
  if (/^\s*Skipped:/i.test(content)) return ''
  if (call.name !== 'DataStore' && call.name !== 'MarketData' && call.name !== 'DataProcess') return ''
  const action = text(call.input.action)
  const label = actionLabel(action) || dataProcessActionLabel(action)
  if (!label) return ''
  const code = text(call.input.code ?? call.input.symbol) || extractCode(content)
  const provenance = extractProvenance(content)
  const facts = extractEvidenceFacts(action, content)
  const parts = [
    code,
    provenance,
    facts,
  ].filter(Boolean)
  return `${label}${parts.length ? `: ${parts.join(' / ')}` : ': 已返回工具结果'}`
}

function nonMacroTextResultLineFromContent(content: string): string {
  if (/^\s*Skipped:/i.test(content)) return ''
  const action = inferActionFromContent(content)
  if (!action) return ''
  const label = actionLabel(action) || dataProcessActionLabel(action)
  if (!label) return ''
  const code = extractCode(content)
  const provenance = extractProvenance(content)
  const facts = extractEvidenceFacts(action, content)
  const parts = [
    code,
    provenance,
    facts,
  ].filter(Boolean)
  return `${label}${parts.length ? `: ${parts.join(' / ')}` : ': 已返回工具结果'}`
}

function inferActionFromContent(content: string): string {
  if (/interface:stock\.quote\b/i.test(content) || /\bquote snapshots\b/i.test(content)) return 'query_quote'
  if (/interface:stock\.daily_kline\b/i.test(content) || /\bdaily kline\b/i.test(content)) return 'query_kline'
  if (/interface:stock\.daily_valuation\b/i.test(content) || /\bfundamentals\b/i.test(content)) return 'query_fundamental'
  if (/interface:market\.sector_ranking\b/i.test(content) || /\bSector ranking\b/i.test(content)) return 'query_sector_ranking'
  return ''
}

function dataProcessActionLabel(action: string): string {
  const labels: Record<string, string> = {
    summary: '技术摘要',
    indicators: '技术指标',
    support_summary: '支撑阻力',
    volume_analysis: '量能分析',
  }
  return labels[action] ?? ''
}

function extractCode(content: string): string {
  return content.match(/\b\d{6}\b/)?.[0] ?? ''
}

function extractProvenance(content: string): string {
  const interfaceId = content.match(/interface:([^|\n]+)/)?.[1]?.trim()
  const provider = content.match(/provider:([^|\n]+)/)?.[1]?.trim()
  const cache = content.match(/cacheStatus:([^|\n]+)/)?.[1]?.trim()
  const asOf = content.match(/asOf:([^|\n]+)/)?.[1]?.trim()
  const fetchedAt = content.match(/fetchedAt:([^|\n]+)/)?.[1]?.trim()
  return [
    interfaceId ? `interface=${interfaceId}` : '',
    provider ? `provider=${provider}` : '',
    cache ? `cache=${cache}` : '',
    asOf ? `asOf=${asOf}` : '',
    fetchedAt ? `fetchedAt=${fetchedAt}` : '',
  ].filter(Boolean).join(' / ')
}

function extractEvidenceFacts(action: string, content: string): string {
  const compacted = compact(content.replace(/\s+/g, ' '), 160)
  if (action === 'query_kline' || action === 'kline') {
    const bars = content.match(/(\d+)\s+bars/i)?.[1]
    const window = content.match(/\((\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2})\)/)?.[1]
    return [bars ? `${bars} bars` : '', window].filter(Boolean).join(' / ') || compacted
  }
  if (action === 'query_fundamental') {
    const pe = content.match(/\bPE:([^\s]+)/)?.[1]
    const pb = content.match(/\bPB:([^\s]+)/)?.[1]
    const roe = content.match(/\bROE:([^\s]+)/)?.[1]
    const report = content.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
    return [
      report ? `report=${report}` : '',
      pe ? `PE=${pe}` : '',
      pb ? `PB=${pb}` : '',
      roe ? `ROE=${roe}` : '',
    ].filter(Boolean).join(' / ') || compacted
  }
  if (action === 'quote' || action === 'query_quote') {
    const price = content.match(/(?:price|Price|最新价|C):\s*([0-9.]+)/)?.[1]
    const change = content.match(/(?:change|涨幅|Chg):\s*([+\-0-9.]+%?)/)?.[1]
    return [price ? `price=${price}` : '', change ? `change=${change}` : ''].filter(Boolean).join(' / ') || compacted
  }
  if (action === 'summary') {
    const signal = content.match(/"overall"\s*:\s*"([^"]+)"/)?.[1]
    return signal ? `signal=${signal}` : compacted
  }
  if (action === 'indicators') {
    return 'typed indicator evidence unavailable'
  }
  return compacted
}

function structuredEvidenceDetail(action: string, payload: Record<string, unknown>): string {
  if (action === 'indicators') {
    const latest = payload.latest
    const indicators = payload.indicators
    if (
      payload.interfaceId !== 'technical.indicator_series' ||
      !isRecord(latest) ||
      !isRecord(indicators)
    ) return ''
    const close = finiteNumber(latest.close)
    const rsi = finiteNumber(indicators.rsi14)
    return [
      text(payload.code),
      close == null ? '' : `close=${close}`,
      rsi == null ? '' : `RSI=${rsi}`,
    ].filter(Boolean).join(' / ')
  }
  if (action === 'score_technical') {
    return [
      text(payload.code),
      text(payload.score) ? `score=${text(payload.score)}` : '',
      text(payload.grade) ? `grade=${text(payload.grade)}` : '',
      text(payload.signal) ? `signal=${text(payload.signal)}` : '',
      text(payload.rsi) ? `RSI=${text(payload.rsi)}` : '',
    ].filter(Boolean).join(' / ')
  }
  return ''
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    quote: '个股行情',
    kline: 'K 线/技术面',
    money_flow: '资金流向',
    query_quote: '个股行情',
    query_index_quote: '指数/市场技术面',
    query_kline: 'K 线/技术面',
    query_fundamental: '基本面/估值',
    query_money_flow: '资金流向',
    query_sector_ranking: '板块热度',
    query_flow_rank: '资金流向',
    query_northbound_flow: '北向资金',
    query_fund_nav: '基金净值',
    query_fund_money_yield: '货币基金收益',
    query_fund_holding: '基金持仓',
    query_stock_company_info: '自选股公司信息',
    query_fund_company_info: '基金公司信息',
    summary: '技术摘要',
    score_technical: '技术评分',
  }
  if (labels[action]) return labels[action]
  if (action === 'fetch') return '数据刷新'
  return ''
}

function listText(value: unknown): string {
  return Array.isArray(value) ? value.map(text).filter(Boolean).join(',') : ''
}

function callContextLines(input: Record<string, unknown>): string[] {
  const values = [
    targetLabel(text(input.target)),
    targetLabel(text(input.assets)),
    targetLabel(text(input.symbol)),
    targetLabel(text(input.code)),
    familyLabel(text(input.family)),
    categoryLabel(text(input.category)),
  ].filter(Boolean)
  return values as string[]
}

function targetLabel(value: string): string {
  if (!value) return ''
  if (value.includes(',')) {
    return value.split(',').map((item) => targetLabel(item.trim())).filter(Boolean).join('；')
  }
  if (/^a[-_ ]?shares$/i.test(value)) return 'A 股'
  if (/^china equities$/i.test(value)) return '中国股票 / A 股相关'
  if (/^bond funds?$/i.test(value)) return '债券基金'
  if (/^consumption funds?$/i.test(value)) return '消费基金'
  if (/^consumer equities$/i.test(value)) return '消费基金/消费权益'
  if (/^technology funds?$/i.test(value)) return '科技基金'
  if (/^technology equities$/i.test(value)) return '科技基金/科技权益'
  if (/^equity funds?$/i.test(value)) return '权益基金'
  if (/^index funds?$/i.test(value)) return '指数基金'
  if (/^money funds?$/i.test(value)) return '货币基金'
  if (/^industry funds?$/i.test(value)) return '行业基金'
  if (/^(stock|equity)$/i.test(value)) return '股票/权益'
  if (/^funds?$/i.test(value)) return '基金'
  if (/^strategy$/i.test(value)) return '策略'
  if (/^moutai$/i.test(value) || /^kweichow\s+moutai$/i.test(value)) return '贵州茅台 / Moutai'
  if (value === '600519') return '贵州茅台 600519'
  if (/^chinese spirits$/i.test(value)) return '白酒'
  if (/^china consumption$/i.test(value)) return '中国消费'
  if (/^china liquor regulation$/i.test(value)) return '白酒监管'
  return value
}

function familyLabel(value: string): string {
  if (!value) return ''
  const labels: Record<string, string> = {
    rates_liquidity: '利率/流动性',
    policy_regulation: '政策/监管',
    narrative_attention: '叙事/关注度',
    commodity_research: '商品/能源',
    index_classification: '指数/被动资金',
    risk_appetite: '风险偏好',
    macro_official_series: '官方宏观数值序列',
    official_macro_fact: '官方宏观事实',
  }
  return labels[value] ?? value
}

function categoryLabel(value: string): string {
  return familyLabel(value)
}

function hasFundContext(evidence: MacroEvidence): boolean {
  const textValue = [
    ...evidence.contextLines,
    ...evidence.factorLines,
    ...evidence.assetImpactLines,
    ...evidence.decisionLines,
  ].join(' ')
  return /基金|fund/i.test(textValue)
}

function sortEvidenceLines(lines: string[]): string[] {
  return [...lines].sort((a, b) => evidenceLineRank(a) - evidenceLineRank(b))
}

function evidenceLineRank(line: string): number {
  if (line.includes('已请求')) return 2
  return 0
}

function factorRows(payload: Record<string, unknown>): string[] {
  return macroRows(payload).map((row) => {
    const title = text(row.title ?? row.factor_name ?? row.factorId ?? row.metricName ?? row.seriesId)
    const family = text(row.family)
    const source = text(row.source ?? row.provider)
    const time = text(row.sourceDataTime ?? row.source_time)
    const value = text(row.value)
    const unit = text(row.unit)
    return [title, family, source, time, value ? `value=${value}${unit ? ` ${unit}` : ''}` : ''].filter(Boolean).join(' / ')
  }).filter(Boolean)
}

function sourceReaderMacroPayloadFrom(payload: Record<string, unknown>): Record<string, unknown> | null {
  const contract = text(payload.contract)
  if (
    contract !== 'source-reader-macro-evidence-result-v1' &&
    contract !== 'source-reader-macro-numeric-evidence-result-v1'
  ) return null
  const record = isRecord(payload.record) ? payload.record : null
  if (!record) return null
  const numeric = isRecord(record.numericSeries) ? record.numericSeries : {}
  const row = {
    ...record,
    ...numeric,
    sourceName: record.sourceName ?? record.source,
    sourceDataTime: record.sourceDataTime ?? record.sourceDate,
    evidenceTier: record.evidenceTier ?? record.evidenceClass,
    sourceType: record.sourceType ?? record.evidenceClass,
    status: record.status ?? record.freshness,
  }
  return {
    action: 'source_reader_macro_evidence',
    status: 'ok',
    rows: [row],
  }
}

function sourceRows(payload: Record<string, unknown>): string[] {
  return rows(payload).map((row) => {
    const name = text(row.providerName ?? row.provider)
    const access = text(row.accessClass ?? row.automationPolicy)
    const categories = Array.isArray(row.categories)
      ? row.categories.slice(0, 3).map(text).filter(Boolean).join(',')
      : text(row.category)
    const bucket = sourceBucket(row)
    return [bucket, name, categories, access].filter(Boolean).join(' / ')
  }).filter(Boolean)
}

function sourceBucket(row: Record<string, unknown>): string {
  const haystack = [
    row.provider,
    row.providerName,
    row.accessClass,
    row.automationPolicy,
    row.sourceType,
    row.kind,
    row.category,
    ...(Array.isArray(row.categories) ? row.categories : []),
  ].map(text).join(' ').toLowerCase()
  const restricted = /(licensed|blocked|manual|anti[- ]?bot|security|restricted|gated|paywall)/.test(haystack)
  const research = /(research|insight|public-html|pdf|institutional|blackrock|pimco|jpmorgan|goldman|msci|ftse|s&p|cme)/.test(haystack)
  if (/(official|government|central bank|regulator|exchange|api|pbo[c]?|nbs|safe|csrc|fred|bea|world bank|imf|bis|eia|opec|iea)/.test(haystack)) {
    return '官方来源'
  }
  if (/(news|feed|search)/.test(haystack)) {
    return '新闻来源'
  }
  if (research && restricted) {
    return '研究来源(受限)'
  }
  if (research) {
    return '研究来源'
  }
  if (restricted) {
    return '受限来源'
  }
  return '来源'
}

function contentRows(payload: Record<string, unknown>): string[] {
  const contentRows = rows(payload, 'contentEvidence').length > 0
    ? rows(payload, 'contentEvidence')
    : rows(payload)
  return contentRows.map((row) => {
    const title = text(row.title ?? row.factor_name)
    const provider = text(row.provider ?? row.source ?? row.sourceName)
    const date = text(row.sourceDate ?? row.sourceDataTime)
    const hash = text(row.contentHash)
    const claims = Array.isArray(row.keyClaims)
      ? row.keyClaims.slice(0, 2).map(text).filter(Boolean).join('；')
      : text(row.keyClaims)
    const preview = text(row.bodyPreview)
    return [
      title,
      provider,
      date,
      hash ? `hash=${hash.slice(0, 12)}` : '',
      claims,
      preview ? `preview=${compact(preview, 120)}` : '',
    ].filter(Boolean).join(' / ')
  }).filter(Boolean)
}

function evidenceRows(payload: Record<string, unknown>): string[] {
  const lines: string[] = []
  for (const row of rows(payload).slice(0, 8)) {
    const provider = text(row.provider ?? row.source ?? row.sourceName)
    const family = text(row.family)
    const status = text(row.status ?? row.failure_class)
    const limitation = text(row.limitation ?? row.missingReason)
    const line = [provider, family, status, limitation].filter(Boolean).join(' / ')
    if (line) lines.push(line)
  }
  const generated = text(payload.generatedRows)
  if (generated) lines.push(`${text(payload.action)}: generatedRows=${generated}`)
  const extracted = text(payload.extracted)
  if (extracted) lines.push(`${text(payload.action)}: extracted=${extracted}`)
  return lines
}

function reliabilityRows(payload: Record<string, unknown>, fallbackTier = ''): string[] {
  return evidenceCandidateRows(payload).map((row) => {
    const tier = text(row.evidenceTier ?? row.evidence_tier) || fallbackTier || tierForRow(row)
    const sourceType = text(row.sourceType ?? row.source_type) || sourceTypeForTier(tier)
    const source = text(row.sourceName ?? row.source_name ?? row.provider ?? row.source) || 'macro'
    const sourceTime = text(row.sourceDataTime ?? row.source_data_time ?? row.sourceDate ?? row.source_date ?? row.published_at)
    const fetchedAt = text(row.fetchedAt ?? row.fetched_at)
    const access = accessStatus(row)
    const freshness = freshnessStatus(sourceTime, fetchedAt, access)
    const confidence = text(row.confidence ?? row.reliability) || confidenceForTier(tier, access, freshness)
    const limitation = text(row.limitations ?? row.limitation ?? row.missingReason ?? row.failureClass ?? row.failure_class)
    return [
      source,
      `tier=${tier}`,
      sourceType ? `type=${sourceType}` : '',
      `freshness=${freshness}`,
      `access=${access}`,
      `confidence=${confidence}`,
      limitation ? `limit=${compact(limitation, 80)}` : '',
    ].filter(Boolean).join(' / ')
  }).filter(Boolean)
}

function assetImpactRows(payload: Record<string, unknown>): string[] {
  return evidenceCandidateRows(payload).map((row) => {
    const title = text(row.title ?? row.factor_name ?? row.factorId ?? row.provider ?? row.sourceName)
    const family = text(row.family)
    const assets = listValues(row.affectedAssets ?? row.affected_assets ?? row.assetClasses ?? row.asset_classes ?? row.assets)
    const regions = listValues(row.regions ?? row.marketRegions ?? row.market_regions ?? row.region)
    const sectors = listValues(row.sectors ?? row.themes ?? row.theme)
    const fundTypes = listValues(row.fundTypes ?? row.fund_types)
    const channels = listValues(row.transmissionChannels ?? row.transmission_channels ?? row.strategyImpact ?? row.strategy_impact)
    const direction = impactDirection(row)
    const target = [
      assets.length ? `asset=${assets.slice(0, 4).join(',')}` : '',
      regions.length ? `region=${regions.slice(0, 3).join(',')}` : '',
      sectors.length ? `sector=${sectors.slice(0, 4).join(',')}` : '',
      fundTypes.length ? `fund=${fundTypes.slice(0, 3).join(',')}` : '',
      channels.length ? `channel=${channels.slice(0, 4).join(',')}` : '',
    ].filter(Boolean).join(' / ')
    return [title || family || 'macro', `impact=${direction}`, target || 'target=needs-linking'].filter(Boolean).join(' / ')
  }).filter(Boolean)
}

function decisionRows(payload: Record<string, unknown>, fallbackTier = ''): string[] {
  return evidenceCandidateRows(payload).map((row) => {
    const title = text(row.title ?? row.factor_name ?? row.factorId ?? row.provider ?? row.sourceName) || 'macro'
    const tier = text(row.evidenceTier ?? row.evidence_tier) || fallbackTier || tierForRow(row)
    const access = accessStatus(row)
    const sourceTime = text(row.sourceDataTime ?? row.source_data_time ?? row.sourceDate ?? row.source_date ?? row.published_at)
    const fetchedAt = text(row.fetchedAt ?? row.fetched_at)
    const freshness = freshnessStatus(sourceTime, fetchedAt, access)
    const confidenceEffect = text(row.confidenceEffect ?? row.confidence_effect) || confidenceEffectFor(tier, access, freshness, row)
    const missing = text(row.missingEvidence ?? row.missing_evidence ?? row.missingReason ?? row.failureClass ?? row.failure_class)
    const conflict = text(row.conflictingEvidence ?? row.conflicting_evidence)
    const next = text(row.nextEvidenceAction ?? row.next_evidence_action ?? row.nextAction) || nextEvidenceAction(access, freshness, missing)
    return [
      title,
      `confidenceEffect=${confidenceEffect}`,
      missing ? `missing=${compact(missing, 80)}` : '',
      conflict ? `conflict=${compact(conflict, 80)}` : '',
      `next=${next}`,
    ].filter(Boolean).join(' / ')
  }).filter(Boolean)
}

function evidenceCandidateRows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const candidates = [
    ...macroRows(payload),
    ...rows(payload, 'contentEvidence'),
    ...rows(payload, 'data').map((row) => ({
      ...row,
      evidenceTier: 'linked_news_evidence',
      sourceType: 'news',
      sourceDataTime: row.published_at ?? payload.sourceDataTime,
      fetchedAt: payload.fetchedAt,
      sourceName: row.source ?? payload.provider ?? 'finance_news',
      limitations: 'news_clue_not_official_fact',
    })),
  ]
  if (candidates.length > 0) return candidates
  const action = text(payload.action)
  if (!action) return []
  return [{
    provider: text(payload.provider ?? payload.source ?? action),
    sourceDataTime: payload.sourceDataTime,
    fetchedAt: payload.fetchedAt,
    status: payload.status,
    missingReason: payload.missingReason,
    evidenceTier: action === 'query_finance_news' ? 'linked_news_evidence' : '',
  }]
}

function macroRows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  return [...rows(payload), ...rows(payload, 'series')]
}

function tierForRow(row: Record<string, unknown>): string {
  const family = text(row.family).toLowerCase()
  const sourceType = text(row.sourceType ?? row.source_type).toLowerCase()
  const status = text(row.status ?? row.failureClass ?? row.failure_class).toLowerCase()
  if (/(blocked|gated|missing|failed|unsupported|manual|licensed)/.test(status)) return 'blocked/gated/missing'
  if (/official.*series|macro_official_series|numeric/.test(family)) return 'official_numeric_fact'
  if (/official|policy|regulation|index_event|event|document/.test(family) || /official/.test(sourceType)) return 'official_event_document'
  if (/research|content|document|asset_manager/.test(family) || /research/.test(sourceType)) return 'content-backed_research'
  if (/news/.test(family) || /news/.test(sourceType)) return 'linked_news_evidence'
  if (/retrieval|provenance|extract/.test(family) || /retrieval/.test(sourceType)) return 'retrieval_evidence'
  return 'content-backed_research'
}

function sourceTypeForTier(tier: string): string {
  if (tier.includes('official_numeric')) return 'official_data'
  if (tier.includes('official_event')) return 'official_event'
  if (tier.includes('research')) return 'research'
  if (tier.includes('news')) return 'news'
  if (tier.includes('retrieval')) return 'retrieval-only'
  if (tier.includes('blocked') || tier.includes('missing')) return 'blocked_or_missing'
  return ''
}

function accessStatus(row: Record<string, unknown>): string {
  const value = text(row.accessStatus ?? row.access_status ?? row.accessClass ?? row.automationPolicy ?? row.status ?? row.failureClass ?? row.failure_class).toLowerCase()
  if (!value) return 'public'
  if (value.includes('api-key')) return 'api-key-required'
  if (value.includes('credential') || value.includes('quota')) return 'credential-gated'
  if (value.includes('manual')) return 'manual-browser'
  if (value.includes('anti-bot')) return 'anti-bot'
  if (value.includes('security') || value.includes('blocked')) return 'security-blocked'
  if (value.includes('do-not-scrape')) return 'do-not-scrape'
  if (value.includes('licensed') || value.includes('paywall')) return 'licensed-needed'
  return 'public'
}

function freshnessStatus(sourceTime: string, fetchedAt: string, access: string): string {
  if (/(blocked|manual|anti-bot|licensed|do-not-scrape|security)/.test(access)) return 'blocked'
  const sourceDate = parseDate(sourceTime)
  const fetchedDate = parseDate(fetchedAt)
  if (!sourceDate && !fetchedDate) return 'missing'
  if (!sourceDate || !fetchedDate) return 'acceptable'
  const days = Math.abs(fetchedDate.getTime() - sourceDate.getTime()) / 86_400_000
  if (days <= 7) return 'fresh'
  if (days <= 60) return 'acceptable'
  return 'stale'
}

function confidenceForTier(tier: string, access: string, freshness: string): string {
  if (tier.includes('blocked') || access !== 'public' || freshness === 'blocked' || freshness === 'missing') return 'low'
  if (tier.includes('official') && freshness !== 'stale') return 'high'
  if (tier.includes('research') || tier.includes('news')) return 'medium'
  return 'low'
}

function impactDirection(row: Record<string, unknown>): string {
  const value = text(row.expectedDirection ?? row.expected_direction ?? row.impact ?? row.direction).toLowerCase()
  if (/(positive|tailwind|利好|上行)/.test(value)) return 'positive tailwind'
  if (/(negative|headwind|利空|下行)/.test(value)) return 'negative headwind'
  if (/(mixed|分化|双向)/.test(value)) return 'mixed'
  if (/(watch|monitor|观察)/.test(value)) return 'watch-only'
  return 'watch-only'
}

function confidenceEffectFor(tier: string, access: string, freshness: string, row: Record<string, unknown>): string {
  const status = text(row.status ?? row.failureClass ?? row.failure_class).toLowerCase()
  if (status.includes('missing') || status.includes('failed') || freshness === 'missing') return 'insufficient evidence'
  if (access !== 'public' || freshness === 'blocked' || freshness === 'stale') return 'lowers confidence'
  if (tier.includes('official') && freshness === 'fresh') return 'raises confidence'
  if (tier.includes('news')) return 'neutral'
  return 'mixed'
}

function nextEvidenceAction(access: string, freshness: string, missing: string): string {
  if (missing) return 'refresh or request higher-tier evidence'
  if (/(manual|anti-bot|licensed|do-not-scrape|security)/.test(access)) return 'manual-browser evidence or do not retry'
  if (access === 'credential-gated' || access === 'api-key-required') return 'configure credential then serial probe'
  if (freshness === 'stale' || freshness === 'missing') return 'refresh allowed source then readback'
  return 'use cache/readback'
}

function parseDate(value: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function listValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).map(displayMacroValue).filter(Boolean)
  const stringValue = text(value)
  return stringValue ? stringValue.split(/[;,，、]/).map((item) => displayMacroValue(item.trim())).filter(Boolean) : []
}

function displayMacroValue(value: string): string {
  return targetLabel(familyLabel(value))
}

function financeNewsResultLine(content: string): string {
  const firstLine = content.trim().split('\n').find((line) => line.trim())?.trim() ?? ''
  if (!firstLine.startsWith('finance_news |')) return ''
  const rows = content.split('\n').slice(1).map((line) => line.trim()).filter(Boolean)
  const source = firstLine.match(/\|\s*provider:([^|]+)/)?.[1]?.trim() ?? ''
  const asOf = firstLine.match(/\|\s*asOf:([^|]+)/)?.[1]?.trim() ?? ''
  const fetchedAt = firstLine.match(/\|\s*fetchedAt:([^|]+)/)?.[1]?.trim() ?? ''
  const headlines = rows.slice(0, 2).map((line) => compact(line, 120)).join('；')
  return [
    source ? `provider=${source}` : 'provider=finance_news',
    asOf ? `sourceTime=${asOf}` : '',
    fetchedAt ? `fetchedAt=${fetchedAt} / 获取时间=${fetchedAt}` : '',
    'evidenceTier=linked_news_evidence',
    'limitation=news_clue_not_official_fact',
    headlines,
  ].filter(Boolean).join(' / ')
}

function rows(payload: Record<string, unknown>, key = 'rows'): Array<Record<string, unknown>> {
  const value = payload[key]
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const decoded = JSON.parse(trimmed) as unknown
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => value && !seen.has(value) && !!seen.add(value))
}

function compact(value: string, maxLength: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 1)}...` : oneLine
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
