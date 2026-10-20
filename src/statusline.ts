import { GREEN, RED, YELLOW, BLUE, MAGENTA, CYAN, DIM, RST, dim, colorByThreshold } from './ansi.js';
import { renderBar } from './bar.js';
import { readCache, isCacheStale } from './cache.js';
import { formatRemaining } from './time.js';
import { spawnBackgroundFetch } from './usage-api.js';
import { getGitBranch } from './git.js';
import { homedir } from 'os';
import { sep as pathSep } from 'path';
import type { StatuslineInput, BarStyle, CachedUsage, JSONOutput, HiddenField } from './types.js';

interface ResolvedUsage {
  sesPct: number;
  fhPct: number;
  wkPct: number;
  fhRemain: string;
  wkRemain: string;
  cached: CachedUsage | null;
}

interface Extras {
  delta: number | null;
  brlRate: number | null;
}

function resolveUsage(input: StatuslineInput): ResolvedUsage {
  const cached = readCache();
  if (isCacheStale(cached)) {
    spawnBackgroundFetch();
  }

  let sesPct = Math.floor(input.context_window.used_percentage ?? 0);
  if (sesPct === 0 && input.context_window.context_window_size && input.context_window.current_usage) {
    const { input_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 } = input.context_window.current_usage;
    const total = input_tokens + cache_creation_input_tokens + cache_read_input_tokens;
    sesPct = Math.min(100, Math.floor((total / input.context_window.context_window_size) * 100));
  }

  return {
    sesPct,
    fhPct: Math.floor(cached?.five_hour?.utilization ?? 0),
    wkPct: Math.floor(cached?.seven_day?.utilization ?? 0),
    fhRemain: formatRemaining(cached?.five_hour?.resets_at),
    wkRemain: formatRemaining(cached?.seven_day?.resets_at),
    cached,
  };
}

function shortenCwd(cwd: string): string {
  const home = homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(home + pathSep)) return '~' + cwd.slice(home.length).replaceAll('\\', '/');
  return cwd;
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin === 0) return ms > 0 ? '<1m' : '0m';
  if (totalMin < 60) return totalMin + 'm';
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) {
    const m = totalMin % 60;
    return m > 0 ? `${totalH}h${m}m` : `${totalH}h`;
  }
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h > 0 ? `${d}d${h}h` : `${d}d`;
}

function getTerminalWidth(): number | null {
  const cols = process.stdout.columns || process.stderr.columns;
  if (typeof cols === 'number' && cols > 0) return Math.floor(cols);
  const envCols = parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isFinite(envCols) && envCols > 0) return envCols;
  return null;
}

function getTerminalHeight(): number | null {
  const rows = process.stdout.rows || process.stderr.rows;
  if (typeof rows === 'number' && rows > 0) return Math.floor(rows);
  const envRows = parseInt(process.env.LINES ?? '', 10);
  if (Number.isFinite(envRows) && envRows > 0) return envRows;
  return null;
}

function renderPct(pct: number, baseColor: string): string {
  return colorByThreshold(pct, baseColor) + Math.floor(pct) + '%' + RST;
}

const EFFORT_COLORS: Record<string, string> = {
  low: DIM + BLUE,
  medium: BLUE,
  high: YELLOW,
  xhigh: RED,
  max: RED,
};

function buildModelParts(input: StatuslineInput, hide: Set<HiddenField>): string[] {
  const parts: string[] = [];
  if (!hide.has('model') && input.model?.display_name) {
    parts.push(MAGENTA + input.model.display_name + RST);
  }
  if (!hide.has('effort') && input.effort) {
    parts.push((EFFORT_COLORS[input.effort.level] ?? DIM) + input.effort.level + RST);
  }
  return parts;
}

function hasExtendedInput(input: StatuslineInput): boolean {
  return !!(input.cwd || input.model);
}

