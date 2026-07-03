import { runtimeText } from './runtime-language'

export function goalHelpCopy(): string {
  return runtimeText(
    `Goal - Autonomous Multi-Turn Loop

Commands:
  /goal <text>                              Set a goal and start working
  /goal status                              Show current goal progress
  /goal pause                               Pause the goal loop
  /goal resume                              Resume (resets turn budget)
  /goal clear                               Abandon the goal
  /goal help                                Show this help

Examples:
  /goal Analyze Kweichow Moutai's latest earnings and produce an analysis report
  /goal Analyze AAPL, MSFT, GOOG earnings and compare profitability
  /goal Read plans/example_goal_plan.md and implement it

Long-running goals should point at a concrete artifact, not only chat context.
Prefer: "Read <plan-file> and implement it." Avoid vague text such as "above
plan" unless the command can snapshot recent conversation into the goal.

The agent works autonomously turn by turn. After each turn, a judge
evaluates whether the goal is complete. The loop continues until:
  - Goal is achieved (judge says done)
  - Goal is blocked and needs input or an external change
  - Turn budget exhausted (default 20, marks budget-limited)
  - You pause or clear the goal

Side effects:
  - /goal writes goal state in the runtime memory/session area.
  - It may continue across turns and trigger normal tools according to the
    active app, skills, permissions, and goal text.
  - Real trading, destructive operations, missing credentials, and incompatible
    schema changes must stop for explicit confirmation or user input.

Use /subgoal to add criteria mid-loop.`,
    `目标 - 自主多轮循环

命令:
  /goal <text>                              设置目标并开始执行
  /goal status                              查看当前目标进度
  /goal pause                               暂停目标循环
  /goal resume                              继续执行（重置回合预算）
  /goal clear                               放弃当前目标
  /goal help                                显示帮助

示例:
  /goal 分析贵州茅台最新财报并输出分析报告
  /goal 对比 AAPL、MSFT、GOOG 的盈利能力并总结差异
  /goal Read plans/example_goal_plan.md and implement it

长任务应引用明确的计划 artifact，而不是只依赖聊天上下文。
推荐写法: "Read <plan-file> and implement it." 如果只写"上面的计划"，
命令需要把最近对话快照写入 goal，否则不同 agent/重启后可能缺上下文。

Agent 会逐回合自主工作。每一回合结束后，裁判会判断目标是否完成。
循环会在以下情况停止:
  - 目标完成（裁判判定完成）
  - 目标受阻，需要输入或外部状态变化
  - 回合预算耗尽（默认 20，标记为预算受限）
  - 你手动暂停或清除目标

副作用:
  - /goal 会把目标状态写入运行时 memory/session 区域。
  - 它可能跨回合继续执行，并按当前 app、skills、权限和目标文本触发正常工具。
  - 真实交易、破坏性操作、缺失凭证或不兼容迁移必须停下等待明确确认或用户输入。

可使用 /subgoal 在执行中途补充附加条件。`,
  )
}

export function subgoalHelpCopy(): string {
  return runtimeText(
    `Subgoal - Add Criteria to Active Goal

Commands:
  /subgoal <text>                           Add a criterion
  /subgoal remove <N>                       Remove criterion by number
  /subgoal clear                            Remove all criteria
  /subgoal list                             List current criteria
  /subgoal help                             Show this help

Subgoals are additional criteria the judge checks alongside the main goal.
All subgoals must be satisfied for the goal to be marked complete.`,
    `子目标 - 为当前目标补充判定条件

命令:
  /subgoal <text>                           添加一条条件
  /subgoal remove <N>                       按编号删除条件
  /subgoal clear                            清空所有条件
  /subgoal list                             查看当前条件
  /subgoal help                             显示帮助

子目标是裁判与主目标一起检查的附加条件。
只有主目标和全部子目标都满足时，目标才会被判定完成。`,
  )
}

export function goalContinuationPrompt(goal: string): string {
  return runtimeText(
    `[Continue goal]\nGoal: ${goal}\n\nKeep moving the goal forward and execute the next concrete step.\nIf you believe the goal is complete, say so clearly and stop.\nIf you are blocked and need user input, say so clearly and stop.`,
    `[继续执行目标]\n目标: ${goal}\n\n继续朝目标推进，执行下一个具体步骤。\n如果你认为目标已完成，请明确说明并停止。\n如果被阻塞需要用户输入，请明确说明并停止。`,
  )
}

export function goalContinuationPromptWithSubgoals(goal: string, subgoalsBlock: string): string {
  return runtimeText(
    `[Continue goal]\nGoal: ${goal}\n\nUser-added criteria that must all be satisfied:\n${subgoalsBlock}\n\nKeep moving the goal and all added criteria forward by executing the next concrete step.\nIf the goal and all criteria are complete, say so clearly and stop.\nIf you are blocked and need user input, say so clearly and stop.`,
    `[继续执行目标]\n目标: ${goal}\n\n用户追加的条件（全部须满足）:\n${subgoalsBlock}\n\n继续朝目标及所有追加条件推进，执行下一个具体步骤。\n如果目标和所有条件都已完成，请明确说明并停止。\n如果被阻塞需要用户输入，请明确说明并停止。`,
  )
}

