import { sidebarWidgetCategory, useSidebarStore, type WidgetType } from '../store/useSidebarStore'
import WatchlistWidget from '../components/WatchlistWidget'
import FundWatchlistWidget from '../components/FundWatchlistWidget'
import MarketPulseWidget from '../components/MarketPulseWidget'
import FundPulseWidget from '../components/FundPulseWidget'
import MacroFactorRadarWidget from '../components/MacroFactorRadarWidget'
import CalendarWidget from '../components/CalendarWidget'
import NewsFeedWidget from '../components/NewsFeedWidget'
import ResearchWorkspaceWidget from '../components/ResearchWorkspaceWidget'
import ApiHealthPanel from '../components/ApiHealthPanel'
import PortfolioCard from '../components/PortfolioCard'
import SessionHistoryPanel from '../components/SessionHistoryPanel'
import SessionPanel from '../components/SessionPanel'
import DataWidget from '../components/DataWidget'
import StrategyLibrary from '../components/StrategyLibrary'
import { useT } from '../store/useLanguageStore'

const WIDGET_COMPONENTS: Record<WidgetType, React.FC> = {
  watchlist: WatchlistWidget,
  'fund-watchlist': FundWatchlistWidget,
  pulse: MarketPulseWidget,
  'fund-pulse': FundPulseWidget,
  'factor-radar': MacroFactorRadarWidget,
  calendar: CalendarWidget,
  news: NewsFeedWidget,
  research: ResearchWorkspaceWidget,
  'api-health': ApiHealthPanel,
  portfolio: PortfolioCard,
  session: SessionPanel,
  sessions: SessionHistoryPanel,
  data: DataWidget,
  'strategy-library': () => <StrategyLibrary compact />,
}

export default function SidebarArea() {
  const t = useT()
  const { widgets, activeWidget, setActive } = useSidebarStore()

  if (widgets.length === 0) {
    return (
        <div className="h-full flex items-center justify-center text-xs text-gray-400">
        {t('noWidgets')}
        </div>
    )
  }

  return (
    <div className="flex h-full theme-bg">
      <div className="w-9 shrink-0 border-r theme-border theme-bg-secondary overflow-visible relative z-20">
        {widgets.map((w, index) => (
          <div key={w.id}>
            {shouldShowCategoryDivider(index, widgets) && (
              <div
                className="h-3 flex items-center justify-center"
                title={sidebarWidgetCategory(w.type)}
                aria-label={sidebarWidgetCategory(w.type)}
              >
                <span className="block w-5 border-t border-gray-300" />
                <span className="sr-only">{sidebarWidgetCategory(w.type)}</span>
              </div>
            )}
            <button
              onClick={() => setActive(w.id)}
              aria-label={w.title}
              className={`group relative flex items-center justify-center w-9 h-10 border-r-2 ${
                w.id === activeWidget
                  ? 'border-blue-500 theme-text'
                  : 'border-transparent theme-text-tertiary hover:theme-text-secondary'
              }`}
            >
              <SidebarIcon type={w.type} />
              <span className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded border theme-border theme-bg px-2 py-1 text-[11px] normal-case tracking-normal theme-text shadow-lg opacity-0 group-hover:opacity-100">
                {w.title}
              </span>
            </button>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-hidden relative">
        {widgets.map((widget) => {
          const Component = WIDGET_COMPONENTS[widget.type]
          return (
            <div
              key={widget.id}
              className={`absolute inset-0 overflow-hidden ${widget.id === activeWidget ? 'block' : 'hidden'}`}
            >
              <Component />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function shouldShowCategoryDivider(index: number, widgets: Array<{ type: WidgetType }>): boolean {
  if (index === 0) return false
  return sidebarWidgetCategory(widgets[index].type) !== sidebarWidgetCategory(widgets[index - 1].type)
}

function SidebarIcon({ type }: { type: WidgetType }) {
  switch (type) {
    case 'pulse': return <Icon path="M4 13h4l2-8 4 14 2-6h4" />
    case 'fund-pulse': return <Icon path="M12 3a9 9 0 1 1-9 9h9V3Zm2 0v7h7a9 9 0 0 0-7-7Z" filled />
    case 'factor-radar': return <Icon path="M12 3v4M12 17v4M4.2 6.2l2.8 2.8M17 17l2.8 2.8M3 12h4M17 12h4M4.2 17.8 7 15M17 7l2.8-2.8M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" />
    case 'watchlist': return <Icon path="M7 6h13M7 12h13M7 18h13M4 6h.01M4 12h.01M4 18h.01" />
    case 'fund-watchlist': return <Icon path="M4 7h16v12H4V7Zm3-3h10v3H7V4Zm4 7h5M8 15h8" />
    case 'news': return <Icon path="M4 5h13a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3V5Zm4 4h7M8 13h8M8 17h5" />
    case 'research': return <Icon path="M5 5h10a4 4 0 0 1 4 4v10H9a4 4 0 0 1-4-4V5Zm4 4h6M9 13h4M17 19l3 2" />
    case 'data': return <Icon path="M5 7c0-2 14-2 14 0s-14 2-14 0Zm0 0v10c0 2 14 2 14 0V7M5 12c0 2 14 2 14 0" />
    case 'strategy-library': return <Icon path="M6 4h12v16H6V4Zm3 4h6M9 12h6M9 16h4M5 6h2M5 10h2M5 14h2M5 18h2" />
    case 'api-health': return <Icon path="M4 13h4l2-6 4 10 2-4h4M12 3a9 9 0 1 0 9 9" />
    case 'session': return <Icon path="M8 5h8M8 9h8M8 13h5M5 5h.01M5 9h.01M5 13h.01M8 18l3 2 5-5" />
    case 'sessions': return <Icon path="M12 8v5l3 2M21 12a9 9 0 1 1-3-6.7M21 4v6h-6" />
    case 'calendar': return <Icon path="M7 3v4M17 3v4M4 8h16M5 5h14v16H5V5Zm3 7h3M13 12h3M8 16h3" />
    case 'portfolio': return <Icon path="M9 6V4h6v2M4 7h16v12H4V7Zm0 5h16" />
  }
}

function Icon({ path, filled = false }: { path: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d={path}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
