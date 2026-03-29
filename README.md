# claude-usage-line

[![npm](https://img.shields.io/npm/v/claude-usage-line)](https://npmjs.com/package/claude-usage-line)
[![license](https://img.shields.io/npm/l/claude-usage-line)](LICENSE)
[![node](https://img.shields.io/node/v/claude-usage-line)](package.json)

<img width="663" height="141" alt="Screenshot 2026-03-29 at 20 19 21" src="https://github.com/user-attachments/assets/d78c061c-c263-4252-aed9-f1c4252cf94d" />

Cross-platform Claude Code statusline — session context, 5-hour & 7-day rate limits, git branch, diff stats, cost, and duration. Zero runtime dependencies, no `jq` required.

**Full output** (when Claude Code sends extended data):

```
~/dev/project  main
Opus 4.6 │ Session █████░░░ 62% │ 5h ████░░░░ 48% ⟳3h28m │ 7d █████░░░ 63% ⟳22h30m │ +123 -45 │ $0.50 │ 12m
```

**Minimal output** (backward compatible — only `context_window` provided):

```
Session █████░░░ 62% │ 5h ████░░░░ 48% ⟳3h28m │ 7d █████░░░ 63% ⟳22h30m
```

## Prerequisites

- Node.js ≥ 18
- Claude Code with statusline support
- **OAuth login** — required for rate limit data (5h / 7d bars). Session bar works without it.

## Quick Start

```bash
npx claude-usage-line setup
```

Or manually add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "npx claude-usage-line"
  }
}
```

Custom bar style:

```json
{
  "statusLine": {
    "type": "command",
    "command": "npx claude-usage-line --style dot"
  }
}
```

Restart Claude Code and the statusline appears.

## How It Works

```
Claude Code                      claude-usage-line
    │                                   │
    │  stdin: {                         │
    │    "context_window": {...},        │
    │    "cwd": "/path",                │
    │    "model": {"display_name":".."},│
    │    "cost": {...}                  │
    │  }                                │
    ├──────────────────────────────────▶│
    │                                   ├─▶ Detect git branch (if cwd given)
    │                                   ├─▶ Read cached rate limits (60s TTL)
    │                                   ├─▶ If stale: background OAuth fetch
    │                                   │
    │  stdout: ANSI statusline          │
    │◀──────────────────────────────────┤
```

The tool accepts these fields via stdin JSON:

| Field | Required | Description |
|-------|----------|-------------|
| `context_window.used_percentage` | Yes | Session context usage % |
| `cwd` | No | Working directory → enables git branch detection |
| `model.display_name` | No | Model name shown on line 2 |
| `cost.total_lines_added` | No | Lines added (green) |
| `cost.total_lines_removed` | No | Lines removed (red) |
| `cost.total_cost_usd` | No | Session cost in USD |
| `cost.total_duration_ms` | No | Session duration |

When `cwd` or `model` is present → 2-line output. Otherwise → single-line (backward compatible).

Rate limit data comes from `https://api.anthropic.com/api/oauth/usage` via OAuth token. API key auth does not provide rate limit visibility — bars show `0%` and `--`.

## Bar Styles

| Style | Preview | Width |
|-------|---------|-------|
| `classic` (default) | `█████░░░` | 8 |
| `dot` | `●●●●●○○○` | 8 |
| `braille` | `⣿⣿⣿⣿⣿⣀⣀⣀` | 8 |
| `block` | `▰▰▰▰▰▰▱▱▱▱` | 10 |
| `ascii` | `#####-----` | 10 |
| `square` | `▪▪▪▪▪·····` | 10 |
| `pipe` | `┃┃┃┃┃╌╌╌` | 8 |

### Colors

Each bar changes color at thresholds:

- **< 50%**: base color (Session=magenta, 5h=cyan, 7d=green)
- **≥ 50%**: yellow
- **≥ 80%**: red

Additional: model name=magenta, cwd=blue, branch=green, additions=green, removals=red, cost=yellow

## JSON Output

```bash
echo '{"context_window":{"used_percentage":62}}' | npx claude-usage-line --json
```

```json
{
  "model": null,
  "cwd": null,
  "git_branch": null,
  "session": { "utilization_pct": 62, "resets_at": null, "remaining": "--" },
  "five_hour": { "utilization_pct": 48, "resets_at": "2026-02-26T14:00:00Z", "remaining": "3h28m" },
  "seven_day": { "utilization_pct": 63, "resets_at": "2026-02-28T00:00:00Z", "remaining": "22h30m" },
  "diff": { "added": 0, "removed": 0 },
  "cost_usd": null,
  "duration_min": null
}
```

## CLI Reference

```
Usage: claude-usage-line [options]
       claude-usage-line setup

Options:
  --style <name>  Bar style (classic, dot, braille, block, ascii, square, pipe)
  --hide <fields> Hide fields (comma-separated): cost,diff,duration,model,cwd,branch
  --json          Output JSON
  --help          Show help
  --version       Show version
```

### Hiding Fields

Use `--hide` to selectively hide parts of the output:

```json
{
  "statusLine": {
    "type": "command",
    "command": "npx claude-usage-line --hide cost,duration"
  }
}
```

Available fields: `cost`, `diff`, `duration`, `model`, `cwd`, `branch`

## Credential Resolution

OAuth token lookup order:

1. `CLAUDE_CODE_OAUTH_TOKEN` env var (consumed once, deleted from env)
2. macOS Keychain (`security find-generic-password`)
3. Linux `secret-tool` (requires D-Bus session — skipped in headless/Docker)
4. Windows Credential Manager (PasswordVault API via PowerShell)
5. `~/.claude/.credentials.json` (fallback)

## Development

```bash
npm run build
echo '{"context_window":{"used_percentage":62}}' | node dist/cli.js
echo '{"cwd":"/tmp","model":{"display_name":"Opus 4.6"},"context_window":{"used_percentage":85},"cost":{"total_lines_added":42,"total_lines_removed":10,"total_cost_usd":1.23,"total_duration_ms":3720000}}' | node dist/cli.js
```

## License

MIT
