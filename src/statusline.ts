import { GREEN, RED, YELLOW, BLUE, MAGENTA, CYAN, DIM, RST, dim } from './ansi.js';
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
  allPanesTotal: number | null;
}

function resolveUsage(input: StatuslineInput): ResolvedUsage {
  const cached = readCache();
  if (isCacheStale(cached)) {
    spawnBackgroundFetch();
  }

  return {
    sesPct: Math.floor(input.context_window.used_percentage ?? 0),
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
  if (!hide.has('total') && extras.allPanesTotal !== null && extras.allPanesTotal > 0) {
    let totalStr = CYAN + '∑ $' + extras.allPanesTotal.toFixed(2) + RST;
    if (!hide.has('brl') && extras.brlRate !== null) {
      totalStr += DIM + ' (R$' + (extras.allPanesTotal * extras.brlRate).toFixed(2) + ')' + RST;
    }
    parts.push(totalStr);
  }
  return parts;
}

function buildBarParts(style: BarStyle, usage: ResolvedUsage): string[] {
  const { sesPct, fhPct, wkPct, fhRemain, wkRemain } = usage;
  return [
    'Cx ' + renderBar(sesPct, MAGENTA, style),
    '5h ' + renderBar(fhPct, CYAN, style) + ' ' + DIM + CYAN + style.resetIcon + fhRemain + RST,
    '7d ' + renderBar(wkPct, GREEN, style) + ' ' + DIM + GREEN + style.resetIcon + wkRemain + RST,
  ];
}

function renderBarsLine(input: StatuslineInput, style: BarStyle, usage: ResolvedUsage, hide: Set<HiddenField>, extras: Extras): string {
  const sep = ' ' + dim(style.separator) + ' ';
  const extraParts = buildExtras(input, hide, sep, extras);
  const bars = buildBarParts(style, usage).join(sep);

  if (extraParts.length === 0) return bars;
  return extraParts.join(sep) + '\n' + bars;
}

export function renderStatusline(input: StatuslineInput, style: BarStyle, hide: Set<HiddenField> = new Set(), extras: Extras = { delta: null, brlRate: null, allPanesTotal: null }): string {
  const usage = resolveUsage(input);

  if (!hasExtendedInput(input)) {
    return renderBarsLine(input, style, usage, hide, extras);
  }

  const sep = ' ' + dim(style.separator) + ' ';
  const showCwd = !hide.has('cwd') && !!input.cwd;
  const showBranch = !hide.has('branch') && !!input.cwd;
  const branch = showBranch ? getGitBranch(input.cwd!) : null;

  // Line 1: cwd/branch + extras
  const line1Parts: string[] = [];
  if (showCwd) {
    let cwdPart = BLUE + shortenCwd(input.cwd!) + RST;
    if (branch) cwdPart += ' → ' + GREEN + branch + RST;
    line1Parts.push(cwdPart);
  } else if (branch) {
    line1Parts.push(GREEN + branch + RST);
  }
  line1Parts.push(...buildExtras(input, hide, sep, extras));

  // Line 2: model + bars
  const line2Parts: string[] = [];
  if (!hide.has('model') && input.model?.display_name) {
    line2Parts.push(MAGENTA + input.model.display_name + RST);
  }
  line2Parts.push(...buildBarParts(style, usage));

  const lines: string[] = [];
  if (line1Parts.length > 0) lines.push(line1Parts.join(sep));
  lines.push(line2Parts.join(sep));
  return lines.join('\n');
}

export function buildJSONOutput(input: StatuslineInput, hide: Set<HiddenField> = new Set(), extras: Extras = { delta: null, brlRate: null, allPanesTotal: null }): JSONOutput {
  const { sesPct, fhPct, wkPct, fhRemain, wkRemain, cached } = resolveUsage(input);
  const branch = !hide.has('branch') && input.cwd ? getGitBranch(input.cwd) : null;

  return {
    model: !hide.has('model') ? (input.model?.display_name ?? null) : null,
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
    all_panes_cost_usd: !hide.has('total') ? (extras.allPanesTotal ?? null) : null,
    brl_rate: !hide.has('brl') ? (extras.brlRate ?? null) : null,
    duration_min: !hide.has('duration') && typeof input.cost?.total_duration_ms === 'number'
      ? Math.floor(input.cost.total_duration_ms / 60_000)
      : null,
  };
}
