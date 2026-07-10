import { useState, useEffect } from 'react'
import { CalendarTab, CheckboxField, GeneralTab, KeyValueEditor, NumberField, Section, SelectField, TextField } from './SettingsPanelShared'
import { normalizeMode, type LanguageMode, useLanguageStore, useT } from '../store/useLanguageStore'

interface SettingsProps {
  onClose: () => void
}

interface ModelConfig {
  id: string
  name?: string
  provider: 'openai' | 'anthropic'
  baseURL: string
  endpoint?: string
  apiKey: string
  model: string
  maxTokens?: number
  contextWindow?: number
  effort?: 'low' | 'medium' | 'high'
  extraHeaders?: Record<string, string>
  capabilities?: { vision?: boolean; audio?: boolean }
  isDefault?: boolean
}

interface ConfigData {
  models: ModelConfig[]
  agentDepthLimit: number
  toolTimeout: number
  chatSkipPermissions: boolean
  systemPrompt: string
  workspacePath: string
  autoSaveSession: boolean
  language: LanguageMode
  apiKeys: Record<string, string>
  tdxServers: Array<{ host: string; port: number; name: string }>
}

const DEFAULTS: ConfigData = {
  models: [],
  agentDepthLimit: 0,
  toolTimeout: 120000,
  chatSkipPermissions: true,
  systemPrompt: '',
  workspacePath: '',
  autoSaveSession: true,
  language: 'system',
  apiKeys: {},
  tdxServers: [],
}

const KNOWN_API_KEYS: Array<{
  key: string
  labelKey:
    | 'tushareProToken'
    | 'windAifinMarketApiKey'
    | 'braveSearchApiKey'
    | 'tavilySearchApiKey'
    | 'fredApiKeyName'
    | 'beaApiKeyName'
    | 'eiaApiKeyName'
    | 'xueqiuCookieLabel'
    | 'xueqiuPortfolioIds'
  hint?: string
  hintKey?: 'thousandPerMonthFree' | 'browserDevTools'
}> = [
  { key: 'TUSHARE_TOKEN', labelKey: 'tushareProToken', hint: 'tushare.pro' },
  { key: 'WIND_API_KEY', labelKey: 'windAifinMarketApiKey', hint: 'aifinmarket.wind.com.cn' },
  { key: 'BRAVE_SEARCH_KEY', labelKey: 'braveSearchApiKey', hintKey: 'thousandPerMonthFree' },
  { key: 'TAVILY_API_KEY', labelKey: 'tavilySearchApiKey', hintKey: 'thousandPerMonthFree' },
  { key: 'FRED_API_KEY', labelKey: 'fredApiKeyName', hint: 'fred.stlouisfed.org' },
  { key: 'BEA_API_KEY', labelKey: 'beaApiKeyName', hint: 'apps.bea.gov' },
  { key: 'EIA_API_KEY', labelKey: 'eiaApiKeyName', hint: 'eia.gov/opendata' },
  { key: 'XQ_COOKIE', labelKey: 'xueqiuCookieLabel', hintKey: 'browserDevTools' },
  { key: 'XQ_PORTFOLIO', labelKey: 'xueqiuPortfolioIds', hint: 'finasimu,finhsimu,finamsim' },
]
const HIDDEN_API_KEY_PREFIXES = ['WIND_DAILY_']

type Tab = 'llm' | 'agent' | 'finance' | 'calendar' | 'general'

