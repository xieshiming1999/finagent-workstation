export type StrategyIndicatorRef = {
  type: string
  period: number
  id: string
}

export type StrategyIndicatorDefinition = {
  type: string
  defaultPeriod: number
  aliases: string[]
  executable?: boolean
  category?: string
  requiredFields?: string[]
  description?: string
  usesPeriodParameter?: boolean
  parameterSchema?: Array<Record<string, unknown>>
  lookbackBarsOverride?: number
}

export type FundStrategyIndicatorDefinition = {
  type: string
  category: string
  source: string
  requiredFields: string[]
  defaultPeriod: number
  description?: string
  parameterSchema?: Array<Record<string, unknown>>
  scoreDirection?: -1 | 0 | 1
}

export const indicatorRegistry: StrategyIndicatorDefinition[] = [
  { type: 'sma', defaultPeriod: 20, aliases: ['sma'], category: 'trend' },
  { type: 'ema', defaultPeriod: 20, aliases: ['ema'], category: 'trend' },
  { type: 'rsi', defaultPeriod: 14, aliases: ['rsi'], category: 'momentum' },
  { type: 'stochastic_rsi', defaultPeriod: 14, aliases: ['stoch_rsi', 'stochastic_rsi', 'stochrsi'], category: 'momentum', parameterSchema: [{ name: 'period', type: 'integer', default: 14, min: 1 }, { name: 'rsiPeriod', type: 'integer', default: 14, min: 1 }, { name: 'stochasticPeriod', type: 'integer', default: 14, min: 1 }, { name: 'lookbackPeriod', type: 'integer', default: 28, min: 2 }], description: 'Stochastic RSI oscillator scaled 0-100 using RSI values over a rolling stochastic window.' },
  { type: 'macd', defaultPeriod: 12, aliases: ['macd(?:_?hist)?'], category: 'momentum', parameterSchema: [{ name: 'fastPeriod', type: 'integer', default: 12, min: 1 }, { name: 'slowPeriod', type: 'integer', default: 26, min: 2 }, { name: 'signalPeriod', type: 'integer', default: 9, min: 1 }] },
  { type: 'ppo', defaultPeriod: 12, aliases: ['ppo', 'percentage_price_oscillator'], category: 'momentum', parameterSchema: [{ name: 'fastPeriod', type: 'integer', default: 12, min: 1 }, { name: 'slowPeriod', type: 'integer', default: 26, min: 2 }, { name: 'signalPeriod', type: 'integer', default: 9, min: 1 }], description: 'Percentage Price Oscillator histogram: MACD-style EMA spread normalized by slow EMA.' },
  { type: 'trix', defaultPeriod: 15, aliases: ['trix', 'triple_ema_roc', 'triple_ema_rate_of_change'], category: 'momentum', description: 'TRIX oscillator: one-period rate of change of a triple EMA, expressed as a percentage.' },
  { type: 'true_strength_index', defaultPeriod: 25, aliases: ['tsi', 'true_strength_index', 'truestrengthindex'], category: 'momentum', parameterSchema: [{ name: 'longPeriod', type: 'integer', default: 25, min: 2 }, { name: 'shortPeriod', type: 'integer', default: 13, min: 1 }], description: 'True Strength Index oscillator: double-smoothed momentum divided by double-smoothed absolute momentum, scaled -100 to 100.' },
  { type: 'bollinger', defaultPeriod: 20, aliases: ['boll', 'bollinger'], category: 'volatility' },
  { type: 'atr', defaultPeriod: 14, aliases: ['atr'], category: 'volatility', requiredFields: ['high', 'low', 'close'] },
  { type: 'supertrend_direction', defaultPeriod: 10, aliases: ['supertrend', 'super_trend', 'supertrend_direction'], category: 'trend', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'period', type: 'integer', default: 10, min: 1 }, { name: 'atrMultiplier', type: 'number', default: 3, min: 0, lookback: false }], description: 'Supertrend direction: 1 for close above the ATR trend line, -1 for close below it.' },
  { type: 'supertrend_distance_pct', defaultPeriod: 10, aliases: ['supertrend_distance', 'supertrend_distance_pct', 'super_trend_distance'], category: 'risk', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'period', type: 'integer', default: 10, min: 1 }, { name: 'atrMultiplier', type: 'number', default: 3, min: 0, lookback: false }], description: 'Signed close distance from the Supertrend line as a percentage of close; positive above the line, negative below it.' },
  { type: 'chandelier_stop_distance_pct', defaultPeriod: 22, aliases: ['chandelier_stop_distance', 'chandelier_stop_distance_pct', 'chandelier_exit_distance', 'chandelier_exit_distance_pct'], category: 'risk', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'period', type: 'integer', default: 22, min: 1 }, { name: 'atrPeriod', type: 'integer', default: 22, min: 1 }, { name: 'atrMultiplier', type: 'number', default: 3, min: 0, lookback: false }], description: 'Signed close distance from a long Chandelier stop, rolling high minus ATR multiple, as a percentage of close; positive means close is above the stop.' },
  { type: 'highest', defaultPeriod: 20, aliases: ['highest'], category: 'breakout' },
  { type: 'lowest', defaultPeriod: 20, aliases: ['lowest'], category: 'breakout' },
  { type: 'volume_sma', defaultPeriod: 20, aliases: ['vol', 'volume_sma', 'vol_sma'], category: 'volume', requiredFields: ['volume'] },
  { type: 'price_change_pct', defaultPeriod: 20, aliases: ['roc', 'price_change_pct', 'return'], category: 'momentum' },
  { type: 'momentum_acceleration_pct', defaultPeriod: 20, aliases: ['momentum_acceleration', 'momentum_acceleration_pct', 'roc_acceleration', 'return_acceleration'], category: 'momentum', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'lagPeriod', type: 'integer', default: 20, min: 1 }], lookbackBarsOverride: 40, description: 'Momentum acceleration: current period return minus the previous lagged period return, expressed in percentage points.' },
  { type: 'efficiency_ratio', defaultPeriod: 20, aliases: ['er', 'efficiency_ratio', 'kaufman_efficiency_ratio'], category: 'trend', description: 'Kaufman-style trend efficiency ratio: absolute period change divided by cumulative absolute bar-to-bar movement.' },
  { type: 'momentum_rank', defaultPeriod: 20, aliases: ['momentum_rank', 'momentum_percentile', 'rolling_momentum_rank'], category: 'momentum', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'rankPeriod', type: 'integer', default: 60, min: 2 }], description: 'Rolling percentile rank of period return within a longer rank window, scaled 0-100.' },
  { type: 'chande_momentum_oscillator', defaultPeriod: 14, aliases: ['cmo', 'chande_momentum', 'chande_momentum_oscillator'], category: 'momentum', description: 'Chande Momentum Oscillator scaled -100 to 100 using rolling positive and negative close-to-close changes.' },
  { type: 'aroon_oscillator', defaultPeriod: 25, aliases: ['aroon', 'aroon_oscillator', 'aroonoscillator'], category: 'trend', requiredFields: ['high', 'low'], description: 'Aroon oscillator: Aroon Up minus Aroon Down over a rolling high-low window, scaled -100 to 100.' },
  { type: 'aroon_up', defaultPeriod: 25, aliases: ['aroon_up', 'aroonup'], category: 'trend', requiredFields: ['high', 'low'], description: 'Aroon Up component: recency of the rolling high over the configured high-low window, scaled 0-100.' },
  { type: 'aroon_down', defaultPeriod: 25, aliases: ['aroon_down', 'aroondown'], category: 'trend', requiredFields: ['high', 'low'], description: 'Aroon Down component: recency of the rolling low over the configured high-low window, scaled 0-100.' },
  { type: 'vortex_spread', defaultPeriod: 14, aliases: ['vortex', 'vortex_spread', 'vortex_indicator', 'vi_spread'], category: 'trend', requiredFields: ['high', 'low', 'close'], description: 'Vortex Indicator spread: VI+ minus VI- over the rolling window; positive values indicate stronger upward trend pressure.' },
  { type: 'rolling_volatility', defaultPeriod: 20, aliases: ['volatility', 'rolling_volatility', 'return_volatility'], category: 'volatility' },
  { type: 'donchian_width_pct', defaultPeriod: 20, aliases: ['donchian_width', 'donchian_width_pct', 'channel_width_pct'], category: 'volatility', requiredFields: ['high', 'low', 'close'], description: 'Donchian channel width as a percentage of close: rolling high-low range divided by close.' },
  { type: 'range_compression_ratio', defaultPeriod: 20, aliases: ['range_compression', 'range_compression_ratio', 'range_contraction_ratio', 'volatility_contraction_ratio'], category: 'volatility', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'baselinePeriod', type: 'integer', default: 60, min: 2 }], description: 'Range compression ratio: current Donchian range percent divided by a longer baseline range percent; values below 1 indicate range contraction.' },
  { type: 'donchian_position_pct', defaultPeriod: 20, aliases: ['donchian_position', 'donchian_position_pct', 'channel_position_pct'], category: 'breakout', requiredFields: ['high', 'low', 'close'], description: 'Donchian channel position: close location inside the rolling high-low channel, scaled 0-100.' },
  { type: 'keltner_width_pct', defaultPeriod: 20, aliases: ['keltner_width', 'keltner_width_pct', 'keltner_channel_width'], category: 'volatility', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'atrPeriod', type: 'integer', default: 20, min: 1 }, { name: 'atrMultiplier', type: 'number', default: 2, min: 0 }], description: 'Keltner channel width as a percentage of EMA centerline, using ATR-based upper and lower bands.' },
  { type: 'downside_volatility_pct', defaultPeriod: 20, aliases: ['downside_volatility', 'downside_volatility_pct', 'downside_risk'], category: 'risk', description: 'Annualized downside-only volatility of negative returns over the rolling period, expressed as a percentage.' },
  { type: 'sortino_ratio', defaultPeriod: 20, aliases: ['sortino', 'sortino_ratio', 'rolling_sortino'], category: 'risk', description: 'Rolling annualized Sortino-style return divided by downside deviation, using close-to-close returns.' },
  { type: 'sharpe_ratio', defaultPeriod: 20, aliases: ['sharpe', 'sharpe_ratio', 'rolling_sharpe'], category: 'risk', description: 'Rolling annualized mean return divided by total return volatility, using close-to-close returns.' },
  { type: 'calmar_ratio', defaultPeriod: 60, aliases: ['calmar', 'calmar_ratio', 'rolling_calmar'], category: 'risk', description: 'Rolling period return divided by absolute maximum drawdown in the same window.' },
  { type: 'ulcer_index', defaultPeriod: 20, aliases: ['ulcer', 'ulcer_index', 'rolling_ulcer_index'], category: 'risk', description: 'Rolling root mean square percentage drawdown from the window high-water mark.' },
  { type: 'gain_to_pain_ratio', defaultPeriod: 20, aliases: ['gain_to_pain', 'gain_to_pain_ratio', 'gtp_ratio'], category: 'risk', description: 'Rolling sum of positive returns divided by absolute sum of negative returns.' },
  { type: 'positive_period_ratio', defaultPeriod: 20, aliases: ['positive_period_ratio', 'positive_return_ratio', 'positive_periods', 'win_period_ratio'], category: 'risk', description: 'Share of close-to-close returns above zero in the rolling window, scaled 0-100 as return consistency evidence.' },
  { type: 'negative_period_ratio', defaultPeriod: 20, aliases: ['negative_period_ratio', 'negative_return_ratio', 'negative_periods', 'loss_period_ratio'], category: 'risk', description: 'Share of close-to-close returns below zero in the rolling window, scaled 0-100 as downside frequency evidence.' },
  { type: 'max_consecutive_down_bars', defaultPeriod: 20, aliases: ['max_consecutive_down_bars', 'max_down_streak', 'losing_streak_bars', 'down_streak_bars'], category: 'risk', description: 'Maximum consecutive close-to-close down bars inside the rolling window, useful as losing-streak persistence evidence.' },
  { type: 'max_consecutive_up_bars', defaultPeriod: 20, aliases: ['max_consecutive_up_bars', 'max_up_streak', 'winning_streak_bars', 'up_streak_bars'], category: 'risk', description: 'Maximum consecutive close-to-close up bars inside the rolling window, useful as winning-streak persistence evidence.' },
  { type: 'return_skewness', defaultPeriod: 60, aliases: ['return_skewness', 'rolling_skewness', 'skewness', 'return_skew'], category: 'risk', parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }], description: 'Rolling close-to-close return skewness; positive values indicate right-tailed returns and negative values indicate downside asymmetry.' },
  { type: 'return_kurtosis', defaultPeriod: 60, aliases: ['return_kurtosis', 'rolling_kurtosis', 'kurtosis', 'excess_kurtosis'], category: 'risk', parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }], description: 'Rolling close-to-close excess kurtosis; higher values indicate fatter-tailed return distribution risk.' },
  { type: 'omega_ratio', defaultPeriod: 20, aliases: ['omega', 'omega_ratio', 'rolling_omega'], category: 'risk', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 2 }, { name: 'thresholdReturn', type: 'number', default: 0, lookback: false }], description: 'Rolling Omega ratio: return gains above threshold divided by shortfall below threshold.' },
  { type: 'tail_ratio', defaultPeriod: 60, aliases: ['tail_ratio', 'rolling_tail_ratio', 'upside_downside_tail_ratio'], category: 'risk', parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }, { name: 'upperPercentile', type: 'number', default: 95, min: 50, max: 100, lookback: false }, { name: 'lowerPercentile', type: 'number', default: 5, min: 0, max: 50, lookback: false }], description: 'Rolling upside/downside tail ratio using upper and lower return percentiles.' },
  { type: 'value_at_risk_pct', defaultPeriod: 60, aliases: ['value_at_risk', 'value_at_risk_pct', 'var', 'var_pct'], category: 'risk', parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }, { name: 'confidence', type: 'number', default: 95, min: 50, max: 99.9, lookback: false }], description: 'Rolling historical Value at Risk based on close-to-close returns, expressed as a positive loss percentage at the configured confidence level.' },
  { type: 'conditional_value_at_risk_pct', defaultPeriod: 60, aliases: ['conditional_value_at_risk', 'conditional_value_at_risk_pct', 'cvar', 'cvar_pct', 'expected_shortfall'], category: 'risk', parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }, { name: 'confidence', type: 'number', default: 95, min: 50, max: 99.9, lookback: false }], description: 'Rolling Conditional Value at Risk / expected shortfall based on tail close-to-close losses, expressed as a positive loss percentage.' },
  { type: 'volatility_regime', defaultPeriod: 20, aliases: ['volatility_regime', 'vol_regime', 'volatility_state'], category: 'volatility', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 2 }, { name: 'shortPeriod', type: 'integer', default: 20, min: 2 }, { name: 'baselinePeriod', type: 'integer', default: 60, min: 3 }], description: 'Volatility regime score: 1 when short-window volatility is above its baseline, -1 when materially below baseline, otherwise 0.' },
  { type: 'volatility_percentile', defaultPeriod: 20, aliases: ['volatility_percentile', 'vol_percentile', 'volatility_rank'], category: 'volatility', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 2 }, { name: 'baselinePeriod', type: 'integer', default: 60, min: 3 }], description: 'Rolling volatility percentile: current realized volatility percentile within its own baseline window, scaled 0-100.' },
  { type: 'ema_slope', defaultPeriod: 20, aliases: ['ema_slope', 'emaslope'], category: 'trend' },
  { type: 'moving_average_regime', defaultPeriod: 50, aliases: ['ma_regime', 'moving_average_regime', 'ma_trend_regime'], category: 'trend', parameterSchema: [{ name: 'fastPeriod', type: 'integer', default: 20, min: 1 }, { name: 'slowPeriod', type: 'integer', default: 50, min: 2 }], description: 'Trend regime score: 1 when close > fast MA > slow MA, -1 when close < fast MA < slow MA, otherwise 0.' },
  { type: 'kama_distance_pct', defaultPeriod: 10, aliases: ['kama_distance', 'kama_distance_pct', 'adaptive_ma_distance', 'adaptive_ma_distance_pct'], category: 'trend', parameterSchema: [{ name: 'erPeriod', type: 'integer', default: 10, min: 2 }, { name: 'fastPeriod', type: 'integer', default: 2, min: 1 }, { name: 'slowPeriod', type: 'integer', default: 30, min: 2 }], description: 'Close distance from Kaufman Adaptive Moving Average as a percentage of KAMA.' },
  { type: 'kama_slope_pct', defaultPeriod: 10, aliases: ['kama_slope', 'kama_slope_pct', 'adaptive_ma_slope', 'adaptive_ma_slope_pct'], category: 'trend', parameterSchema: [{ name: 'erPeriod', type: 'integer', default: 10, min: 2 }, { name: 'fastPeriod', type: 'integer', default: 2, min: 1 }, { name: 'slowPeriod', type: 'integer', default: 30, min: 2 }], description: 'One-bar percentage slope of Kaufman Adaptive Moving Average.' },
  { type: 'linear_regression_slope_pct', defaultPeriod: 20, aliases: ['linear_regression_slope', 'linear_regression_slope_pct', 'linreg_slope', 'regression_slope'], category: 'trend', description: 'Rolling least-squares trend slope expressed as percentage of the fitted start price over the window.' },
  { type: 'linear_regression_r2', defaultPeriod: 20, aliases: ['linear_regression_r2', 'linreg_r2', 'regression_r2', 'trend_r2'], category: 'trend', description: 'Rolling coefficient of determination for close-price linear regression, scaled 0-1 as trend quality evidence.' },
  { type: 'ma_distance_pct', defaultPeriod: 20, aliases: ['ma_distance', 'ma_distance_pct', 'distance_to_ma', 'ma_gap_pct'], category: 'trend', description: 'Percentage distance between close and a moving average: positive above MA, negative below MA.' },
  { type: 'price_zscore', defaultPeriod: 20, aliases: ['price_zscore', 'zscore', 'close_zscore'], category: 'mean_reversion', description: 'Rolling price z-score: positive when close is above its rolling mean, negative when below.' },
  { type: 'bollinger_bandwidth', defaultPeriod: 20, aliases: ['bollinger_bandwidth', 'boll_bandwidth', 'bb_width'], category: 'volatility', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'stdDevMultiplier', type: 'number', default: 2, min: 0, lookback: false }], description: 'Bollinger Bandwidth: upper-lower band width divided by middle band, expressed as a percentage.' },
  { type: 'bollinger_percent_b', defaultPeriod: 20, aliases: ['bollinger_percent_b', 'boll_percent_b', 'bb_percent_b', 'percent_b'], category: 'mean_reversion', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'stdDevMultiplier', type: 'number', default: 2, min: 0, lookback: false }], description: 'Bollinger %B: close position inside the lower-to-upper band range, scaled 0-100.' },
  { type: 'bollinger_band_distance_pct', defaultPeriod: 20, aliases: ['bollinger_band_distance', 'bollinger_band_distance_pct', 'bb_band_distance', 'bb_distance_pct'], category: 'mean_reversion', parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'stdDevMultiplier', type: 'number', default: 2, min: 0, lookback: false }], description: 'Signed close distance from the nearest Bollinger band as a percentage of close; positive above the upper band, negative below the lower band, zero inside bands.' },
  { type: 'kdj', defaultPeriod: 9, aliases: ['kdj', 'stochastic'], category: 'momentum', requiredFields: ['high', 'low', 'close'] },
  { type: 'stochastic_d', defaultPeriod: 9, aliases: ['stochastic_d', 'kdj_d', 'kd_d'], category: 'momentum', requiredFields: ['high', 'low', 'close'], description: 'KDJ D line: smoothed stochastic K value over the high-low-close window.' },
  { type: 'stochastic_j', defaultPeriod: 9, aliases: ['stochastic_j', 'kdj_j', 'kd_j'], category: 'momentum', requiredFields: ['high', 'low', 'close'], description: 'KDJ J line: 3*K - 2*D, useful as a faster stochastic momentum component.' },
  { type: 'adx', defaultPeriod: 14, aliases: ['adx'], category: 'trend', requiredFields: ['high', 'low', 'close'] },
  { type: 'dmi_plus', defaultPeriod: 14, aliases: ['dmi_plus', 'plus_di', 'pdi'], category: 'trend', requiredFields: ['high', 'low', 'close'], description: 'Positive Directional Indicator (+DI): upward directional movement divided by true range, scaled 0-100.' },
  { type: 'dmi_minus', defaultPeriod: 14, aliases: ['dmi_minus', 'minus_di', 'mdi'], category: 'trend', requiredFields: ['high', 'low', 'close'], description: 'Negative Directional Indicator (-DI): downward directional movement divided by true range, scaled 0-100.' },
  { type: 'dmi_spread', defaultPeriod: 14, aliases: ['dmi_spread', 'di_spread', 'directional_spread'], category: 'trend', requiredFields: ['high', 'low', 'close'], description: 'Directional Movement spread: +DI minus -DI, positive for upward directional pressure and negative for downward pressure.' },
  { type: 'turnover_rate', defaultPeriod: 1, aliases: ['turnover', 'turnover_rate', 'turnoverRate'], category: 'liquidity', requiredFields: ['turnoverRate'], usesPeriodParameter: false },
  { type: 'liquidity_ratio', defaultPeriod: 20, aliases: ['liquidity_ratio', 'volume_ratio', 'vol_ratio'], category: 'liquidity', requiredFields: ['volume'], description: 'Relative volume / liquidity ratio: current volume divided by rolling average volume over the configured period.' },
  { type: 'volume_zscore', defaultPeriod: 20, aliases: ['volume_zscore', 'vol_zscore', 'volume_anomaly'], category: 'volume', requiredFields: ['volume'], description: 'Rolling volume z-score: positive when volume is above its rolling mean, negative when below.' },
  { type: 'volume_breakout', defaultPeriod: 20, aliases: ['volume_breakout', 'vol_breakout', 'volume_expansion'], category: 'volume', requiredFields: ['volume'], description: 'Volume breakout ratio: current volume divided by rolling average volume over period.' },
  { type: 'volume_oscillator_pct', defaultPeriod: 12, aliases: ['pvo', 'volume_oscillator', 'volume_oscillator_pct'], category: 'volume', requiredFields: ['volume'], parameterSchema: [{ name: 'fastPeriod', type: 'integer', default: 12, min: 1 }, { name: 'slowPeriod', type: 'integer', default: 26, min: 2 }], description: 'Percentage Volume Oscillator: fast volume EMA minus slow volume EMA, divided by slow volume EMA.' },
  { type: 'volume_rate_of_change_pct', defaultPeriod: 20, aliases: ['vroc', 'volume_roc', 'volume_rate_of_change_pct'], category: 'volume', requiredFields: ['volume'], description: 'Volume rate of change: percentage change from volume N bars ago to current volume.' },
  { type: 'volume_percentile', defaultPeriod: 60, aliases: ['volume_percentile', 'volume_rank', 'volume_percentile_rank'], category: 'volume', requiredFields: ['volume'], parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Rolling percentile rank of current volume within the configured volume window, scaled 0-100.' },
  { type: 'rolling_vwap', defaultPeriod: 20, aliases: ['rolling_vwap', 'vwap', 'vwap_price'], category: 'volume', requiredFields: ['high', 'low', 'close', 'volume'], description: 'Rolling VWAP price using typical price weighted by volume over the configured period.' },
  { type: 'money_flow_index', defaultPeriod: 14, aliases: ['mfi', 'money_flow_index', 'moneyflowindex'], category: 'volume', requiredFields: ['high', 'low', 'close', 'volume'], description: 'Money Flow Index oscillator using typical price and volume, scaled 0-100.' },
  { type: 'on_balance_volume', defaultPeriod: 1, aliases: ['obv', 'on_balance_volume', 'onbalancevolume'], category: 'volume', requiredFields: ['close', 'volume'], usesPeriodParameter: false, description: 'Cumulative On-Balance Volume: adds volume on up closes and subtracts it on down closes.' },
  { type: 'volume_price_trend', defaultPeriod: 1, aliases: ['vpt', 'volume_price_trend', 'volumepricetrend'], category: 'volume', requiredFields: ['close', 'volume'], usesPeriodParameter: false, description: 'Cumulative Volume Price Trend: adds volume weighted by close-to-close percentage change.' },
  { type: 'positive_volume_index', defaultPeriod: 1, aliases: ['pvi', 'positive_volume_index', 'positivevolumeindex'], category: 'volume', requiredFields: ['close', 'volume'], usesPeriodParameter: false, description: 'Positive Volume Index: cumulative close return only on bars where volume increases from the prior bar.' },
  { type: 'negative_volume_index', defaultPeriod: 1, aliases: ['nvi', 'negative_volume_index', 'negativevolumeindex'], category: 'volume', requiredFields: ['close', 'volume'], usesPeriodParameter: false, description: 'Negative Volume Index: cumulative close return only on bars where volume decreases from the prior bar.' },
  { type: 'accumulation_distribution_line', defaultPeriod: 1, aliases: ['adl', 'accumulation_distribution', 'accumulation_distribution_line', 'accdist'], category: 'volume', requiredFields: ['high', 'low', 'close', 'volume'], usesPeriodParameter: false, description: 'Cumulative Accumulation/Distribution Line using close location value weighted by volume.' },
  { type: 'chaikin_money_flow', defaultPeriod: 20, aliases: ['cmf', 'chaikin_money_flow', 'chaikinmoneyflow'], category: 'volume', requiredFields: ['high', 'low', 'close', 'volume'], description: 'Chaikin Money Flow using close location value weighted by rolling volume.' },
  { type: 'force_index', defaultPeriod: 13, aliases: ['force_index', 'elder_force_index', 'efi'], category: 'volume', requiredFields: ['close', 'volume'], parameterSchema: [{ name: 'period', type: 'integer', default: 13, min: 1 }, { name: 'smoothingPeriod', type: 'integer', default: 13, min: 1 }], description: 'Elder Force Index: close-to-close price change multiplied by volume, smoothed with EMA.' },
  { type: 'ease_of_movement', defaultPeriod: 14, aliases: ['ease_of_movement', 'eom', 'easeofmovement'], category: 'volume', requiredFields: ['high', 'low', 'volume'], parameterSchema: [{ name: 'period', type: 'integer', default: 14, min: 1 }, { name: 'volumeDivisor', type: 'number', default: 1000000, min: 1, lookback: false }], description: 'Ease of Movement: midpoint movement scaled by high-low range and volume, smoothed over period.' },
  { type: 'vwap_distance_pct', defaultPeriod: 20, aliases: ['vwap_distance', 'vwap_distance_pct', 'rolling_vwap_distance'], category: 'volume', requiredFields: ['high', 'low', 'close', 'volume'], description: 'Close distance from rolling VWAP, expressed as a percentage of VWAP.' },
  { type: 'ichimoku_cloud_position', defaultPeriod: 52, aliases: ['ichimoku', 'ichimoku_cloud', 'ichimoku_cloud_position'], category: 'trend', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'conversionPeriod', type: 'integer', default: 9, min: 1 }, { name: 'basePeriod', type: 'integer', default: 26, min: 2 }, { name: 'spanBPeriod', type: 'integer', default: 52, min: 3 }], description: 'Ichimoku cloud position: 1 above cloud, -1 below cloud, 0 inside cloud, using historical windows only.' },
  { type: 'parabolic_sar_direction', defaultPeriod: 2, aliases: ['psar', 'parabolic_sar', 'parabolic_sar_direction'], category: 'trend', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'acceleration', type: 'number', default: 0.02, min: 0.001, lookback: false }, { name: 'maxAcceleration', type: 'number', default: 0.2, min: 0.01, lookback: false }], description: 'Parabolic SAR trend direction: 1 when close is above SAR, -1 when close is below SAR.' },
  { type: 'commodity_channel_index', defaultPeriod: 20, aliases: ['cci', 'commodity_channel_index', 'commoditychannelindex'], category: 'momentum', requiredFields: ['high', 'low', 'close'], description: 'Commodity Channel Index using typical price deviation from its moving average.' },
  { type: 'williams_r', defaultPeriod: 14, aliases: ['williams_r', 'williamsr', 'willr', 'wr'], category: 'momentum', requiredFields: ['high', 'low', 'close'], description: 'Williams %R oscillator over the high-low range, scaled from -100 to 0.' },
  { type: 'drawdown_pct', defaultPeriod: 20, aliases: ['drawdown', 'drawdown_pct', 'rolling_drawdown'], category: 'risk', description: 'Percentage drawdown from the rolling high over period.' },
  { type: 'rolling_max_drawdown_pct', defaultPeriod: 20, aliases: ['rolling_max_drawdown', 'rolling_max_drawdown_pct', 'window_max_drawdown', 'window_max_drawdown_pct'], category: 'risk', description: 'Worst peak-to-trough percentage drawdown observed inside the rolling window.' },
  { type: 'drawdown_duration_bars', defaultPeriod: 20, aliases: ['drawdown_duration', 'drawdown_duration_bars', 'underwater_bars', 'recovery_duration'], category: 'risk', description: 'Number of bars since the latest rolling high-water mark; zero when price is at the rolling high.' },
  { type: 'distance_to_high_pct', defaultPeriod: 20, aliases: ['distance_to_high', 'distance_to_high_pct', 'high_distance'], category: 'breakout', description: 'Percentage distance from the rolling high over period.' },
  { type: 'distance_to_low_pct', defaultPeriod: 20, aliases: ['distance_to_low', 'distance_to_low_pct', 'low_distance'], category: 'risk', description: 'Percentage distance above the rolling low over period, useful as support-distance evidence.' },
  { type: 'breakout_pct', defaultPeriod: 20, aliases: ['breakout', 'breakout_pct', 'new_high_breakout'], category: 'breakout', description: 'Percentage breakout above the previous rolling high over period; positive only when close exceeds the prior high.' },
  { type: 'breakdown_pct', defaultPeriod: 20, aliases: ['breakdown', 'breakdown_pct', 'new_low_breakdown'], category: 'risk', description: 'Percentage breakdown below the previous rolling low over period; positive only when close falls below prior support.' },
  { type: 'atr_pct', defaultPeriod: 14, aliases: ['atr_pct', 'atr_percent', 'normalized_atr'], category: 'risk', requiredFields: ['high', 'low', 'close'], description: 'ATR as a percentage of close price.' },
  { type: 'atr_stop_distance_pct', defaultPeriod: 14, aliases: ['atr_stop_distance', 'atr_stop_distance_pct', 'atr_risk_distance'], category: 'risk', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'period', type: 'integer', default: 14, min: 1 }, { name: 'atrMultiplier', type: 'number', default: 2, min: 0, lookback: false }], description: 'ATR stop distance as a percentage of close: ATR multiplied by the configured stop multiplier.' },
  { type: 'risk_reward_ratio', defaultPeriod: 20, aliases: ['risk_reward', 'risk_reward_ratio', 'reward_risk_ratio'], category: 'risk', requiredFields: ['high', 'low', 'close'], parameterSchema: [{ name: 'targetPeriod', type: 'integer', default: 20, min: 1 }, { name: 'atrPeriod', type: 'integer', default: 14, min: 1 }, { name: 'atrMultiplier', type: 'number', default: 2, min: 0, lookback: false }], description: 'Estimated reward-to-risk ratio: upside distance to recent rolling high divided by ATR stop distance.' },
  { type: 'intraday_range_pct', defaultPeriod: 1, aliases: ['intraday_range', 'intraday_range_pct', 'daily_range_pct'], category: 'volatility', requiredFields: ['high', 'low', 'close'], description: 'Daily high-low range as a percentage of close price.' },
  { type: 'gap_pct', defaultPeriod: 1, aliases: ['gap', 'gap_pct', 'opening_gap_pct'], category: 'price_action', requiredFields: ['open', 'close'], description: 'Opening gap percentage from previous close to current open price.' },
  { type: 'close_location_pct', defaultPeriod: 1, aliases: ['close_location', 'close_location_pct', 'close_position_pct'], category: 'price_action', requiredFields: ['high', 'low', 'close'], description: 'Close location within the daily high-low range, scaled 0-100 from low to high.' },
  { type: 'body_return_pct', defaultPeriod: 1, aliases: ['body_return', 'body_return_pct', 'open_close_return_pct'], category: 'price_action', requiredFields: ['open', 'close'], description: 'Open-to-close candle body return percentage for the current bar.' },
  { type: 'upper_shadow_pct', defaultPeriod: 1, aliases: ['upper_shadow', 'upper_shadow_pct', 'upper_wick_pct'], category: 'price_action', requiredFields: ['open', 'high', 'close'], description: 'Upper candle shadow length as a percentage of close price.' },
  { type: 'lower_shadow_pct', defaultPeriod: 1, aliases: ['lower_shadow', 'lower_shadow_pct', 'lower_wick_pct'], category: 'price_action', requiredFields: ['open', 'low', 'close'], description: 'Lower candle shadow length as a percentage of close price.' },
  { type: 'shadow_balance_pct', defaultPeriod: 1, aliases: ['shadow_balance', 'shadow_balance_pct', 'wick_balance_pct'], category: 'price_action', requiredFields: ['open', 'high', 'low', 'close'], usesPeriodParameter: false, description: 'Signed candle shadow balance as a percentage of close: positive for stronger lower shadow, negative for stronger upper shadow.' },
  { type: 'body_to_range_pct', defaultPeriod: 1, aliases: ['body_to_range', 'body_to_range_pct', 'candle_body_ratio'], category: 'price_action', requiredFields: ['open', 'high', 'low', 'close'], description: 'Candle body size as a percentage of the daily high-low range.' },
]