export function recapPromptCopy(): string {
  return runtimeText(
    'The person returned after being away for a while. Summarize the recent conversation context in 1-3 short English sentences: what is being worked on, current progress, and the next step. Do not use the word "user"; describe the task directly. The output must start with "[recap] ".',
    '用户离开了一段时间现在回来了。用 1-3 句简短的中文总结最近的对话上下文：正在做什么、进展到哪里、下一步是什么。不要用"用户"这个词，直接描述任务。输出必须以"[recap] "开头。',
  )
}

export function anthropicContinueCopy(): string {
  return runtimeText('Continue.', '继续。')
}

export const goalCopy = {
  noGoalSet: () => runtimeText('No goal set.', '未设置目标。'),
  goalTextEmpty: () => runtimeText('Goal text cannot be empty.', '目标内容不能为空。'),
  pausedByUser: () => runtimeText('user-paused', '用户暂停'),
  noActiveGoal: () => runtimeText('No active goal.', '当前没有活动目标。'),
  subgoalTextEmpty: () => runtimeText('Subgoal text cannot be empty.', '子目标内容不能为空。'),
  invalidIndex: (count: number) =>
    runtimeText(`Invalid index. Valid range: 1-${count}`, `索引无效。有效范围: 1-${count}`),
  paused: () => runtimeText('⏸ Goal paused. Use /goal resume to continue.', '⏸ 目标已暂停。使用 /goal resume 继续。'),
  noGoalToResume: () => runtimeText('No goal to resume.', '没有可继续的目标。'),
  resumed: () => runtimeText('⊙ Goal resumed.', '⊙ 目标已继续执行。'),
  cleared: () => runtimeText('✗ Goal cleared.', '✗ 目标已清除。'),
  alreadyActive: () => runtimeText(
    'A goal is already active. /goal clear first, or /goal pause then set a new one.',
    '已有活动目标。请先使用 /goal clear，或先 /goal pause 再设置新目标。',
  ),
  goalUpdateFailed: () => runtimeText('Goal update failed', '目标更新失败'),
  usageRemove: () => runtimeText('Usage: /subgoal remove <number>', '用法: /subgoal remove <number>'),
  removedSubgoal: (n: number, removed: string) =>
    runtimeText(`Removed subgoal #${n}: "${removed}"`, `已删除子目标 #${n}: "${removed}"`),
  subgoalUpdateFailed: () => runtimeText('Subgoal update failed', '子目标更新失败'),
  clearedSubgoals: (count: number) =>
    runtimeText(`Cleared ${count} subgoals.`, `已清除 ${count} 条子目标。`),
  noSubgoalsToClear: () => runtimeText('No subgoals to clear.', '没有可清除的子目标。'),
  noSubgoals: () => runtimeText('No subgoals.', '当前没有子目标。'),
  subgoalsList: (count: number, lines: string) =>
    runtimeText(`Subgoals (${count}):\n${lines}`, `子目标 (${count}):\n${lines}`),
  addedSubgoal: (index: number | string, added: string) =>
    runtimeText(`Added subgoal #${index}: "${added}"`, `已添加子目标 #${index}: "${added}"`),
  inactiveReason: () => runtimeText('no active goal', '没有活动中的目标'),
  goalComplete: (used: number, max: number, reason: string) =>
    runtimeText(`✓ Goal complete (${used}/${max} turns): ${reason}`, `✓ 目标完成 (${used}/${max} 轮): ${reason}`),
  goalPaused: (msg: string) =>
    runtimeText(`⏸ Goal paused — ${msg}. /goal resume to continue.`, `⏸ 目标已暂停 — ${msg}。使用 /goal resume 继续。`),
  goalBlocked: (msg: string) =>
    runtimeText(`! Goal blocked — ${msg}. /goal resume after resolving the blocker.`, `! 目标受阻 — ${msg}。解决阻塞后使用 /goal resume 继续。`),
  goalBudgetLimited: (msg: string) =>
    runtimeText(`◷ Goal budget limited — ${msg}. /goal resume to continue.`, `◷ 目标预算受限 — ${msg}。使用 /goal resume 继续。`),
  turnContinuing: (used: number, max: number) =>
    runtimeText(`→ Turn ${used}/${max}, continuing...`, `→ 第 ${used}/${max} 轮，继续执行...`),
  statusLabel: () => runtimeText('Goal', '目标'),
  turnsLabel: () => runtimeText('turns', '轮'),
  elapsedLabel: () => runtimeText('elapsed', '耗时'),
  tokensLabel: () => runtimeText('tokens', 'tokens'),
  subgoalsLabel: () => runtimeText('subgoals', '子目标'),
  statusName: (status: 'active' | 'paused' | 'blocked' | 'budget_limited' | 'done' | 'cleared') => {
    switch (status) {
      case 'active': return runtimeText('active', '进行中')
      case 'paused': return runtimeText('paused', '已暂停')
      case 'blocked': return runtimeText('blocked', '受阻')
      case 'budget_limited': return runtimeText('budget-limited', '预算受限')
      case 'done': return runtimeText('done', '已完成')
      case 'cleared': return runtimeText('cleared', '已清除')
    }
  },
  parseFailurePauseReason: (count: number) =>
    runtimeText(
      `judge returned unparseable results ${count} times in a row`,
      `judge连续${count}次返回不可解析结果`,
    ),
  turnBudgetPauseReason: (used: number, max: number) =>
    runtimeText(
      `turn budget exhausted (${used}/${max})`,
      `turn额度耗尽 (${used}/${max})`,
    ),
}

