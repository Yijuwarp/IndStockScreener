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
}

export interface RefreshStatus {
  refreshing: boolean;
  data_as_of: string | null;
}

export interface ScreenerCriteria {
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
}
