export interface Stock {
  id: number;
  symbol: string;
  exchange: string;
  name: string;
  current_price: number | null;
  current_volume: number | null;
  market_cap: number | null;
  all_time_high: number | null;
  all_time_high_date: string | null;
  week_52_high: number | null;
  week_52_high_date: string | null;
  last_updated: string | null;
  weekly_close: number | null;
  weekly_volume: number | null;
  weekly_pct_change: number | null;
  breakout_count: number | null;
  breakout_week: string | null;
  breakout_level: number | null;
  consolidation_weeks: number | null;
  consolidation_range_pct: number | null;
  extension_pct: number | null;
  breakout_age_weeks: number | null;
  avg_weekly_volume: number | null;
  breakout_volume_ratio: number | null;
  cap_category: string | null;
  weeks_of_history: number | null;
  listing_date: string | null;
  stock_age_days: number | null;
  ema_21d: number | null;
  ema_50d: number | null;
  ema_200d: number | null;
  ema_10w: number | null;
  has_resistance: boolean | null;
  volume_dry_up: boolean | null;
  sector: string | null;
  industry: string | null;
  revenue_growth: number | null;
  earnings_growth: number | null;
  circuit_trap: boolean | null;
  circuit_trap_weeks: number | null;
  exit_signal: boolean | null;
  pyramid_signal: boolean | null;
}

export interface MarketIndex {
  id: number;
  code: string;
  name: string;
  current_price: number | null;
  ema_21d: number | null;
  ema_50d: number | null;
  ema_200d: number | null;
  ema_300d: number | null;
  last_updated: string | null;
}

export interface RefreshStatus {
  refreshing: boolean;
  data_as_of: string | null;
}

export interface ScreenerCriteria {
  symbols?: string[];
  exchange?: string;
  min_market_cap?: number;
  max_market_cap?: number;
  min_volume?: number;
  max_volume?: number;
  min_price?: number;
  max_price?: number;
  pct_from_all_time_high_max?: number;
  pct_from_52_week_high_max?: number;
  new_all_time_high_this_week?: boolean;
  new_52_week_high_this_week?: boolean;
  basis?: "ATH" | "52W";
  min_consolidation_weeks?: number;
  max_consolidation_range_pct?: number;
  max_extension_pct?: number;
  max_breakout_age_weeks?: number;
  min_avg_weekly_volume?: number;
  min_breakout_volume_ratio?: number;
  cap_category?: string;
  exclude_young_stocks?: boolean;
  min_history_weeks?: number;
  resistance?: "yes" | "no";
  min_stock_age_days?: number;
  max_stock_age_days?: number;
}