export const fundStrategyIndicatorCatalog = [
  'nav_trend',
  'rolling_return',
  'fund_drawdown',
  'fund_rolling_max_drawdown',
  'fund_average_drawdown',
  'fund_ulcer_index',
  'fund_drawdown_duration_bars',
  'fund_volatility',
  'fund_downside_volatility',
  'fund_sharpe',
  'fund_sortino',
  'fund_calmar',
  'fund_recovery_ratio',
  'fund_gain_to_pain',
  'fund_momentum_acceleration',
  'fund_omega',
  'fund_tail_ratio',
  'fund_positive_period_ratio',
  'fund_negative_period_ratio',
  'fund_max_consecutive_down_periods',
  'fund_max_consecutive_up_periods',
  'fund_return_skewness',
  'fund_return_kurtosis',
  'fund_value_at_risk',
  'fund_conditional_value_at_risk',
  'money_yield',
  'seven_day_yield',
  'dca_interval',
] as const

export const fundStrategyIndicatorRegistry: FundStrategyIndicatorDefinition[] = [
  { type: 'nav_trend', category: 'ordinary_fund_nav', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 20, description: 'NAV trend over the configured period.' },
  { type: 'rolling_return', category: 'ordinary_fund_nav', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 20, description: 'NAV rolling return percentage over the configured period.' },
  { type: 'fund_drawdown', category: 'fund_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 20, scoreDirection: -1, description: 'Current drawdown from the recent NAV high.' },
  { type: 'fund_rolling_max_drawdown', category: 'fund_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Worst peak-to-trough NAV drawdown inside the rolling window.' },
  { type: 'fund_average_drawdown', category: 'fund_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Average positive NAV drawdown from rolling high-water marks inside the window.' },
  { type: 'fund_ulcer_index', category: 'fund_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }], description: 'Rolling NAV Ulcer index: root mean square drawdown from the period high-water mark.' },
  { type: 'fund_drawdown_duration_bars', category: 'fund_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Number of NAV rows since the latest high-water mark inside the rolling window; zero means the fund is at a recent high.' },
  { type: 'fund_volatility', category: 'fund_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 20, scoreDirection: -1, description: 'Annualized NAV return volatility.' },
  { type: 'fund_downside_volatility', category: 'fund_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Annualized downside-only NAV return volatility over the rolling window.' },
  { type: 'fund_sharpe', category: 'fund_risk_adjusted', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, description: 'Annualized mean NAV return divided by total volatility.' },
  { type: 'fund_sortino', category: 'fund_risk_adjusted', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, description: 'Annualized mean NAV return divided by downside volatility.' },
  { type: 'fund_calmar', category: 'fund_risk_adjusted', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, description: 'Period NAV return divided by maximum drawdown.' },
  { type: 'fund_recovery_ratio', category: 'fund_risk_adjusted', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Period NAV return divided by average drawdown, expressing recovery efficiency relative to typical drawdown depth.' },
  { type: 'fund_gain_to_pain', category: 'fund_return_quality', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, description: 'NAV return-quality ratio: positive return sum divided by absolute negative return sum.' },
  { type: 'fund_momentum_acceleration', category: 'fund_return_quality', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 20, parameterSchema: [{ name: 'period', type: 'integer', default: 20, min: 1 }, { name: 'lagPeriod', type: 'integer', default: 20, min: 1 }], description: 'NAV momentum acceleration: current period return minus the previous lagged period return.' },
  { type: 'fund_omega', category: 'fund_return_quality', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }, { name: 'thresholdReturn', type: 'number', default: 0, lookback: false }], description: 'NAV Omega-style ratio: gains above threshold divided by shortfall below threshold.' },
  { type: 'fund_tail_ratio', category: 'fund_return_quality', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }, { name: 'upperPercentile', type: 'number', default: 95, min: 50, max: 100, lookback: false }, { name: 'lowerPercentile', type: 'number', default: 5, min: 0, max: 50, lookback: false }], description: 'NAV upside/downside tail ratio using rolling return percentiles.' },
  { type: 'fund_positive_period_ratio', category: 'fund_return_consistency', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Share of rolling NAV return periods above zero, scaled 0-100 as return consistency evidence.' },
  { type: 'fund_negative_period_ratio', category: 'fund_return_consistency', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Share of rolling NAV return periods below zero, scaled 0-100 as downside frequency evidence.' },
  { type: 'fund_max_consecutive_down_periods', category: 'fund_return_consistency', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Maximum consecutive negative NAV return periods inside the rolling window.' },
  { type: 'fund_max_consecutive_up_periods', category: 'fund_return_consistency', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 2 }], description: 'Maximum consecutive positive NAV return periods inside the rolling window.' },
  { type: 'fund_return_skewness', category: 'fund_return_distribution', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }], description: 'Rolling NAV return skewness; positive values indicate right-tailed fund returns and negative values indicate downside asymmetry.' },
  { type: 'fund_return_kurtosis', category: 'fund_return_distribution', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }], description: 'Rolling NAV return excess kurtosis; higher values indicate fatter-tailed fund return risk.' },
  { type: 'fund_value_at_risk', category: 'fund_tail_loss_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }, { name: 'confidence', type: 'number', default: 95, min: 50, max: 99.9, lookback: false }], description: 'NAV historical Value at Risk based on rolling fund returns, expressed as a positive loss percentage.' },
  { type: 'fund_conditional_value_at_risk', category: 'fund_tail_loss_risk', source: 'nav', requiredFields: ['date', 'nav'], defaultPeriod: 60, scoreDirection: -1, parameterSchema: [{ name: 'period', type: 'integer', default: 60, min: 5 }, { name: 'confidence', type: 'number', default: 95, min: 50, max: 99.9, lookback: false }], description: 'NAV Conditional Value at Risk / expected shortfall based on tail fund return losses.' },
  { type: 'money_yield', category: 'money_fund_yield', source: 'yield', requiredFields: ['date', 'moneyYield'], defaultPeriod: 7, description: 'Latest money-fund per-10k income evidence.' },
  { type: 'seven_day_yield', category: 'money_fund_yield', source: 'yield', requiredFields: ['date', 'sevenDayYield'], defaultPeriod: 7, description: 'Latest money-fund seven-day annualized yield evidence.' },
  { type: 'dca_interval', category: 'fund_observation', source: 'schedule', requiredFields: ['date'], defaultPeriod: 30, scoreDirection: 0, description: 'DCA observation cadence in days.' },
]