export const promptBuilderCopy = {
  strategyWinRate: (pct: string) => runtimeText(` win rate ${pct}%`, ` 胜率${pct}%`),
  strategyHeading: () => runtimeText(
    'Available strategies for DataProcess(action: "strategy_execute"):',
    'DataProcess(action: "strategy_execute") 可用策略:',
  ),
  strategyHint: () => runtimeText(
    'Use strategy_execute to run a strategy with full reasoning chain.',
    '使用 strategy_execute 运行策略并获取完整推理链。',
  ),
  fallbackBasePrompt: () => runtimeText(
    'You are a helpful AI assistant. Please communicate in English.',
    '你是一个有帮助的 AI 助手。请用中文交流。',
  ),
}

export const dataProcessCopy = {
  hurstExplanation: (h: string, regime: string) => runtimeText(
    `Hurst Exponent: ${h}\nRegime: ${regime}\n\nH>0.5 = trend-following strategy; H<0.5 = mean-reversion strategy; H≈0.5 = random.`,
    `Hurst Exponent: ${h}\nRegime: ${regime}\n\nH>0.5=趋势跟踪策略; H<0.5=均值回归策略; H≈0.5=随机`,
  ),
  ichimokuBullish: () => runtimeText('bullish (tenkan > kijun)', 'bullish (转换>基准)'),
  ichimokuBearish: () => runtimeText('bearish (tenkan < kijun)', 'bearish (转换<基准)'),
  volumeTrendExpanding: () => runtimeText('expanding', '放量'),
  volumeTrendContracting: () => runtimeText('contracting', '缩量'),
  volumeTrendNormal: () => runtimeText('normal', '正常'),
}

