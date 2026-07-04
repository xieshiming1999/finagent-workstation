import { useEffect, useState } from 'react'
import { useLanguageStore, useT } from '../store/useLanguageStore'

interface CalendarEvent {
  date: string
  type: 'earnings' | 'dividend' | 'ipo' | 'holiday'
  title: string
}

export default function CalendarWidget() {
  const t = useT()
  const resolvedLanguage = useLanguageStore((s) => s.resolved)
  const [isTrading, setIsTrading] = useState(false)
  const [marketOpen, setMarketOpen] = useState(false)
  const [events] = useState<CalendarEvent[]>([])

  useEffect(() => {
    const check = () => {
      const now = new Date()
      const day = now.getDay()
      setIsTrading(day >= 1 && day <= 5)
      const h = now.getHours(), m = now.getMinutes()
      const t = h * 100 + m
      setMarketOpen(day >= 1 && day <= 5 && ((t >= 930 && t <= 1130) || (t >= 1300 && t <= 1500)))
    }
    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [])

  const now = new Date()
  const locale = resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en-US'
  const dateStr = now.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  const timeStr = now.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="theme-bg theme-text-secondary p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs theme-text-tertiary">{dateStr}</span>
        <span className="text-xs font-mono theme-text-secondary">{timeStr}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${marketOpen ? 'bg-[#26a69a] animate-pulse' : 'bg-[#787b86]'}`} />
        <span className="text-xs">
          {marketOpen ? t('marketOpenNow') : isTrading ? t('marketClosedAfterHours') : t('nonTradingDayStatus')}
        </span>
      </div>
      <div className="text-[10px] theme-text-tertiary space-y-0.5">
        <div>{t('marketHoursAshare')}</div>
        <div>{t('marketHoursHk')}</div>
        <div>{t('marketHoursUs')}</div>
      </div>
      {events.length > 0 && (
        <div className="mt-2 pt-2 border-t theme-border">
          <div className="text-[10px] theme-text-tertiary mb-1">{t('upcoming')}</div>
          {events.map((e, i) => (
            <div key={i} className="text-[10px] theme-text-secondary">{e.date} {e.title}</div>
          ))}
        </div>
      )}
    </div>
  )
}
