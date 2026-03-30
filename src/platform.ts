import { join } from 'path';
import { homedir, platform } from 'os';

export type Platform = 'darwin' | 'linux' | 'win32';

export function getPlatform(): Platform {
  const p = platform();
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p;
  return 'linux'; // fallback
}

export function getCachePath(): string {
  const p = getPlatform();
  const home = homedir();
  if (p === 'win32') {
    const appData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(appData, 'claude-usage-line', 'cache.json');
  }
  if (p === 'darwin') {
    return join(home, 'Library', 'Caches', 'claude-usage-line', 'cache.json');
  }
  const xdgCache = process.env.XDG_CACHE_HOME || join(home, '.cache');
  return join(xdgCache, 'claude-usage-line', 'cache.json');
}

export function getCostDeltaPath(): string {
  const p = getPlatform();
  const home = homedir();
  if (p === 'win32') {
    const appData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(appData, 'claude-usage-line', 'cost-delta.json');
  }
  if (p === 'darwin') {
    return join(home, 'Library', 'Caches', 'claude-usage-line', 'cost-delta.json');
  }
  const xdgCache = process.env.XDG_CACHE_HOME || join(home, '.cache');
  return join(xdgCache, 'claude-usage-line', 'cost-delta.json');
}

export function getBrlRatePath(): string {
  const p = getPlatform();
  const home = homedir();
  if (p === 'win32') {
    const appData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(appData, 'claude-usage-line', 'brl-rate.json');
  }
  if (p === 'darwin') {
    return join(home, 'Library', 'Caches', 'claude-usage-line', 'brl-rate.json');
  }
  const xdgCache = process.env.XDG_CACHE_HOME || join(home, '.cache');
  return join(xdgCache, 'claude-usage-line', 'brl-rate.json');
}

export function getPanesDir(): string {
  const p = getPlatform();
  const home = homedir();
  if (p === 'win32') {
    const appData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(appData, 'claude-usage-line', 'panes');
  }
  if (p === 'darwin') {
    return join(home, 'Library', 'Caches', 'claude-usage-line', 'panes');
  }
  const xdgCache = process.env.XDG_CACHE_HOME || join(home, '.cache');
  return join(xdgCache, 'claude-usage-line', 'panes');
}

export function getCredentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json');
}

export function getSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}