export const portfolioToolCopy = {
  validateAction: () => runtimeText(
    'action is required. Use action="help" for all available actions.',
    '缺少 action。使用 action="help" 查看所有可用操作。',
  ),
  cleared: () => runtimeText('Portfolio cleared.', '组合已清空。'),
  unknownAction: (action: string) =>
    runtimeText(`Unknown action "${action}". Use action="help".`, `未知 action "${action}"。请使用 action="help"。`),
  missingAddFields: () => runtimeText('symbol, shares, costPrice required', '缺少 symbol、shares 或 costPrice。'),
  added: (symbol: string, shares: number, costPrice: number, count: number) =>
    runtimeText(
      `Added: ${symbol} ${shares} shares @ ${costPrice}. Total positions: ${count}.`,
      `已添加: ${symbol} ${shares} 股，成本价 ${costPrice}。当前持仓数: ${count}。`,
    ),
  missingSymbol: () => runtimeText('symbol required', '缺少 symbol。'),
  removed: (symbol: string, count: number) =>
    runtimeText(`Removed: ${symbol}. ${count} position(s) remaining.`, `已移除: ${symbol}。剩余持仓数: ${count}。`),
  missingTradeFields: () =>
    runtimeText('symbol, side(buy/sell), shares, price required', '缺少 symbol、side(buy/sell)、shares 或 price。'),
  invalidALotSize: (shares: number) =>
    runtimeText(
      `A-share orders must use 100-share lots. Current request: ${shares} shares.`,
      `A股必须以100股(手)为单位交易。当前: ${shares}股`,
    ),
  insufficientCash: (needed: string, cash: string) =>
    runtimeText(`Insufficient cash. Needed: ${needed}, available: ${cash}.`, `现金不足。需要: ${needed}, 可用: ${cash}`),
  noPosition: (symbol: string) => runtimeText(`No position found for ${symbol}.`, `没有 ${symbol} 的持仓`),
  insufficientPosition: (holding: number, shares: number) =>
    runtimeText(
      `Insufficient position. Holding: ${holding}, requested to sell: ${shares}.`,
      `持仓不足。持有: ${holding}, 卖出: ${shares}`,
    ),
  tPlusOneBlocked: (symbol: string) =>
    runtimeText(
      `A-share T+1 rule: ${symbol} was bought today and cannot be sold until tomorrow.`,
      `A股T+1限制: ${symbol} 今日买入，明日才能卖出`,
    ),
  invalidSide: () => runtimeText('side must be "buy" or "sell"', 'side 必须是 "buy" 或 "sell"。'),
  tradeOk: (side: string, symbol: string, shares: number, price: number, cash: string) =>
    runtimeText(
      `Trade OK: ${side} ${symbol} ${shares} @ ${price}. Remaining cash: ${cash}.`,
      `交易成功: ${side} ${symbol} ${shares} 股 @ ${price}。剩余现金: ${cash}`,
    ),
  emptyPaperPortfolio: (cash: string) =>
    runtimeText(
      `The paper portfolio is empty. Initial cash: ${cash}. Use trade to buy positions.`,
      `模拟盘为空。初始资金: ${cash}。用 trade 买入股票。`,
    ),
  emptyPortfolio: () => runtimeText('Portfolio is empty.', '组合为空。'),
  concentrationAlert: (symbol: string, weight: number) =>
    runtimeText(
      `⚠ ${symbol}: position weight ${weight}% exceeds the 20% single-name limit.`,
      `⚠ ${symbol}: 仓位${weight}%，超过20%单只上限`,
    ),
  noTradeHistory: () => runtimeText('No trade history.', '暂无交易历史。'),
  helpText: () => runtimeText(`Portfolio actions:

POSITIONS:
  add      — Add position. symbol: "600519", shares: 100, costPrice: 1650
  remove   — Remove position. symbol: "600519"
  snapshot — Current portfolio with P&L

TRADES:
  trade    — Record trade. symbol: "600519", side: "buy"/"sell", shares: 100, price: 1650
  preview_trade — Validate and estimate trade without writing state. symbol, side, shares, price
  history  — Trade history

ANALYSIS:
  risk     — Risk analysis: concentration, stop-loss alerts

MANAGEMENT:
  clear    — Clear all positions and trades
  help     — This help text

MARKETS:
  market: "cn" (A-share, default), "us" (US), "hk" (HK)
  Each market has its own cash pool, commission rules, and currency.
  A-share: 0.03% commission (min 5 CNY), 0.1% stamp duty on sell, T+1, 100-share lots
  HK: 0.1% commission (min 20 HKD), 0.1% stamp duty on sell
  US: zero commission (min 1 USD)`, `Portfolio 操作:

持仓:
  add      — 添加持仓。symbol: "600519", shares: 100, costPrice: 1650
  remove   — 删除持仓。symbol: "600519"
  snapshot — 当前组合与盈亏快照

交易:
  trade    — 记录交易。symbol: "600519", side: "buy"/"sell", shares: 100, price: 1650
  preview_trade — 校验并估算交易，不写入本地组合。需要 symbol、side、shares、price
  history  — 交易历史

分析:
  risk     — 风险分析：集中度、止损提醒

管理:
  clear    — 清空所有持仓和交易
  help     — 显示此帮助

市场:
  market: "cn" (A股，默认), "us" (美股), "hk" (港股)
  每个市场都有独立的资金池、佣金规则和币种。
  A股: 0.03% 佣金（最低 5 元），卖出 0.1% 印花税，T+1，100 股一手
  港股: 0.1% 佣金（最低 20 港币），卖出 0.1% 印花税
  美股: 零佣金（最低 1 美元）`),
}

