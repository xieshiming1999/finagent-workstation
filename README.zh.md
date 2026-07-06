# FinAgent Workstation

FinAgent Workstation 是一个Electron / React 金融工作台，包含 TypeScript agent runtime、本地数据存储、provider provenance、仪表盘、策略工作流和模拟交易边界。

## 能力概览

- 桌面 agent runtime：chat agent、event agent、session、memory、工具执行、permission gate、workflow automation hook、dashboard/WebView 工具，以及重启后可诊断的 evidence。
- 金融数据层：local-first DataStore、受治理 provider interface、sidecar-backed public provider、live probe、provider matrix、API Health、source time 与 fetch time 分离和 typed readback。
- Provider governance：Wind、Tushare、TDX/gotdx、EastMoney、AkShare、Sina、Tencent、Yahoo/yfinance、搜索、宏观和研究来源都通过显式 capability 使用，而不是匿名 fallback。
- 分析层：市场概览、股票/基金研究、宏观研究、新闻/搜索上下文、风险提示、source-health evidence，以及生成式报告和工作台面板。
- 策略与回测：内置策略库、custom StrategySpec validation、backtest execution、saved strategy lifecycle、rerun evidence、portfolio-style comparison，以及 monitor/watchlist handoff。
- Workflow surface：Data Manager、API Health、Macro Research、Strategy Library、watchlist、dashboard、模拟交易、生成式 WebView report 和 evidence-first workflow test。

## 可以询问什么

- 根据可用的本地数据或已配置的数据源，今天 A 股市场的主要驱动因素是什么，我需要关注哪些风险？
- 请使用最新可用的价格和基本面分析 600519，并说明数据来源和新鲜度。
- 请筛选盈利能力较好且估值合理的 A 股候选，并说明数据覆盖和主要风险。

## 快速启动

### gotdx 运行环境

仓库包含预编译的 macOS arm64 `sidecar/gotdx/gotdx-server`。在匹配的平台上，`pnpm dev` 会直接启动该二进制文件，普通源码启动不需要 Go。其他操作系统或 CPU 架构，以及需要重新构建 sidecar 的开发者，必须安装 `sidecar/gotdx/go.mod` 声明的 Go 版本并运行 `./scripts/build_gotdx.sh`。构建使用 `-trimpath`，避免在二进制文件中嵌入构建机器的源码路径。

安装依赖：

```bash
pnpm install --frozen-lockfile
```

运行应用：

```bash
pnpm dev
```

## 运行时设置

agent 执行真实 workflow 前，需要先配置运行时设置。请通过应用设置界面或应用创建的运行时配置目录完成配置，不要把本地凭证提交进仓库。

最小模型设置包括：

- LLM provider、base URL、model 和 API key。
- 推荐默认使用具备视觉能力的模型，因为常规 agent workflow 可能需要理解 UI、截图、dashboard 或视觉证据。纯文本模型只适合不检查图像的 text-only smoke test 或纯文本 workflow。
- 当模型 provider 要求时，配置可选的 LLM HTTP user-agent header。

金融数据设置包括：

- 仅为需要使用的 provider 配置凭证。对个人研究型金融工作台来说，最困难的通常不是 LLM 本身，而是数据：如何取得数据、验证 provider 是否返回了预期 schema、区分 source time 和 fetch time，并在再次访问外部 provider 前优先复用已验证的本地数据。
- 数据源选项，例如 Wind、Tushare、搜索 provider、雪球模拟交易、yfinance / Yahoo Finance、TradingView 和 sidecar-backed public providers。
- Wind / AIFinMarket：如已具备 Wind AIFinMarket 访问权限，配置 `WIND_API_KEY`。它适合专业授权数据、宏观序列、文档和高级金融事实；额度、权限和失败分类应在 API health 中可见。
- Tushare：如需要支持范围内的 A 股结构化参考数据，配置从 Tushare 账户获取的 `TUSHARE_TOKEN`。部分财报或基金端点需要额外权限；没有权限或已经禁用的端点不应作为正常 workflow 暴露给 agent。
- AkShare / EastMoney / Sina / Tencent 公开数据：适合 A 股、基金、市场结构、新闻和排名数据。它们应通过受治理 interface 和 probe 使用，不应作为匿名 fallback blob。
- yfinance / Yahoo Finance：通过 Python sidecar 和 typed readback table 支持全球标的、期权、公司行动、新闻和跨市场上下文，通常需要全局网络访问或可用代理。
- 搜索 provider：只配置实际使用的搜索引擎。搜索结果适合研究上下文和来源发现，不应直接等同于 canonical market-data table。
- 雪球模拟交易：只为模拟交易验证配置 cookie/session。它应与真实券商执行分离，cookie 应在源码外刷新和保存。
- TradingView：在网络可用时作为图表和视觉增强层使用；它不是可复用数据的 canonical storage source。
- 当本地网络需要时，配置可选代理。
- 对依赖海外网站的 provider，需要全局网络访问或可用代理，尤其是 yfinance / Yahoo Finance 和 TradingView。
- 用于 session、memory、generated dashboards、local cache、provider evidence、logs 和 user-created artifacts 的运行时数据目录。