export const fundStrategyIndicators = new Set<string>(fundStrategyIndicatorCatalog)

export const fundIndicatorHelpCatalog = fundStrategyIndicatorRegistry.map((definition) => ({
  type: definition.type,
  category: definition.category,
  source: definition.source,
  defaultPeriod: definition.defaultPeriod,
  requiredFields: definition.requiredFields,
  scoreDirection: definition.scoreDirection ?? 1,
  executable: true,
  parameterSchema: definition.parameterSchema ?? [{ name: 'period', type: 'integer', default: definition.defaultPeriod, min: 1 }],
  ...(definition.description ? { description: definition.description } : {}),
}))

export function fundIndicatorCatalogByCategory(): Record<string, Array<Record<string, unknown>>> {
  return fundIndicatorHelpCatalog.reduce<Record<string, Array<Record<string, unknown>>>>((grouped, item) => {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
    return grouped
  }, {})
}

export function fundIndicatorDefinition(type: string): FundStrategyIndicatorDefinition | undefined {
  return fundStrategyIndicatorRegistry.find((definition) => definition.type === type)
}

export const allowedIndicators = new Set(indicatorRegistry.map((definition) => definition.type))

export const executableIndicators = new Set(
  indicatorRegistry
    .filter((definition) => definition.executable !== false)
    .map((definition) => definition.type),
)