export default function SettingsPanel({ onClose }: SettingsProps) {
  const t = useT()
  const setLanguageMode = useLanguageStore((s) => s.setMode)
  const [config, setConfig] = useState<ConfigData>({ ...DEFAULTS })
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<Tab>('llm')
  const [showSecrets, setShowSecrets] = useState(false)

  useEffect(() => {
    window.agent?.getConfig().then((cfg: unknown) => {
      const c = cfg as ConfigData
      if (c) setConfig({ ...DEFAULTS, ...c, language: normalizeMode(c.language), models: c.models ?? DEFAULTS.models, apiKeys: c.apiKeys ?? {}, tdxServers: c.tdxServers ?? [] })
    })
  }, [])

  const handleSave = async () => {
    await window.agent?.setConfig(config)
    setLanguageMode(normalizeMode(config.language))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const update = (key: keyof ConfigData, value: unknown) => {
    setConfig({ ...config, [key]: value })
    if (key === 'language') setLanguageMode(normalizeMode(value))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-9 border-b border-gray-100 px-3 flex items-center justify-between shrink-0">
        <span className="text-xs text-gray-500 font-medium">{t('settings')}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSecrets(!showSecrets)} className={`text-xs px-1.5 py-0.5 rounded ${showSecrets ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
            {showSecrets ? t('keysVisible') : t('keysHidden')}
          </button>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100">
            {t('close')}
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-100 shrink-0">
        {(['llm', 'agent', 'finance', 'calendar', 'general'] as const).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2 text-xs font-medium border-b-2 ${
              tab === tabKey ? 'border-blue-500 text-gray-700' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {{ llm: t('tabLlm'), agent: t('tabAgent'), finance: t('tabFinance'), calendar: t('tabCalendar'), general: t('tabGeneral') }[tabKey]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'llm' && <LLMTab config={config} update={update} setConfig={setConfig} showSecrets={showSecrets} />}
        {tab === 'agent' && <AgentTab config={config} update={update} />}
        {tab === 'finance' && <FinanceTab config={config} update={update} setConfig={setConfig} showSecrets={showSecrets} />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'general' && <GeneralTab config={config} update={update} />}

        <div className="pt-3 border-t border-gray-100 flex items-center gap-3">
          <button onClick={handleSave} className="px-4 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">
            {t('saveApply')}
          </button>
          {saved && <span className="text-xs text-green-500">{t('saved')}</span>}
        </div>
      </div>
    </div>
  )
}

// --- Tab Components ---

function LLMTab({ config, update, setConfig, showSecrets }: { config: ConfigData; update: (k: keyof ConfigData, v: unknown) => void; setConfig: (c: ConfigData) => void; showSecrets: boolean }) {
  const t = useT()
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const models = config.models

  const updateModel = (idx: number, key: keyof ModelConfig, value: unknown) => {
    const updated = models.map((mod, i) => i === idx ? { ...mod, [key]: value } : mod)
    update('models', updated)
  }

  const userAgent = (headers?: Record<string, string>) =>
    Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'user-agent')?.[1] ?? ''

  const otherHeaders = (headers?: Record<string, string>) =>
    Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== 'user-agent'))

  const updateUserAgent = (idx: number, value: string) => {
    const headers = otherHeaders(models[idx].extraHeaders)
    if (value.trim()) headers['User-Agent'] = value
    updateModel(idx, 'extraHeaders', headers)
  }

  const addModel = () => {
    const id = `model-${Date.now()}`
    const newModel: ModelConfig = { id, provider: 'openai', baseURL: '', apiKey: '', model: '', capabilities: {} }
    update('models', [...models, newModel])
    setExpandedIdx(models.length)
  }

  const removeModel = (idx: number) => {
    if (models.length <= 1) return
    const updated = models.filter((_, i) => i !== idx)
    update('models', updated)
    setExpandedIdx(null)
  }

  const setDefault = (idx: number) => {
    const updated = models.map((mod, i) => ({ ...mod, isDefault: i === idx }))
    update('models', updated)
  }

  // Collapse all on save (parent calls handleSave which triggers re-render)
  const toggleExpand = (idx: number) => {
    setExpandedIdx(expandedIdx === idx ? null : idx)
  }

  return (
    <div className="space-y-2">
      {models.map((m, i) => (
        <div key={m.id} className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleExpand(i)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">{m.name || m.model || t('unnamed')}</span>
              {m.isDefault && <span className="text-[10px] text-blue-500 bg-blue-50 px-1 rounded">{t('defaultTag')}</span>}
            </div>
            <span className="text-gray-400">{expandedIdx === i ? '▾' : '▸'}</span>
          </button>

          {expandedIdx === i && (
            <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
              <TextField label={t('nameLabel')} value={m.name ?? ''} onChange={(v) => updateModel(i, 'name', v)} placeholder={t('mainVisionFastExample')} />
              <SelectField label={t('providerLabel')} value={m.provider} onChange={(v) => {
                const provider = v as 'openai' | 'anthropic'
                const updated = models.map((mod, j) => j === i ? {
                  ...mod, provider, baseURL: '',
                  model: provider === 'anthropic' ? '' : '',
                  contextWindow: provider === 'anthropic' ? 200000 : 128000,
                } : mod)
                update('models', updated)
              }} options={[
                { value: 'openai', label: t('openaiCompatible') },
                { value: 'anthropic', label: t('anthropic') },
              ]} />
              <TextField label={t('baseUrl')} value={m.baseURL} onChange={(v) => updateModel(i, 'baseURL', v)}
                placeholder={m.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'} />
              <TextField label={t('endpointLabel')} value={m.endpoint ?? ''} onChange={(v) => updateModel(i, 'endpoint', v)}
                placeholder={m.provider === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'} />
              <TextField label={t('apiKeyLabel')} value={m.apiKey} onChange={(v) => updateModel(i, 'apiKey', v)} type="password" showSecrets={showSecrets} />
              <TextField label={t('modelLabel')} value={m.model} onChange={(v) => updateModel(i, 'model', v)} />
              <TextField label={t('userAgent')} value={userAgent(m.extraHeaders)} onChange={(v) => updateUserAgent(i, v)} />
              <NumberField label={t('maxTokensLabel')} value={m.maxTokens ?? 16384} onChange={(v) => updateModel(i, 'maxTokens', v)} />
              <NumberField label={t('contextWindowLabel')} value={m.contextWindow ?? 128000} onChange={(v) => updateModel(i, 'contextWindow', v)} />

              {m.provider === 'anthropic' && (
                <SelectField label={t('thinkingLabelSetting')} value={m.effort ?? ''} onChange={(v) => updateModel(i, 'effort', v || undefined)} options={[
                  { value: '', label: t('off') },
                  { value: 'low', label: t('low') },
                  { value: 'medium', label: t('medium') },
                  { value: 'high', label: t('high') },
                ]} />
              )}

              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">{t('capabilities')}</p>
                <CheckboxField label={t('vision')} checked={m.capabilities?.vision ?? false} onChange={(v) => updateModel(i, 'capabilities', { ...m.capabilities, vision: v })} />
                <CheckboxField label={t('audio')} checked={m.capabilities?.audio ?? false} onChange={(v) => updateModel(i, 'capabilities', { ...m.capabilities, audio: v })} />
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">{t('extraHeaders')}</p>
                <KeyValueEditor
                  entries={otherHeaders(m.extraHeaders)}
                  onChange={(headers) => {
                    const value = userAgent(m.extraHeaders)
                    updateModel(i, 'extraHeaders', value ? { ...headers, 'User-Agent': value } : headers)
                  }}
                  keyPlaceholder={t('headerName')}
                  valuePlaceholder={t('headerValue')}
                />
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                {!m.isDefault && (
                  <button onClick={() => setDefault(i)} className="text-xs text-blue-500 hover:text-blue-700">{t('setAsDefault')}</button>
                )}
                {models.length > 1 && (
                  <button onClick={() => removeModel(i)} className="text-xs text-red-400 hover:text-red-600">{t('remove')}</button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      <button onClick={addModel} className="w-full py-2 text-xs text-blue-500 hover:text-blue-700 border border-dashed border-gray-200 rounded-lg hover:border-blue-300">
        + {t('addModel')}
      </button>
    </div>
  )
}

function AgentTab({ config, update }: { config: ConfigData; update: (k: keyof ConfigData, v: unknown) => void }) {
  const t = useT()
  return (
    <div className="space-y-4">
      <Section title={t('agentLoop')}>
        <NumberField label={t('depthLimitUnlimited')} value={config.agentDepthLimit} onChange={(v) => update('agentDepthLimit', v)} />
        <NumberField label={t('toolTimeoutMs')} value={config.toolTimeout} onChange={(v) => update('toolTimeout', v)} />
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={config.chatSkipPermissions}
            onChange={(e) => update('chatSkipPermissions', e.target.checked)}
          />
          {t('skipChatToolPermissions')}
        </label>
      </Section>
      <Section title={t('systemPromptOverride')}>
        <label className="text-xs text-gray-500">{t('customSystemPromptHint')}</label>
        <textarea
          value={config.systemPrompt}
          onChange={(e) => update('systemPrompt', e.target.value)}
          rows={6}
          placeholder={t('systemPromptPlaceholder')}
          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400 resize-y"
        />
      </Section>
    </div>
  )
}

function FinanceTab({ config, update, setConfig, showSecrets }: { config: ConfigData; update: (k: keyof ConfigData, v: unknown) => void; setConfig: (c: ConfigData) => void; showSecrets: boolean }) {
  const t = useT()
  const [newServer, setNewServer] = useState('')
  const updateApiKey = (key: string, value: string) => {
    const keys = { ...config.apiKeys }
    if (value) keys[key] = value
    else delete keys[key]
    update('apiKeys', keys)
  }

  const addServers = () => {
    const lines = newServer.split('\n').map((l) => l.trim()).filter(Boolean)
    const servers = [...config.tdxServers]
    for (const line of lines) {
      const [host, portStr] = line.split(':')
      const port = portStr ? Number(portStr) : 7709
      if (host && !servers.some((s) => s.host === host && s.port === port)) {
        servers.push({ host, port, name: '' })
      }
    }
    update('tdxServers', servers)
    setNewServer('')
  }

  return (
    <div className="space-y-4">
      <Section title={t('apiKeys')}>
        {KNOWN_API_KEYS.map(({ key, labelKey, hint, hintKey }) => (
          <TextField
            key={key}
            label={t(labelKey)}
            value={config.apiKeys[key] ?? ''}
            onChange={(v) => updateApiKey(key, v)}
            type="password"
            showSecrets={showSecrets}
            placeholder={hintKey ? t(hintKey) : hint}
          />
        ))}
        <p className="text-xs text-gray-400 mt-1">{t('customKeys')}</p>
        <KeyValueEditor
          entries={Object.fromEntries(
            Object.entries(config.apiKeys).filter(
              ([key]) => !KNOWN_API_KEYS.some((apiKey) => apiKey.key === key) && !HIDDEN_API_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
            )
          )}
          onChange={(custom) => {
            const known = Object.fromEntries(
              KNOWN_API_KEYS.map(({ key }) => [key, config.apiKeys[key]]).filter(([, v]) => v)
            )
            const hidden = Object.fromEntries(
              Object.entries(config.apiKeys).filter(
                ([key, value]) => HIDDEN_API_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) && value
              )
            )
            update('apiKeys', { ...known, ...hidden, ...custom })
          }}
          keyPlaceholder={t('keyNamePlaceholder')}
          valuePlaceholder={t('keyValuePlaceholder')}
        />
      </Section>

      <Section title={t('tdxServers')}>
        {config.tdxServers.length > 0 && (
          <div className="space-y-1 mb-2">
            {config.tdxServers.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className="flex-1 text-gray-600">{s.host}:{s.port}{s.name ? ` (${s.name})` : ''}</span>
                <button
                  onClick={() => update('tdxServers', config.tdxServers.filter((_, j) => j !== i))}
                  className="text-gray-300 hover:text-red-400"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={newServer}
          onChange={(e) => setNewServer(e.target.value)}
          rows={3}
          placeholder={`${t('addServersPerLine')}\n110.41.147.114\n119.97.164.35:7709`}
          className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400 resize-y"
        />
        <button onClick={addServers} disabled={!newServer.trim()}
          className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300 mt-1">
          {t('addServers')}
        </button>
      </Section>
    </div>
  )
}
