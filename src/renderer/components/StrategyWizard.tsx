import { useState } from 'react'
import { useAgentStore } from '../store/useAgentStore'
import { useT } from '../store/useLanguageStore'

type WizardStep = 'input' | 'preview' | 'result'

export default function StrategyWizard({ embedded = false }: { embedded?: boolean }) {
  const t = useT()
  const [step, setStep] = useState<WizardStep>('input')
  const [code, setCode] = useState('600519')
  const [description, setDescription] = useState('')
  const [strategy, setStrategy] = useState('rsi')
  const [period, setPeriod] = useState('200')
  const send = useAgentStore((s) => s.send)

  const strategies = [
    { id: 'rsi', name: t('strategyPresetRsiName'), desc: t('strategyPresetRsiDesc') },
    { id: 'macd', name: t('strategyPresetMacdName'), desc: t('strategyPresetMacdDesc') },
    { id: 'boll', name: t('strategyPresetBollName'), desc: t('strategyPresetBollDesc') },
    { id: 'ema_cross', name: t('strategyPresetEmaCrossName'), desc: t('strategyPresetEmaCrossDesc') },
    { id: 'rsi_conservative', name: t('strategyPresetRsiConservativeName'), desc: t('strategyPresetRsiConservativeDesc') },
    { id: 'boll_tight', name: t('strategyPresetBollTightName'), desc: t('strategyPresetBollTightDesc') },
  ]

  const runBacktest = () => {
    send(`Run backtest on ${code} using ${strategy} strategy with ${period} bars of daily data. Show the results.`)
    setStep('result')
  }

  const runNL = () => {
    if (!description.trim()) return
    send(`Based on this strategy description: "${description}"\nAnalyze stock ${code} and suggest which built-in strategy fits best, then run a backtest with ${period} bars.`)
    setStep('result')
  }

  return (
    <div className={`p-4 space-y-4 ${embedded ? '' : 'max-w-lg mx-auto'}`} style={{ color: 'var(--text-primary)' }}>
      {!embedded && <h2 className="text-sm font-semibold">{t('strategyWizardTitle')}</h2>}

      {/* Step indicators */}
      <div className="flex items-center gap-2 text-[10px]">
        {[t('strategyStepInput'), t('strategyStepConfigure'), t('strategyStepRun')].map((label, i) => {
          const stepIdx = step === 'input' ? 0 : step === 'preview' ? 1 : 2
          return (
            <div key={label} className="flex items-center gap-1">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{
                  background: i <= stepIdx ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: i <= stepIdx ? 'white' : 'var(--text-tertiary)',
                }}
              >{i + 1}</div>
              <span style={{ color: i <= stepIdx ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{label}</span>
              {i < 2 && <div className="w-8 h-px" style={{ background: 'var(--border)' }} />}
            </div>
          )
        })}
      </div>

      {step === 'input' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] block mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('strategyStockCode')}</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded px-2 py-1.5 text-sm font-mono"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              placeholder="600519"
            />
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('strategyDescriptionLabel')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded px-2 py-1.5 text-sm resize-none"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              placeholder={t('strategyDescriptionPlaceholder')}
            />
          </div>
          <button onClick={() => setStep('preview')} className="w-full py-1.5 rounded text-xs font-medium" style={{ background: 'var(--accent)', color: 'white' }}>
            {t('strategyNextConfigure')}
          </button>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] block mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('strategySelect')}</label>
            <div className="grid grid-cols-2 gap-2">
              {strategies.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStrategy(s.id)}
                  className="rounded p-2 text-left text-xs"
                  style={{
                    background: strategy === s.id ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: strategy === s.id ? 'white' : 'var(--text-primary)',
                    border: `1px solid ${strategy === s.id ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <div className="font-medium">{s.name}</div>
                  <div className="text-[10px] mt-0.5" style={{ opacity: 0.7 }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('strategyPeriodBars')}</label>
            <input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              type="number"
              className="w-full rounded px-2 py-1.5 text-sm font-mono"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep('input')} className="flex-1 py-1.5 rounded text-xs" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{t('strategyBack')}</button>
            <button onClick={runBacktest} className="flex-1 py-1.5 rounded text-xs font-medium" style={{ background: 'var(--accent)', color: 'white' }}>{t('strategyRunBacktest')}</button>
            {description && <button onClick={runNL} className="flex-1 py-1.5 rounded text-xs font-medium" style={{ background: 'var(--green)', color: 'white' }}>{t('strategyAiAnalyze')}</button>}
          </div>
        </div>
      )}

      {step === 'result' && (
        <div className="space-y-3">
          <div className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
            {t('strategyRequestSent')}
          </div>
          <button onClick={() => setStep('input')} className="w-full py-1.5 rounded text-xs" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            {t('strategyRunAnother')}
          </button>
        </div>
      )}
    </div>
  )
}