数据源对比：

| 来源组 | 最适合用途 | 主要边界 | Provenance 处理 |
|---|---|---|---|
| 本地读回 / SQLite | 复用已验证数据、dashboard、report、strategy rerun 和类离线连续性 | 只有 freshness 和 coverage 满足 workflow 时才有效 | 优先使用；展示 cache status、source time、fetch time、provider 和 schema/table。 |
| TDX / gotdx | A 股 quote、K-line、指数、tick、逐笔和市场结构数据 | 依赖本地 gotdx/runtime health；接口编码与 schema 强相关 | 持久化已注册 schema，并在 API Health 分类 runtime 或 transport failure。 |
| EastMoney / AkShare | A 股、基金、板块、热榜、新闻、排名、资金流和市场结构公开数据 | sidecar/route health 与 wrapper 行为可能变化 | 通过 provider-specific adapter 归一化；区分 invalid-parameter 与 transport failure。 |
| Sina / Tencent | 额外公开 A 股 quote/K-line/ranking 覆盖和 fallback 多样性 | 公开 endpoint 有选择性，不能假设完整覆盖 | 只注册已验证 capability，unsupported row 不进入正常 routing。 |
| Wind / AIFinMarket | 授权专业数据、宏观、基本面、文档和高级金融数据 | 受 credential、quota 和 permission 约束 | 优先 cache/readback；live refresh 前展示额度、权限和凭证状态。 |
| Tushare Pro | 当前 token 有权限的 A 股结构化参考数据 | endpoint 权限随账号变化 | 禁用 unsupported endpoint，权限失败后避免反复重试。 |
| yfinance / Yahoo Finance | 全球标的、跨市场上下文、profile、options、actions、holders 和 news | 需要 Python sidecar 与全局网络或代理 | 持久化 typed global dataset；不替代中国 A 股主 provider。 |
| 搜索、宏观和研究页面 | 叙事解释、宏观归因、事件上下文和来源发现 | 不自动等同于 canonical market data | 在支持时记录 source/date/hash；只有稳定 schema 才提升为可复用表。 |

凭证与访问方式表：

