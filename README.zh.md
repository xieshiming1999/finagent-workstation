# FinAgent Workstation

FinAgent Workstation 是一个Electron / React 金融工作台，包含 TypeScript agent runtime、本地数据存储、provider provenance、仪表盘、策略工作流和模拟交易边界。

## 快速启动

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

- 仅为需要使用的 provider 配置凭证。
- 数据源选项，例如 Wind、Tushare、搜索 provider、雪球模拟交易、yfinance / Yahoo Finance 和 TradingView。
- 当本地网络需要时，配置可选代理。
- 对依赖海外网站的 provider，需要全局网络访问或可用代理，尤其是 yfinance / Yahoo Finance 和 TradingView。
- 用于 session、memory、generated dashboards、local cache、provider evidence、logs 和 user-created artifacts 的运行时数据目录。

服务依赖包括：

- 本地开发需要 Electron、Node.js 和 pnpm。
- sidecar-backed provider 可能需要 Python、本地 sidecar 启动或 provider-specific runtime path。
- 外部金融 provider 可能需要网络、凭证、额度、cookie、sidecar 或 provider-specific runtime path。
- 缺少凭证应只阻断对应的受限 provider 路径；本地读回和公共数据源工作流仍应可用。

会话、仪表盘、生成报告、日志、缓存、memory、cookie 和 API key 等运行时数据应存放在仓库外部。

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