function buildExtras(input: StatuslineInput, hide: Set<HiddenField>, sep: string, extras: Extras): string[] {
  const parts: string[] = [];
  if (input.cost) {
    const { total_lines_added, total_lines_removed, total_cost_usd, total_duration_ms } = input.cost;
    if (!hide.has('diff') && (typeof total_lines_added === 'number' || typeof total_lines_removed === 'number')) {
      const added = total_lines_added ?? 0;
      const removed = total_lines_removed ?? 0;
      parts.push(GREEN + '+' + added + RST + ' ' + RED + '-' + removed + RST);
    }
    if (!hide.has('cost') && typeof total_cost_usd === 'number') {
      let costStr = YELLOW + '$' + total_cost_usd.toFixed(2) + RST;
      if (!hide.has('brl') && extras.brlRate !== null) {
        costStr += DIM + ' (R$' + (total_cost_usd * extras.brlRate).toFixed(2) + ')' + RST;
      }
      parts.push(costStr);

      if (!hide.has('delta') && extras.delta !== null && extras.delta > 0) {
        const decimals = extras.delta < 0.10 ? 3 : 2;
        let deltaStr = DIM + YELLOW + '$' + extras.delta.toFixed(decimals) + RST;
        if (!hide.has('brl') && extras.brlRate !== null) {
          deltaStr += DIM + ' (R$' + (extras.delta * extras.brlRate).toFixed(2) + ')' + RST;
        }
        parts.push(deltaStr);
      }
    }
    if (!hide.has('duration') && typeof total_duration_ms === 'number' && total_duration_ms > 0) {
      parts.push(DIM + BLUE + '⏱ ' + formatDuration(total_duration_ms) + RST);
    }
  }
  return parts;
}

function buildBarParts(style: BarStyle, usage: ResolvedUsage, barWidth: number): string[] {
  const { sesPct, fhPct, wkPct, fhRemain, wkRemain } = usage;
  const s = { ...style, width: barWidth };
  if (barWidth === 0) {
    return [
      'Cx ' + renderPct(sesPct, MAGENTA),
      '5h ' + renderPct(fhPct, CYAN) + ' ' + DIM + CYAN + style.resetIcon + fhRemain + RST,
      '7d ' + renderPct(wkPct, GREEN) + ' ' + DIM + GREEN + style.resetIcon + wkRemain + RST,
    ];
  }
  return [
    'Cx ' + renderBar(sesPct, MAGENTA, s),
    '5h ' + renderBar(fhPct, CYAN, s) + ' ' + DIM + CYAN + style.resetIcon + fhRemain + RST,
    '7d ' + renderBar(wkPct, GREEN, s) + ' ' + DIM + GREEN + style.resetIcon + wkRemain + RST,
  ];
}

// Returns the last N segments of the path, always prefixed with ~/ if applicable
function truncateCwd(cwd: string, maxLen: number): string {
  const shortened = shortenCwd(cwd);
  if (shortened.length <= maxLen) return shortened;
  const parts = shortened.replace(/\\/g, '/').split('/').filter(Boolean);
  // Always show at least the last segment
  for (let take = 1; take <= parts.length; take++) {
    const candidate = (shortened.startsWith('~') ? '~/' : '/') + parts.slice(-take).join('/');
    if (candidate.length <= maxLen || take === parts.length) return candidate;
  }
  return parts[parts.length - 1] ?? shortened;
}