export const researchToolCopy = {
  sourceLabel: (key: 'eastmoney' | 'sina' | 'baidu' | 'guba' | 'multiNews') => {
    switch (key) {
      case 'eastmoney':
        return runtimeText('EastMoney', '东方财富')
      case 'sina':
        return runtimeText('Sina Finance', '新浪财经')
      case 'baidu':
        return runtimeText('Baidu', '百度')
      case 'guba':
        return runtimeText('EastMoney Guba', '东方财富股吧')
      case 'multiNews':
        return runtimeText('Baidu / EastMoney / Sina', '百度/东方财富/新浪')
    }
  },
  missingAction: () => runtimeText('action is required. Use action="help".', '缺少 action。请使用 action="help"。'),
  unknownAction: (action: string) =>
    runtimeText(`Unknown action "${action}". Use action="help".`, `未知 action "${action}"。请使用 action="help"。`),
  missingSearchQuery: () => runtimeText(
    'query required. Example: Research(action: "search", query: "Kweichow Moutai latest news")',
    '缺少 query。示例: Research(action: "search", query: "贵州茅台 最新消息")',
  ),
  invalidSearchProvider: () => runtimeText(
    'provider must be one of auto, brave, tavily. Example: Research(action: "search", query: "AAPL earnings guidance", provider: "brave")',
    'provider 必须是 auto、brave、tavily 之一。示例: Research(action: "search", query: "AAPL earnings guidance", provider: "brave")',
  ),
  searchKeyMissing: () => runtimeText(
    'No search API key configured. Add BRAVE_SEARCH_KEY or TAVILY_API_KEY in Settings.\nAlternative: use WebView to open Google directly.',
    '未配置搜索 API Key。请在设置中添加 BRAVE_SEARCH_KEY 或 TAVILY_API_KEY。\n替代方案：使用 WebView 直接打开 Google。',
  ),
  searchFailed: (errors: string) => runtimeText(
    `Search failed. ${errors}\nAlternatives: Research(action: "news") for financial news, or open Google in WebView.`,
    `搜索失败。${errors}\n替代方案：使用 Research(action: "news") 获取财经新闻，或在 WebView 中打开 Google。`,
  ),
  missingNewsQuery: () => runtimeText(
    'query required. Example: Research(action: "news", query: "Kweichow Moutai")',
    '缺少 query。示例: Research(action: "news", query: "贵州茅台")',
  ),
  missingSentimentSymbols: () => runtimeText(
    'symbols required. Example: Research(action: "sentiment", symbols: ["AAPL"])',
    '缺少 symbols。示例: Research(action: "sentiment", symbols: ["AAPL"])',
  ),
  sentimentSourceSummary: (gubaLabel: string) => `StockTwits/${gubaLabel}`,
  missingFetchUrl: () => runtimeText(
    'url required. Example: Research(action: "fetch", url: "https://...")',
    '缺少 url。示例: Research(action: "fetch", url: "https://...")',
  ),
  missingFredKey: () => runtimeText(
    'FRED_API_KEY not configured. Set it in Settings, or use Econdb as free alternative.',
    '未配置 FRED_API_KEY。请在设置中配置，或使用 Econdb 作为免费替代方案。',
  ),
  helpText: () => runtimeText(`Research actions:

WEB SEARCH:
  providers — Show search engines and news sources known to this runtime
    Search engines:
      - Brave Search API (paid/monthly-limited key)
      - Tavily Search API (paid/monthly-limited key)

  search — Web search via explicit search engines
    query: "any search query"
    provider: "auto" | "brave" | "tavily" (optional, default auto)
    Returns: title, url, content snippet, provider provenance
    auto mode: round-robin between configured Brave/Tavily providers
    Budget: use only when Wind/local/free finance sources cannot answer; batch related questions into one precise query

FINANCIAL NEWS:
  news — Multi-source financial news (Baidu + EastMoney + Sina)
    query: "Kweichow Moutai" or "AAPL earnings"
    Returns: title, url, source, date (deduplicated)

SOCIAL SENTIMENT:
  sentiment — Social media sentiment analysis
    symbols: ["AAPL", "600519"]
    Sources: StockTwits (US), EastMoney Guba (A-share)
    Returns: bullish/bearish counts and ratio

WEB FETCH:
  fetch — Fetch content from any URL
    url: "https://...", method: "GET"/"POST"
    headers: {}, body: "", maxLength: 50000
    Auto-injects API keys for FRED
    Returns: text content (HTML stripped)

Note: agent can also use WebView to open Google/Bing directly for interactive search.`, `Research 操作:

网页搜索:
  providers — 显示当前 runtime 已知的搜索引擎和新闻源
    搜索引擎:
      - Brave Search API（付费/月度受限密钥）
      - Tavily Search API（付费/月度受限密钥）

  search — 通过显式搜索引擎进行网页搜索
    query: "任意搜索词"
    provider: "auto" | "brave" | "tavily"（可选，默认 auto）
    返回: title、url、content 摘要、provider provenance
    auto 模式: 在已配置的 Brave/Tavily 之间轮询
    预算: 仅在 Wind/本地/免费金融数据无法回答时使用，并把相关问题合并成一次精确查询

财经新闻:
  news — 多来源财经新闻（百度 + 东方财富 + 新浪）
    query: "贵州茅台" 或 "AAPL earnings"
    返回: title、url、source、date（已去重）

社交情绪:
  sentiment — 社交媒体情绪分析
    symbols: ["AAPL", "600519"]
    来源: StockTwits（美股）、东方财富股吧（A股）
    返回: 看多/看空计数与比例

网页抓取:
  fetch — 抓取任意 URL 内容
    url: "https://...", method: "GET"/"POST"
    headers: {}, body: "", maxLength: 50000
    会自动为 FRED 注入 API key
    返回: 文本内容（HTML 已剥离）

  说明: Agent 也可以直接使用 WebView 打开 Google/Bing 做交互式搜索。`),
}