export const indicatorHelpCatalog = indicatorRegistry.map((definition) => ({
  type: definition.type,
  category: definition.category ?? 'technical',
  defaultPeriod: definition.defaultPeriod,
  lookbackBars: lookbackBarsFor(definition),
  requiredFields: definition.requiredFields ?? ['close'],
  executable: definition.executable !== false,
  parameterSchema: parameterSchemaFor(definition),
  ...(definition.description ? { description: definition.description } : {}),
}))

export function indicatorCatalogByCategory(): Record<string, Array<Record<string, unknown>>> {
  return indicatorHelpCatalog.reduce<Record<string, Array<Record<string, unknown>>>>((grouped, item) => {
    const category = String(item.category ?? 'technical')
    if (!grouped[category]) grouped[category] = []
    grouped[category].push(item)
    return grouped
  }, {})
}

function parameterSchemaFor(definition: StrategyIndicatorDefinition): Array<Record<string, unknown>> {
  if (definition.parameterSchema) return definition.parameterSchema
  if (definition.usesPeriodParameter === false) return []
  return [{ name: 'period', type: 'integer', default: definition.defaultPeriod, min: 1 }]
}

export function lookbackBarsFor(definition: StrategyIndicatorDefinition): number {
  if (typeof definition.lookbackBarsOverride === 'number' && Number.isFinite(definition.lookbackBarsOverride)) {
    return Math.trunc(definition.lookbackBarsOverride)
  }
  const schema = parameterSchemaFor(definition)
  if (schema.length === 0) return definition.usesPeriodParameter === false ? 1 : definition.defaultPeriod
  return schema.reduce((max, entry) => {
    if (entry.lookback === false) return max
    const value = entry.default
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(max, Math.trunc(value)) : max
  }, definition.usesPeriodParameter === false ? 1 : definition.defaultPeriod)
}

