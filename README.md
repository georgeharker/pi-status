# pi-title

A [pi](https://pi.dev) extension that sets your terminal's tab title from parts you
choose: session name, folder, model, thinking level, git branch, the tool running now,
and a few more. It changes the title only when one of those parts changes.

```text
π - fix-login-redirect - my-project
π | claude-opus-5-5 | my-session | my-project | high | feat/config
```

It does not show whether pi is busy. pi can already show that as a progress indicator
in the tab (OSC 9;4, which Ghostty and some other terminals support). Turn it on in
pi's `settings.json`:

```json
{ "terminal": { "showTerminalProgress": true } }
```

## Install

```bash
pi install npm:@geohar/pi-title
```

Or try it for one run:

```bash
pi -e npm:@geohar/pi-title
```

## Commands

`/pi-title` opens a settings list, in the same style as pi's `/settings`:

- **Status**: on or off for this session (Enter or Space switches it)
- **Components**: what the title shows and in what order
- **Separator**: the text placed between components
- **Reset to defaults**: asks before restoring the default components and separator

Esc closes a submenu, then the list.

Each part can also be opened directly:

```text
/pi-title              open the settings
/pi-title on           turn the title on for this session
/pi-title off          turn it off; pi's own title comes back on its next update
/pi-title components   choose and reorder components
/pi-title separator    change the separator (up to 5 characters)
/pi-title reset        restore the defaults
```

### Components

The picker shows a live preview of the title above the list.

- `↑` / `↓` move through the list
- `Enter` / `Space` turns a component on or off
- `Ctrl+↑` / `Ctrl+↓` moves it up or down (the title follows the list's order)
- `Esc` saves and closes

| ID             | Shows                                        | Default |
|----------------|----------------------------------------------|---------|
| `pi_symbol`    | π                                            | on      |
| `session`      | Session name                                 | on      |
| `cwd`          | Working directory's folder name              | on      |
| `model`        | Current model                                | off     |
| `thinking`     | Thinking level                               | off     |
| `tokens`       | Context token usage                          | off     |
| `turn`         | Turn number, while the agent is working      | off     |
| `git_branch`   | Current git branch                           | off     |
| `tools_count`  | Number of active tools                       | off     |
| `current_tool` | The tool running right now                   | off     |

The default separator is `" - "`.

## Configuration

The settings live in their own file, never in pi's `settings.json`:

- `~/.pi/agent/pi-title.json` (in `$PI_CODING_AGENT_DIR` when that is set). This is the
  only file `/pi-title` writes.
- `.pi/pi-title.json` in a project. When present it is read instead of the global file.
  You edit it by hand.

```json
{
  "separator": " | ",
  "components": [
    { "id": "pi_symbol", "enabled": true },
    { "id": "model", "enabled": true },
    { "id": "session", "enabled": true },
    { "id": "cwd", "enabled": true },
    { "id": "thinking", "enabled": true },
    { "id": "git_branch", "enabled": true }
  ]
}
```

Components you leave out are added after the ones you list, in their default state.

To start pi with the title turned off:

```bash
PI_TITLE_DISABLED=1 pi
```

`1`, `true`, `yes` and `on` all count.

### Coming from pi-status

pi-title began as a fork of pi-status. If you used pi-status, your settings carry over:
a `pi-status.json` is read when there is no `pi-title.json` next to it, and
`PI_STATUS_DISABLED` still works. The first change you save goes to `pi-title.json`.
Uninstall `@thinkscape/pi-status` so the two don't both set the title.

## Credits

pi-title is based on [pi-status](https://github.com/Thinkscape/pi-status) by
[Thinkscape](https://github.com/Thinkscape), MIT licensed. It keeps pi-status's
title components and its component picker. It drops the spinner and the
Ghostty-specific code, because pi now shows progress itself. It also moves the settings
out of pi's `settings.json` into their own file, and rebuilds the menu on pi's settings
components.

## Development

```bash
bun install
bun run check   # tsc
bun test
```

## Releasing

```bash
bun run release:patch   # check, bump, commit, tag (also :minor / :major)
git push origin main --tags
```

Pushing a `v*` tag publishes to npm through trusted publishing and creates a GitHub
release. CI runs the type check, the tests and a dry-run pack on every push and pull
request.