export const dataStoreRemoteCopy = {
  akshareMissingFunc: () => runtimeText(
    'func required for provider diagnostics. Prefer DataStore(action:"provider_discovery", provider:"akshare", query:"spot") to find functions, then DataStore(action:"provider_diagnostic", provider:"akshare", func:"...") for bounded inspection.',
    'provider 诊断缺少 func。请优先使用 DataStore(action:"provider_discovery", provider:"akshare", query:"spot") 查找函数，再用 DataStore(action:"provider_diagnostic", provider:"akshare", func:"...") 做有界检查。',
  ),
  akshareError: (status: number, body: string) => runtimeText(`AkShare error (${status}): ${body}`, `AkShare 错误 (${status}): ${body}`),
  akshareErrorText: (msg: string) => runtimeText(`AkShare error: ${msg}`, `AkShare 错误: ${msg}`),
  akshareCallFailed: (msg: string) => runtimeText(
    `AkShare call failed: ${msg}\nIs the Python sidecar running? (port 19800)`,
    `AkShare 调用失败: ${msg}\nPython sidecar 是否已启动？(port 19800)`,
  ),
  akshareSearchNone: (q: string) => runtimeText(`No AkShare functions matching "${q}".`, `没有匹配 "${q}" 的 AkShare 函数。`),
  akshareSearchSummary: (q: string, count: number, total: number, funcs: string[]) => runtimeText(
    `AkShare functions matching "${q}" (${count} of ${total} total):\n${funcs.join('\n')}`,
    `匹配 "${q}" 的 AkShare 函数（${count}/${total}）:\n${funcs.join('\n')}`,
  ),
  akshareSearchFailed: (msg: string) => runtimeText(`AkShare search failed: ${msg}`, `AkShare 搜索失败: ${msg}`),
  providerDiscoveryFailed: (provider: string, msg: string) => runtimeText(
    `Provider discovery failed for ${provider}: ${msg}`,
    `${provider} provider discovery 失败: ${msg}`,
  ),
  tushareMissingApiName: () => runtimeText(
    'api_name required. Example: DataStore(action: "tushare", api_name: "daily", params: {"ts_code": "600519.SH"})',
    '缺少 api_name。示例: DataStore(action: "tushare", api_name: "daily", params: {"ts_code": "600519.SH"})',
  ),
  tushareKeyMissing: () => runtimeText(
    'KEY_MISSING: TUSHARE_TOKEN is not configured. Configure it before calling Tushare.',
    'KEY_MISSING: 未配置 TUSHARE_TOKEN。调用 Tushare 前请先配置。',
  ),
  tushareRateLimit: (msg: string) => runtimeText(
    `${msg}\nDo not retry immediately. Query local DataStore coverage/query_* first, or wait for the endpoint frequency window.`,
    `${msg}\n不要立即重试。请先查询本地 DataStore coverage/query_*，或等待该接口频率窗口恢复。`,
  ),
  tushareCallFailed: (msg: string) => runtimeText(`Tushare call failed: ${msg}`, `Tushare 调用失败: ${msg}`),
  tdxMissingAction: () => runtimeText(
    'tdx_action required. Available: quote, quotes, kline, kline_advanced, count, finance, stock_list, stock_list_range, volume_profile, quotes_list, top_board, unusual, auction, tick_chart, history_tick_chart, transactions, history_transactions, history_orders, chart_sampling, xdxr, company_categories, company_content, company_info, block, index_info, index_bars, index_momentum, ex/categories, ex/list, ex/quote, ex/quotes, ex/kline, ex/kline2, ex/quotes_list, ex/history_transaction, ex/tick_chart, ex/board_list, ex/table. Note: gotdx index actions are guarded by response validation and should be treated as diagnostics until live contract probes pass; use /api/finance/index/quotes for UI/status quotes.\nExample: DataStore(action: "tdx", tdx_action: "finance", code: "600519")',
    '缺少 tdx_action。可用值: quote, quotes, kline, kline_advanced, count, finance, stock_list, stock_list_range, volume_profile, quotes_list, top_board, unusual, auction, tick_chart, history_tick_chart, transactions, history_transactions, history_orders, chart_sampling, xdxr, company_categories, company_content, company_info, block, index_info, index_bars, index_momentum, ex/categories, ex/list, ex/quote, ex/quotes, ex/kline, ex/kline2, ex/quotes_list, ex/history_transaction, ex/tick_chart, ex/board_list, ex/table。注意: gotdx 指数动作已加入响应校验，在实时合约探测通过前应作为诊断用途；UI/状态栏指数行情请使用 /api/finance/index/quotes。\n示例: DataStore(action: "tdx", tdx_action: "finance", code: "600519")',
  ),
  gotdxUnavailable: () => runtimeText('gotdx sidecar not running. TDX data unavailable.', 'gotdx sidecar 未启动，TDX 数据不可用。'),
  tdxError: (status: number, body: string) => runtimeText(`TDX error (${status}): ${body}`, `TDX 错误 (${status}): ${body}`),
  tdxCallFailed: (msg: string) => runtimeText(`TDX call failed: ${msg}`, `TDX 调用失败: ${msg}`),
  yfinanceMissingFunc: () => runtimeText(
    'func required for provider diagnostics. Prefer requirement-level Yahoo actions such as query_yfinance/yahoo_earnings, or use DataStore(action:"provider_discovery", provider:"yfinance", query:"history") and DataStore(action:"provider_diagnostic", provider:"yfinance", func:"...", symbol:"AAPL") for bounded inspection.',
    'provider 诊断缺少 func。请优先使用 query_yfinance/yahoo_earnings 等需求级 Yahoo 动作，或用 DataStore(action:"provider_discovery", provider:"yfinance", query:"history") 和 DataStore(action:"provider_diagnostic", provider:"yfinance", func:"...", symbol:"AAPL") 做有界检查。',
  ),
  yfinanceMissingSymbol: () => runtimeText(
    'symbol required. Prefer requirement-level Yahoo actions or use DataStore(action:"provider_diagnostic", provider:"yfinance", func:"info", symbol:"AAPL") for bounded inspection.',
    '缺少 symbol。请优先使用需求级 Yahoo 动作，或用 DataStore(action:"provider_diagnostic", provider:"yfinance", func:"info", symbol:"AAPL") 做有界检查。',
  ),
  yfinanceError: (status: number, body: string) => runtimeText(`yfinance error (${status}): ${body}`, `yfinance 错误 (${status}): ${body}`),
  yfinanceErrorText: (msg: string) => runtimeText(`yfinance error: ${msg}`, `yfinance 错误: ${msg}`),
  yfinanceCallFailed: (msg: string) => runtimeText(
    `yfinance call failed: ${msg}\nIs the Python sidecar running? (port 19800)`,
    `yfinance 调用失败: ${msg}\nPython sidecar 是否已启动？(port 19800)`,
  ),
  yfinanceSearchNone: (q: string) => runtimeText(`No yfinance actions matching "${q}".`, `没有匹配 "${q}" 的 yfinance action。`),
  yfinanceSearchSummary: (q: string, count: number, total: number, actions: string[]) => runtimeText(
    `yfinance actions matching "${q}" (${count} of ${total} total):\n${actions.join('\n')}`,
    `匹配 "${q}" 的 yfinance action（${count}/${total}）:\n${actions.join('\n')}`,
  ),
  yfinanceSearchFailed: (msg: string) => runtimeText(`yfinance search failed: ${msg}`, `yfinance 搜索失败: ${msg}`),
  taMissingFunc: () => runtimeText(
    'func required. Use DataStore(action:"technical_indicator", func:"rsi", code:"600519", params: {"length": 14}) for normal TA output, or DataStore(action:"provider_discovery", provider:"ta", query:"rsi") to find indicators.',
    '缺少 func。普通 TA 输出请使用 DataStore(action:"technical_indicator", func:"rsi", code:"600519", params: {"length": 14})，查找指标请用 DataStore(action:"provider_discovery", provider:"ta", query:"rsi")。',
  ),
  taMissingSymbol: () => runtimeText(
    'code/symbol required. Example: DataStore(action: "ta", func: "macd", code: "600519")',
    '缺少 code/symbol。示例: DataStore(action: "ta", func: "macd", code: "600519")',
  ),
  taError: (msg: string) => runtimeText(`TA error: ${msg}`, `TA 错误: ${msg}`),
  taExpectedParams: (msg: string) => runtimeText(`Expected params: ${msg}`, `期望参数: ${msg}`),
  taHint: (msg: string) => runtimeText(msg, msg),
  taCategories: (msg: string) => runtimeText(`Categories: ${msg}`, `分类: ${msg}`),
  taCallFailed: (msg: string) => runtimeText(`TA call failed: ${msg}`, `TA 调用失败: ${msg}`),
  taSearchNone: (q: string) => runtimeText(`No TA indicators matching "${q}".`, `没有匹配 "${q}" 的 TA 指标。`),
  taSearchSummary: (q: string, count: number, total: number, groups: string) => runtimeText(
    `TA indicators matching "${q}" (${count} of ${total}):\n${groups}`,
    `匹配 "${q}" 的 TA 指标（${count}/${total}）:\n${groups}`,
  ),
  taSearchFailed: (msg: string) => runtimeText(`TA search failed: ${msg}`, `TA 搜索失败: ${msg}`),
  backtestError: (msg: string) => runtimeText(`Backtest error: ${msg}`, `回测错误: ${msg}`),
  backtestFailed: (msg: string) => runtimeText(
    `Backtest failed: ${msg}\nIs the Python sidecar running?`,
    `回测失败: ${msg}\nPython sidecar 是否已启动？`,
  ),
  stockScreenerError: (msg: string) => runtimeText(`Screener error: ${msg}`, `选股器错误: ${msg}`),
  stockScreenerSummary: (u: number, p: number, r: number) =>
    runtimeText(`Stock screener: ${u} universe -> ${p} passed -> ${r} returned`, `选股器: ${u} 个标的 -> ${p} 个通过 -> 返回 ${r} 个`),
  fundScreenerError: (msg: string) => runtimeText(`Fund screener error: ${msg}`, `基金筛选错误: ${msg}`),
  fundManagersSummary: (returned: number, total: number) =>
    runtimeText(`Fund managers (${returned} of ${total}):`, `基金经理（${returned}/${total}）:`),
  fundManagerLine: (m: { name: string; company: string; experience: number; total_aum: string | number; best_return: string | number }) =>
    runtimeText(
      `  ${m.name} [${m.company}] exp:${m.experience}y AUM:${m.total_aum}e8 best:${m.best_return}%`,
      `  ${m.name} [${m.company}] 从业:${m.experience}年 管理规模:${m.total_aum}亿 最佳回报:${m.best_return}%`,
    ),
  fundScreenerSummary: (mode: string, u: number, p: number, r: number) =>
    runtimeText(`Fund screener [${mode}]: ${u} -> ${p} passed -> ${r} returned`, `基金筛选 [${mode}]: ${u} -> ${p} 通过 -> 返回 ${r}`),
  fundScreenFailed: (msg: string) => runtimeText(`Fund screen failed: ${msg}`, `基金筛选失败: ${msg}`),
  sidecarPythonOnline: (status: string, version: string) => runtimeText(`Python sidecar: ${status} (v${version})`, `Python sidecar: ${status} (v${version})`),
  sidecarPythonOffline: () => runtimeText('Python sidecar: offline', 'Python sidecar: 离线'),
  akLimiter: (i: string, b: string) => runtimeText(`AkShare limiter: interactive=${i}s, background=${b}s`, `AkShare 限速器: 前台=${i}s, 后台=${b}s`),
  yfLimiter: (i: string, b: string) => runtimeText(`yfinance limiter: interactive=${i}s, background=${b}s`, `yfinance 限速器: 前台=${i}s, 后台=${b}s`),
  limitersUnavailable: () => runtimeText('Rate limiters: unavailable', '限速器: 不可用'),
  tdxSidecarOnline: (std: string, ex: string) => runtimeText(`TDX sidecar: std=${std}, ex=${ex}`, `TDX sidecar: std=${std}, ex=${ex}`),
  tdxSidecarUnconfigured: () => runtimeText('TDX sidecar: not configured', 'TDX sidecar: 未配置'),
  tdxSidecarOffline: () => runtimeText('TDX sidecar: offline', 'TDX sidecar: 离线'),
}