export function renderStatusline(input: StatuslineInput, style: BarStyle, hide: Set<HiddenField> = new Set(), extras: Extras = { delta: null, brlRate: null }): string {
  const usage = resolveUsage(input);
  const termWidth = getTerminalWidth();
  const sep = ' ' + dim(style.separator) + ' ';

  // Compute adaptive bar width.
  // Full line 2 overhead (no bars): model(~12) + effort(~6) + 4 seps(12) + labels+pcts("Cx 100%"=7, "5h 100% ⟳3h26m"=15, "7d 100% ⟳3h26m"=15) = ~67
  // Each bar adds `barWidth` chars × 3 bars = 3*barWidth total.
  const LINE2_OVERHEAD = 67;
  let barWidth = style.width;
  if (termWidth !== null) {
    const available = termWidth - LINE2_OVERHEAD;
    barWidth = Math.max(0, Math.min(style.width, Math.floor(available / 3)));
  }

  const termHeight = getTerminalHeight();
  // Collapse to 1 line when pane is short (< 8 rows) or very narrow (< 45 cols)
  const compact = (termHeight !== null && termHeight < 8) || (termWidth !== null && termWidth < 45);

  if (!hasExtendedInput(input)) {
    const extraParts = buildExtras(input, hide, sep, extras);
    const bars = buildBarParts(style, usage, barWidth).join(sep);
    if (extraParts.length === 0) return bars;
    if (compact) return [...extraParts, bars].join(sep);
    return extraParts.join(sep) + '\n' + bars;
  }

  if (compact) {
    const parts: string[] = [];
    parts.push(...buildModelParts(input, hide));
    parts.push(...buildBarParts(style, usage, barWidth));
    parts.push(...buildExtras(input, hide, sep, extras));
    return parts.join(sep);
  }

  const showCwd = !hide.has('cwd') && !!input.cwd;
  const showBranch = !hide.has('branch') && !!input.cwd;
  const branch = showBranch ? getGitBranch(input.cwd!) : null;

  // Line 1: cwd/branch + extras
  const line1Parts: string[] = [];
  if (showCwd) {
    const maxCwdLen = termWidth ? Math.max(10, termWidth - 30) : 60;
    let cwdPart = BLUE + truncateCwd(input.cwd!, maxCwdLen) + RST;
    if (branch) cwdPart += ' → ' + GREEN + branch + RST;
    line1Parts.push(cwdPart);
  } else if (branch) {
    line1Parts.push(GREEN + branch + RST);
  }
  line1Parts.push(...buildExtras(input, hide, sep, extras));

  // Line 2: model + bars (always present)
  const line2Parts: string[] = [];
  line2Parts.push(...buildModelParts(input, hide));
  line2Parts.push(...buildBarParts(style, usage, barWidth));

  const lines: string[] = [];
  if (line1Parts.length > 0) lines.push(line1Parts.join(sep));
  lines.push(line2Parts.join(sep));
  return lines.join('\n');
}

export function buildJSONOutput(input: StatuslineInput, hide: Set<HiddenField> = new Set(), extras: Extras = { delta: null, brlRate: null }): JSONOutput {
  const { sesPct, fhPct, wkPct, fhRemain, wkRemain, cached } = resolveUsage(input);
  const branch = !hide.has('branch') && input.cwd ? getGitBranch(input.cwd) : null;

  return {
    model: !hide.has('model') ? (input.model?.display_name ?? null) : null,
    effort: !hide.has('effort') ? (input.effort?.level ?? null) : null,
    cwd: !hide.has('cwd') ? (input.cwd ?? null) : null,
    git_branch: branch,
    session: {
      utilization_pct: sesPct,
      resets_at: null,
      remaining: '--',
    },
    five_hour: {
      utilization_pct: fhPct,
      resets_at: cached?.five_hour?.resets_at ?? null,
      remaining: fhRemain,
    },
    seven_day: {
      utilization_pct: wkPct,
      resets_at: cached?.seven_day?.resets_at ?? null,
      remaining: wkRemain,
    },
    diff: {
      added: !hide.has('diff') ? (input.cost?.total_lines_added ?? 0) : 0,
      removed: !hide.has('diff') ? (input.cost?.total_lines_removed ?? 0) : 0,
    },
    cost_usd: !hide.has('cost') ? (input.cost?.total_cost_usd ?? null) : null,
    last_task_cost_usd: !hide.has('cost') && !hide.has('delta') ? (extras.delta ?? null) : null,
    all_panes_cost_usd: null,
    brl_rate: !hide.has('brl') ? (extras.brlRate ?? null) : null,
    duration_min: !hide.has('duration') && typeof input.cost?.total_duration_ms === 'number'
      ? Math.floor(input.cost.total_duration_ms / 60_000)
      : null,
  };
}
