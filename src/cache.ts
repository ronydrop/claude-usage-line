import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync, openSync, writeSync, closeSync, lstatSync, constants } from 'fs';
import { dirname } from 'path';
import { request } from 'https';
import { join } from 'path';
import { getCachePath, getCostDeltaPath, getBrlRatePath, getPanesDir } from './platform.js';
import type { CachedUsage, RateLimitBucket, CostDeltaCache, BrlRateCache } from './types.js';

const CACHE_TTL = 60; // seconds
const LOCK_TTL = 30_000; // ms

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function safeWriteExclusive(path: string, data: string, mode: number): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, mode);
  try { writeSync(fd, data); } finally { closeSync(fd); }
}

export function isRateLimitBucket(v: unknown): v is RateLimitBucket {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.utilization === 'number' && typeof obj.resets_at === 'string';
}

function validateCached(raw: unknown): CachedUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.fetched_at !== 'number') return null;
  return {
    five_hour: isRateLimitBucket(obj.five_hour) ? obj.five_hour : null,
    seven_day: isRateLimitBucket(obj.seven_day) ? obj.seven_day : null,
    fetched_at: obj.fetched_at,
  };
}

export function readCache(): CachedUsage | null {
  try {
    const data = readFileSync(getCachePath(), 'utf-8');
    const parsed = JSON.parse(data);
    return validateCached(parsed);
  } catch {
    return null;
  }
}

export function isCacheStale(cached: CachedUsage | null): boolean {
  if (!cached) return true;
  return (Date.now() / 1000 - cached.fetched_at) >= CACHE_TTL;
}

export function writeCache(usage: CachedUsage): void {
  const cachePath = getCachePath();
  mkdirSync(dirname(cachePath), { recursive: true, mode: 0o700 });
  const tmp = cachePath + '.' + process.pid + '.tmp';
  try { unlinkSync(tmp); } catch {}
  safeWriteExclusive(tmp, JSON.stringify(usage), 0o600);
  renameSync(tmp, cachePath);
}

// --- Fetch lock (thundering herd prevention) ---

function getLockPath(): string {
  return getCachePath() + '.lock';
}

export function acquireFetchLock(): boolean {
  const lockPath = getLockPath();
  // Stale lock cleanup
  try {
    const st = statSync(lockPath);
    if (Date.now() - st.mtimeMs > LOCK_TTL) {
      try { unlinkSync(lockPath); } catch {}
    } else {
      return false;
    }
  } catch {}

  try {
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    safeWriteExclusive(lockPath, String(process.pid), 0o600);
    return true;
  } catch { return false; }
}

export function releaseFetchLock(): void {
  try {
    const lockPath = getLockPath();
    const st = lstatSync(lockPath);
    if (st.isSymbolicLink()) return;
    const content = readFileSync(lockPath, 'utf-8').trim();
    if (content === String(process.pid)) unlinkSync(lockPath);
  } catch {}
}

// --- Cost delta tracking ---

const COST_SESSION_TTL = 30 * 60 * 1000; // 30 minutes

export function readCostDelta(): CostDeltaCache | null {
  try {
    const data = readFileSync(getCostDeltaPath(), 'utf-8');
    const obj = JSON.parse(data);
    if (typeof obj.prev_total === 'number' && typeof obj.timestamp === 'number') {
      return obj as CostDeltaCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCostDelta(total: number): void {
  const path = getCostDeltaPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + '.' + process.pid + '.tmp';
  try { unlinkSync(tmp); } catch {}
  safeWriteExclusive(tmp, JSON.stringify({ prev_total: total, timestamp: Date.now() }), 0o600);
  renameSync(tmp, path);
}

export function computeCostDelta(currentTotal: number): number | null {
  const cached = readCostDelta();
  if (!cached) return null;
  if (Date.now() - cached.timestamp > COST_SESSION_TTL) return null;
  const delta = currentTotal - cached.prev_total;
  if (delta < 0) return null; // session reset
  return delta;
}

// --- BRL exchange rate ---

const BRL_RATE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const BRL_FETCH_TIMEOUT = 2000; // ms

function fetchBrlRateFromApi(): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'economia.awesomeapi.com.br', path: '/last/USD-BRL', timeout: BRL_FETCH_TIMEOUT },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const obj = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            const bid = parseFloat(obj?.USDBRL?.bid);
            if (Number.isFinite(bid) && bid > 0) resolve(bid);
            else reject(new Error('invalid rate'));
          } catch { reject(new Error('parse error')); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

export function getBrlRate(): number | null {
  const path = getBrlRatePath();
  // Try cache first
  try {
    const data = readFileSync(path, 'utf-8');
    const obj = JSON.parse(data) as BrlRateCache;
    if (typeof obj.rate === 'number' && typeof obj.fetched_at === 'number') {
      if (Date.now() - obj.fetched_at < BRL_RATE_TTL) return obj.rate;
      // Stale — fetch in background, return stale for now
      fetchBrlRateFromApi().then((rate) => {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, JSON.stringify({ rate, fetched_at: Date.now() }), { mode: 0o600 });
      }).catch(() => {});
      return obj.rate;
    }
  } catch {
    // No cache — try sync-style via immediate background fetch, return null for first render
    fetchBrlRateFromApi().then((rate) => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify({ rate, fetched_at: Date.now() }), { mode: 0o600 });
    }).catch(() => {});
    return null;
  }
  return null;
}

// --- Pane cost aggregation ---

const PANE_STALE_TTL = 60 * 60 * 1000; // 1 hour

export function writePaneCost(paneId: string, costUsd: number): void {
  const dir = getPanesDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, paneId + '.json');
  writeFileSync(path, JSON.stringify({ cost: costUsd, ts: Date.now() }), { mode: 0o600 });
}

export function readAllPanesCost(): number {
  const dir = getPanesDir();
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }
  const now = Date.now();
  let total = 0;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      if (typeof data.cost === 'number' && typeof data.ts === 'number') {
        if (now - data.ts < PANE_STALE_TTL) {
          total += data.cost;
        } else {
          try { unlinkSync(join(dir, f)); } catch {}
        }
      }
    } catch {}
  }
  return total;
}
