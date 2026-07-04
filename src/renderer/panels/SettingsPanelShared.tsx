import { useState, useEffect } from 'react'
import { useT } from '../store/useLanguageStore'

interface ConfigData {
  autoSaveSession: boolean
  workspacePath: string
  language?: 'system' | 'en' | 'zh-CN'
}

export function GeneralTab({ config, update }: { config: ConfigData; update: (k: keyof ConfigData, v: unknown) => void }) {
  const t = useT()
  return (
    <div className="space-y-4">
      <Section title={t('sectionSession')}>
        <CheckboxField label={t('autoSaveSession')} checked={config.autoSaveSession} onChange={(v) => update('autoSaveSession', v)} />
      </Section>
      <Section title={t('sectionPaths')}>
        <SelectField
          label={t('language')}
          value={config.language ?? 'system'}
          onChange={(v) => update('language', v)}
          options={[
            { value: 'system', label: t('languageSystem') },
            { value: 'en', label: t('languageEnglish') },
            { value: 'zh-CN', label: t('languageChinese') },
          ]}
        />
        <div className="text-xs text-gray-400 space-y-1">
          <p>{t('configPath')}: ~/.finagent-workstation/config.json</p>
          <p>{t('sessionsPath')}: ~/.finagent-workstation/sessions/</p>
          <p>{t('dashboardsPath')}: ~/.finagent-workstation/dashboards/</p>
          <p>{t('calendarPath')}: ~/.finagent-workstation/trading_calendar.json</p>
          <p>{t('envOverrideNote')}</p>
        </div>
      </Section>
    </div>
  )
}

