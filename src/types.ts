export type HiddenField = 'cost' | 'diff' | 'duration' | 'model' | 'cwd' | 'branch' | 'delta' | 'brl';

export interface StatuslineInput {
  context_window: {
    used_percentage: number;
  };
  cwd?: string;
  model?: {
    display_name?: string;
  };
  cost?: {
    total_lines_added?: number;
    total_lines_removed?: number;
    total_cost_usd?: number;
    total_duration_ms?: number;
  };
}

export interface BarStyle {
  readonly name: string;
  readonly filled: string;
  readonly empty: string;
  readonly width: number;
  readonly separator: string;
  readonly resetIcon: string;
}

export interface RateLimitBucket {
  utilization: number;
  resets_at: string;
}

export interface CachedUsage {
  five_hour: RateLimitBucket | null;
  seven_day: RateLimitBucket | null;
  fetched_at: number;
}

export interface CostDeltaCache {
  prev_total: number;
  timestamp: number;
}

export interface BrlRateCache {
  rate: number;
  fetched_at: number;
}

export interface JSONOutput {
  model: string | null;
  cwd: string | null;
  git_branch: string | null;
  session: {
    utilization_pct: number;
    resets_at: null;
    remaining: string;
  };
  five_hour: {
    utilization_pct: number;
    resets_at: string | null;
    remaining: string;
  };
  seven_day: {
    utilization_pct: number;
    resets_at: string | null;
    remaining: string;
  };
  diff: {
    added: number;
    removed: number;
  };
  cost_usd: number | null;
  last_task_cost_usd: number | null;
  all_panes_cost_usd: number | null;
  brl_rate: number | null;
  duration_min: number | null;
}