export const watchlistCopy = {
  defaultStockGroup: () => runtimeText('Stock Watchlist', '自选股票'),
  defaultFundGroup: () => runtimeText('Fund Watchlist', '自选基金'),
  entryPrompt: (item: {
    name: string
    symbol: string
    targetEntryPrice: number
    currentPrice: number
    entryCondition?: string
    suggestedWeight?: number
    stopLoss?: number
    targetPrice?: number
  }) =>
    runtimeText(
      `📊 ${item.name} (${item.symbol}) reached the target entry price ${item.targetEntryPrice}. Current price: ${item.currentPrice}.` +
        (item.entryCondition ? ` Entry condition: ${item.entryCondition}` : '') +
        `\nSuggested weight: ${item.suggestedWeight ?? '-' }%. Stop loss: ${item.stopLoss ?? '-'}. Target: ${item.targetPrice ?? '-'}.` +
        '\nExecute the buy?',
      `📊 ${item.name}(${item.symbol}) 达到入场价 ${item.targetEntryPrice}，当前 ${item.currentPrice}。` +
        (item.entryCondition ? `入场条件: ${item.entryCondition}` : '') +
        `\n建议仓位: ${item.suggestedWeight ?? '—'}%，止损: ${item.stopLoss ?? '—'}，目标: ${item.targetPrice ?? '—'}。` +
        '\n是否执行买入?',
    ),
  stopLoss: (item: { name: string; symbol: string; stopLoss: number; currentPrice: number }, pnl: number) =>
    runtimeText(
      `⚠️ ${item.name} (${item.symbol}) hit the stop loss ${item.stopLoss}. Current price: ${item.currentPrice} (${pnl.toFixed(1)}%).`,
      `⚠️ ${item.name}(${item.symbol}) 触及止损 ${item.stopLoss}! 当前 ${item.currentPrice} (${pnl.toFixed(1)}%)`,
    ),
  targetPrice: (item: { name: string; symbol: string; targetPrice: number; currentPrice: number }, pnl: number) =>
    runtimeText(
      `🎯 ${item.name} (${item.symbol}) reached the target price ${item.targetPrice}. Current price: ${item.currentPrice} (${pnl.toFixed(1)}%).`,
      `🎯 ${item.name}(${item.symbol}) 达到目标价 ${item.targetPrice}! 当前 ${item.currentPrice} (${pnl.toFixed(1)}%)`,
    ),
  triggeredCondition: (item: { name: string; symbol: string }, cond: { field: string; op: string; value: number }) =>
    runtimeText(
      `${item.name} (${item.symbol}) triggered condition: ${cond.field} ${cond.op} ${cond.value}`,
      `${item.name}(${item.symbol}) ${cond.field} ${cond.op} ${cond.value} 已触发`,
    ),
}