export function CalendarTab() {
  const t = useT()
  const [calendar, setCalendar] = useState<{
    dataYear: number | null; lastFetched: string | null; tradingDayCount: number
    tradingDays: string[]; overrides: Record<string, boolean>
  } | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    window.agent?.getCalendar().then((c: any) => { if (c) setCalendar(c) })
  }, [])

  const fetchYear = async () => {
    setFetching(true)
    const result = await window.agent?.fetchCalendar(year) as any
    if (result) setCalendar(result)
    setFetching(false)
  }

  const toggleDay = async (dateStr: string) => {
    if (!calendar) return
    const overrides = { ...calendar.overrides }
    const isCurrentlyTrading = calendar.tradingDays.includes(dateStr)
    const isOverridden = dateStr in overrides

    if (isOverridden) {
      delete overrides[dateStr]
    } else {
      overrides[dateStr] = !isCurrentlyTrading
    }

    const updated = { ...calendar, overrides }
    setCalendar(updated)
    await window.agent?.saveCalendar(updated)
  }

  const tradingDaySet = new Set(calendar?.tradingDays ?? [])

  const isTradingDay = (dateStr: string): boolean | null => {
    if (calendar?.overrides && dateStr in calendar.overrides) return calendar.overrides[dateStr]
    if (tradingDaySet.size > 0) return tradingDaySet.has(dateStr)
    return null
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const days: Array<{ date: number; dateStr: string }> = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({ date: d, dateStr })
  }

  return (
    <div className="space-y-4">
      <Section title={t('tradingCalendarTitle')}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => { if (month === 0) { setMonth(11); setYear(year - 1) } else setMonth(month - 1) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-1">&lt;</button>
          <span className="text-sm text-gray-700 font-medium w-32 text-center">
            {year} / {String(month + 1).padStart(2, '0')}
          </span>
          <button onClick={() => { if (month === 11) { setMonth(0); setYear(year + 1) } else setMonth(month + 1) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-1">&gt;</button>
          <div className="flex-1" />
          <button onClick={fetchYear} disabled={fetching}
            className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300">
            {fetching ? t('fetching') : `${t('fetchYear')} ${year}`}
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
          {[t('weekdaySun'), t('weekdayMon'), t('weekdayTue'), t('weekdayWed'), t('weekdayThu'), t('weekdayFri'), t('weekdaySat')].map((d) => (
            <div key={d} className="text-gray-400 py-1 font-medium">{d}</div>
          ))}
          {Array(firstDayOfWeek).fill(null).map((_, i) => <div key={`e${i}`} />)}
          {days.map(({ date, dateStr }) => {
            const trading = isTradingDay(dateStr)
            const isOverride = calendar?.overrides && dateStr in calendar.overrides
            const isWeekend = new Date(year, month, date).getDay() % 6 === 0
            let bg = 'bg-gray-50'
            let textColor = 'text-gray-400'
            if (trading === true) { bg = 'bg-green-50'; textColor = 'text-green-700' }
            if (trading === false && !isWeekend) { bg = 'bg-red-50'; textColor = 'text-red-400' }
            if (isOverride) { bg = 'bg-amber-50'; textColor = 'text-amber-600' }

            return (
              <button
                key={dateStr}
                onClick={() => toggleDay(dateStr)}
                className={`py-1.5 rounded text-xs ${bg} ${textColor} hover:ring-1 hover:ring-blue-300`}
                title={`${dateStr}${trading ? ` (${t('tradingDayLabel')})` : ` (${t('nonTradingDayLabel')})`}${isOverride ? ` [${t('overrideLabel')}]` : ''}`}
              >
                {date}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
          <span><span className="inline-block w-2 h-2 rounded bg-green-200 mr-1" />{t('tradingDayLabel')}</span>
          <span><span className="inline-block w-2 h-2 rounded bg-gray-200 mr-1" />{t('nonTradingDayLabel')}</span>
          <span><span className="inline-block w-2 h-2 rounded bg-amber-200 mr-1" />{t('overrideLabel')}</span>
        </div>

        {calendar && (
          <div className="text-xs text-gray-400 mt-2 space-y-0.5">
            {calendar.dataYear && <p>{t('dataYearSummary')}: {calendar.dataYear} ({calendar.tradingDayCount} {t('tradingDaysLabel')})</p>}
            {calendar.lastFetched && <p>{t('lastFetchedLabel')}: {new Date(calendar.lastFetched).toLocaleString()}</p>}
          </div>
        )}
      </Section>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-xs font-medium text-gray-700 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

export function TextField({ label, value, onChange, type = 'text', placeholder = '', showSecrets = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; showSecrets?: boolean
}) {
  const isPassword = type === 'password'
  return (
    <div className="flex items-center gap-3">
      <label className="w-32 text-xs text-gray-500 text-right shrink-0">{label}</label>
      <input type={isPassword && !showSecrets ? 'password' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400" />
    </div>
  )
}

export function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-32 text-xs text-gray-500 text-right shrink-0">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400" />
    </div>
  )
}

export function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-32 text-xs text-gray-500 text-right shrink-0">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-32 text-xs text-gray-500 text-right shrink-0">{label}</label>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-gray-300" />
    </div>
  )
}

export function KeyValueEditor({ entries, onChange, keyPlaceholder, valuePlaceholder }: {
  entries: Record<string, string>; onChange: (v: Record<string, string>) => void
  keyPlaceholder: string; valuePlaceholder: string
}) {
  const t = useT()
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const pairs = Object.entries(entries)

  const add = () => {
    if (!newKey.trim()) return
    onChange({ ...entries, [newKey.trim()]: newValue })
    setNewKey('')
    setNewValue('')
    showSaved(newKey.trim())
  }

  const remove = (key: string) => {
    const next = { ...entries }
    delete next[key]
    onChange(next)
  }

  const showSaved = (key: string) => {
    setSavedKey(key)
    setTimeout(() => setSavedKey(null), 1500)
  }

  return (
    <div className="space-y-1.5">
      {pairs.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-xs font-mono">
          <input value={k} readOnly className="text-gray-600 w-36 shrink-0 border border-transparent bg-transparent px-1 py-0.5" />
          <input
            value={v}
            onChange={(e) => { onChange({ ...entries, [k]: e.target.value }); showSaved(k) }}
            className="flex-1 border border-gray-200 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:border-blue-400"
          />
          {savedKey === k ? (
            <span className="text-green-500 shrink-0">✓</span>
          ) : (
            <button onClick={() => remove(k)} className="text-gray-300 hover:text-red-400 shrink-0">x</button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={keyPlaceholder}
          className="w-36 border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-400" />
        <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={valuePlaceholder}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-400" />
        <button onClick={add} disabled={!newKey.trim()} className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300 shrink-0">
          {t('addAction')}
        </button>
      </div>
    </div>
  )
}