| 数据源 | 是否需要 key | 获取 / 配置位置 | 主要用途 |
|---|---|---|---|
| TDX / gotdx 公开行情 | 不需要 API key | 本地 gotdx sidecar / runtime path | A 股 quote、K-line、指数和市场结构路径。 |
| EastMoney 公开数据 | 不需要 API key | 公开 EastMoney route | A 股、ETF、板块、热榜、资金流、涨跌停池等公开数据。 |
| AkShare 公开 wrapper | 不需要 API key | Python sidecar 并安装 AkShare | 兼容路径；仍需要 sidecar health 和 schema validation。 |
| Sina 公开金融数据 | 不需要 API key | 通过受治理 provider path 访问公开 Sina finance route | 经 probe 验证后的 A 股公开数据。 |
| Tencent 公开金融数据 | 不需要 API key | 通过受治理 provider path 访问 Tencent/proxy.finance.qq.com route | 经 probe 验证后的 quote/K-line/ranking 类公开数据。 |
| Wind / AIFinMarket | `WIND_API_KEY` | Wind AIFinMarket / Wind 账号或门户 | 专业数据、宏观、基本面、文档和高级金融数据；受额度和权限限制。 |
| Tushare Pro | `TUSHARE_TOKEN` | Tushare 账号 -> 个人中心 -> 账号 TOKEN | A 股结构化参考数据；不同账号的 endpoint 权限不同。 |
| Yahoo Finance / yfinance-style 全球数据 | 本应用不需要 API key | 公开 Yahoo/yfinance-compatible route；workstation 通过 Python sidecar | 全球 quote/history/research/options/actions；通常需要全局网络或代理。 |
| TradingView 图表层 | 本应用不需要 API key | Web 访问 / embedded chart resources | 图表视觉增强，不是 canonical persisted data。 |
| Brave Search | `BRAVE_SEARCH_KEY` | Brave Search API dashboard | 研究和来源发现，不是 canonical market data。 |
| Tavily Search | `TAVILY_API_KEY` | Tavily Platform dashboard | 研究、来源发现和抽取，不是 canonical market data。 |
| FRED 宏观数据 | `FRED_API_KEY` | FRED 账号 API key 页面 | 美国官方宏观和利率序列。 |
| BLS 公开宏观数据 | 当前实现不需要 API key | BLS public API / public releases | 美国就业和通胀证据；仍受访问限制和源可用性影响。 |
| BEA 宏观数据 | `BEA_API_KEY` 或 `~/.fin_electron/bea.txt` fallback | BEA API signup | 美国国民账户和增长证据。 |
| EIA 能源数据 | `EIA_API_KEY` | EIA Open Data API registration | 能源库存和商品宏观证据。 |
| 雪球模拟交易 | `XQ_COOKIE`；可选 `XQ_PORTFOLIO` | 已登录雪球浏览器 session 和模拟组合 id/name | 只用于模拟交易验证；必须与真实券商执行分离。 |
| 公开宏观 / 研究页面 | 通常不需要 API key | 官方/公开页面；有时需要浏览器或人工验证 | 研究叙事和归因证据，直到被提升为受治理 schema。 |

服务依赖包括：

- 本地开发需要 Electron、Node.js 和 pnpm。
- sidecar-backed provider 可能需要 Python、本地 sidecar 启动或 provider-specific runtime path。
- 外部金融 provider 可能需要网络、凭证、额度、cookie、sidecar 或 provider-specific runtime path。
- 缺少凭证应只阻断对应的受限 provider 路径；本地读回和公共数据源工作流仍应可用。

会话、仪表盘、生成报告、日志、缓存、memory、cookie 和 API key 等运行时数据应存放在仓库外部。

## 设计指南

设计指南是源码合同的一部分，并随对应代码领域出现而加入。新增或实质修改设计指南时，应在同一个源码变更 commit 中更新 `README.md` 和 `README.zh.md`，使 README 描述该历史节点的代码状态。

英文：

- `docs/design/agent/agent-design-guide.md`
- `docs/design/data-provenance/data-provenance-design-guide.md`
- `docs/design/strategy-provenance/strategy-provenance-design-guide.md`
- `docs/design/workflow-phase/workflow-phase-design-guide.md`

中文：

- `docs/design/agent/agent-design-guide.zh.md`
- `docs/design/data-provenance/data-provenance-design-guide.zh.md`
- `docs/design/strategy-provenance/strategy-provenance-design-guide.zh.md`
- `docs/design/workflow-phase/workflow-phase-design-guide.zh.md`

## 开发

TypeScript 和测试验证：

```bash
pnpm exec tsc --noEmit --pretty false
pnpm test
```

构建：

```bash
pnpm build
```

## 仓库结构

```text
assets/ Bundled skills、dashboards、schema assets 和 runtime prompts
docs/design/ 中英双语设计指南，随对应代码领域出现而加入
scripts/ Provider audits、probes、maintenance 和 workflow helpers
sidecar/ 可选本地 provider sidecar code
src/ Electron main process、TypeScript agent runtime 和 React UI
test/ Unit 和 workflow-oriented regression tests
```

## 安全边界

本项目用于研究、教育和工作流辅助，不提供投资建议。交易相关工作流必须区分模拟和真实券商路径，对外部副作用要求明确审批，并记录每个决策使用的 evidence。

不要提交 API key、cookie、token、本地代理设置、运行时 session 或生成数据。

## License

Apache License 2.0. See `LICENSE`.
