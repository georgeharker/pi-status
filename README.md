# @thinkscape/pi-status

A [pi](https://github.com/badlogic/pi-mono) extension that sets the terminal tab title from **configurable components** (session name, folder, model, git branch, current tool, …). It rewrites the title only when something in it changes; for a busy indicator, use pi's terminal progress (below).

For a progress indicator in the tab (OSC 9;4, e.g. in Ghostty), use pi's own setting: `"terminal": { "showTerminalProgress": true }` in pi's `settings.json`.

![Demo](assets/demo.gif)

## Install

```bash
pi install @thinkscape/pi-status
```

Or test it for one run:

```bash
pi -e @thinkscape/pi-status
```

## Screenshots

### Main menu (`/pi-status`)

![Main menu](assets/screenshot-menu.png)

### Component picker (`/pi-status components`)

![Component picker](assets/screenshot-components.png)


## Commands

Typing `/pi-status` with no arguments opens its settings, in the same style as pi's `/settings`:

- **Status** — enabled/disabled (Enter/Space cycles it)
- **Components** — opens the component picker
- **Separator** — type a new separator (Enter on an empty field keeps the current one)
- **Reset to defaults** — restore the default config, after a confirmation

Esc closes a submenu, then the settings.

You can also invoke subcommands directly:

```text
/pi-status                open the settings
/pi-status status         open the settings
/pi-status on             enable pi-status for this session
/pi-status off            disable pi-status for this session
/pi-status components     open TUI to toggle & reorder status components
/pi-status separator      change the separator character between elements
/pi-status reset          restore default pi-status configuration
```

### `components` TUI

Opens an interactive picker with a **live preview** of the current title at the top. You can:

- **Toggle** components on/off with `Enter` or `Space`
- **Reorder** components with `Ctrl+↑` / `Ctrl+↓`
- **Navigate** the list with `↑` / `↓`
- **Exit** with `Escape`, which saves

The order in the list determines the display order in the tab title. Changes show in the title as you make them.

### Available components

| Component ID    | Description                           | Default |
|-----------------|---------------------------------------|---------|
| `pi_symbol`     | π symbol                              | on      |
| `session`       | Session name                          | on      |
| `cwd`           | Working directory basename            | on      |
| `model`         | Current model (e.g., `claude-sonnet-4-5`) | off  |
| `thinking`      | Thinking level (e.g., `high`)         | off     |
| `tokens`        | Context token usage                   | off     |
| `turn`          | Current turn number                   | off     |
| `git_branch`    | Current git branch name               | off     |
| `tools_count`   | Number of active tools                | off     |
| `current_tool`  | Currently executing tool name         | off     |

### `separator`

Prompts for a new separator string (max 5 characters). The separator is placed between each enabled component.

Default: `" - "`

### `reset`

Restores all pi-status configuration to the defaults shown above.

## Configuration

Settings are stored in their own file, `pi-status.json`, in pi's agent dir:

- `~/.pi/agent/pi-status.json` (global; in `$PI_CODING_AGENT_DIR` when that is set). This is the only file `/pi-status` writes.
- `.pi/pi-status.json` (project-local, read instead of the global file; never written)

pi's own `settings.json` is never read or written. A config from an older version (a `piStatus` key in pi's `settings.json`) can be moved by hand: its value is the contents of `pi-status.json`.

Example with custom separator and additional components:

```json
{
  "separator": " | ",
  "components": [
    { "id": "pi_symbol", "enabled": true },
    { "id": "model", "enabled": true },
    { "id": "session", "enabled": true },
    { "id": "cwd", "enabled": true },
    { "id": "thinking", "enabled": true },
    { "id": "git_branch", "enabled": true },
    { "id": "tokens", "enabled": false },
    { "id": "turn", "enabled": false },
    { "id": "tools_count", "enabled": false },
    { "id": "current_tool", "enabled": false }
  ]
}
```

This would produce: `π | claude-sonnet-4-5 | my-session | my-project | high | feat/config`

## Environment

Disable the extension by default:

```bash
PI_STATUS_DISABLED=1 pi
```

Accepted truthy values are `1`, `true`, `yes`, and `on`.

## Development

```bash
bun install
bun run check
```

## Releasing

```bash
# Bump version only (patch/minor/major)
bun run version:patch

# Full release: check → bump → commit → tag
bun run release:patch

# Then push the tag to trigger GitHub Actions auto-publish:
git push origin main --tags
```

CI runs on every PR (`bun run check` + dry-run pack). Tag pushes trigger the publish workflow to npm.
