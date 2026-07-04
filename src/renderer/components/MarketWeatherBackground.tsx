import { useEffect, useState } from 'react'
import { uiSurfaceContract } from '../panels/ui-surface-contract'

const MARKET_WEATHER_POLL_INTERVAL_MS =
  uiSurfaceContract('market-weather-background').pollIntervalMs ?? 60000

export default function MarketWeatherBackground() {
  const [regime, setRegime] = useState<'bullish' | 'bearish' | 'neutral'>('neutral')

  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.agent?.bridgeMessage({
          id: 'weather', type: 'readFile', path: 'snapshots/latest.json',
        }) as any
        if (result?.content) {
          const snap = JSON.parse(result.content)
          setRegime(snap.regime ?? 'neutral')
        }
      } catch { /* ignore */ }
    }
    load()
    const timer = setInterval(load, MARKET_WEATHER_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const colors: Record<string, string> = {
    bullish: 'rgba(239, 68, 68, 0.04)',
    bearish: 'rgba(16, 185, 129, 0.04)',
    neutral: 'rgba(59, 130, 246, 0.02)',
  }

  const glowColors: Record<string, string> = {
    bullish: 'rgba(239, 68, 68, 0.08)',
    bearish: 'rgba(16, 185, 129, 0.08)',
    neutral: 'rgba(59, 130, 246, 0.04)',
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none transition-all duration-[3000ms]"
      style={{
        background: `radial-gradient(ellipse at top right, ${glowColors[regime]} 0%, ${colors[regime]} 40%, transparent 70%)`,
      }}
    />
  )
}