export function indicatorDefinition(type: string): StrategyIndicatorDefinition | undefined {
  return indicatorRegistry.find((definition) => definition.type === type)
}

export function parseIndicatorRef(raw: string): StrategyIndicatorRef {
  const text = raw.trim()
  if (/^close(?:_?\d+)?$/.test(text)) return { type: 'close', period: 0, id: 'close' }
  const registered = parseRegisteredIndicator(text)
  if (registered) return registered
  if (text === 'volume') return { type: 'volume', period: 20, id: 'volume' }
  return makeRef(text, text === 'volume_sma' ? 20 : 14)
}

export function parseRegisteredIndicator(text: string): StrategyIndicatorRef | null {
  for (const definition of indicatorRegistry) {
    for (const alias of definition.aliases) {
      const match = text.match(new RegExp(`^(?:${alias})_?(\\d+)?$`))
      if (!match) continue
      return makeRef(definition.type, Number(match[1]) || definition.defaultPeriod)
    }
  }
  return null
}

export function makeRef(type: string, period: number): StrategyIndicatorRef {
  if (type.includes('news') || type.includes('sentiment') || type.includes('盘口') || type.includes('资金')) {
    return { type, period, id: type }
  }
  if (type === 'close') return { type, period: 0, id: 'close' }
  return { type, period, id: type === 'volume_sma' ? `vol${period}` : `${type}${period}` }
}
