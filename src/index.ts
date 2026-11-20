import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Text, matchesKey, Key } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComponentConfig {
  id: string;
  enabled: boolean;
}

interface PiStatusConfig {
  separator: string;
  components: ComponentConfig[];
}

type RuntimeState = {
  enabled: boolean;
  running: boolean;
  destroyed: boolean;
  /** A pending re-apply of the title on the next tick (see reapplySoon). */
  reapplyTimer: ReturnType<typeof setTimeout> | undefined;
  turnIndex: number;
  modelName: string;
  thinkingLevel: string;
  gitBranch: string;
  tokenUsage: number;
  currentTool: string;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DISABLE_ENV = "PI_STATUS_DISABLED";

const ALL_COMPONENT_IDS = [
  "pi_symbol",
  "session",
  "cwd",
  "model",
  "thinking",
  "tokens",
  "turn",
  "git_branch",
  "tools_count",
  "current_tool",
] as const;

type ComponentId = (typeof ALL_COMPONENT_IDS)[number];

const COMPONENT_LABELS: Record<ComponentId, string> = {
  pi_symbol: "π symbol",
  session: "Session name",
  cwd: "Working directory",
  model: "Current model",
  thinking: "Thinking level",
  tokens: "Token usage",
  turn: "Turn number",
  git_branch: "Git branch",
  tools_count: "Active tool count",
  current_tool: "Current tool name",
};

const DEFAULT_CONFIG: PiStatusConfig = {
  separator: " - ",
  components: [
    { id: "pi_symbol", enabled: true },
    { id: "session", enabled: true },
    { id: "cwd", enabled: true },
    { id: "model", enabled: false },
    { id: "thinking", enabled: false },
    { id: "tokens", enabled: false },
    { id: "turn", enabled: false },
    { id: "git_branch", enabled: false },
    { id: "tools_count", enabled: false },
    { id: "current_tool", enabled: false },
  ],
};

// ---------------------------------------------------------------------------
// Config persistence: pi-status.json, its own file in pi's agent dir
// ---------------------------------------------------------------------------
//
// The config lives in <agent dir>/pi-status.json (pi's getAgentDir:
// PI_CODING_AGENT_DIR, else ~/.pi/agent), the only file /pi-status writes.
// A project's .pi/pi-status.json, if present, is read instead (a per-project
// override, never written). pi's own settings.json is never read or written.

function getConfigPaths(): { global: string; project: string } {
  return {
    global: path.join(getAgentDir(), "pi-status.json"),
    project: path.join(process.cwd(), ".pi", "pi-status.json"),
  };
}

function loadJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The stored config object: the project file, else the global file. */
function readStoredConfig(): PiStatusConfig | undefined {
  const { global, project } = getConfigPaths();
  const own = loadJsonSafe(project) ?? loadJsonSafe(global);
  return own ? (own as unknown as PiStatusConfig) : undefined;
}

function readPiStatusConfig(): PiStatusConfig {
  const raw = readStoredConfig();
  if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_CONFIG);

  const separator = typeof raw.separator === "string" ? raw.separator : DEFAULT_CONFIG.separator;

  const rawComponents = Array.isArray(raw.components) ? raw.components : [];
  // Build component list: preserve order from user config, append any missing
  // components from ALL_COMPONENT_IDS at the end, in their default state.
  const existing = new Map(rawComponents.map((c) => [c.id, c.enabled]));
  const components: ComponentConfig[] = [];
  for (const c of rawComponents) {
    if (typeof c.id === "string" && ALL_COMPONENT_IDS.includes(c.id as ComponentId)) {
      components.push({ id: c.id, enabled: c.enabled !== false });
    }
  }
  for (const id of ALL_COMPONENT_IDS) {
    if (!existing.has(id)) {
      components.push({ id, enabled: DEFAULT_CONFIG.components.find((d) => d.id === id)?.enabled ?? false });
    }
  }

  return { separator, components };
}

function writePiStatusConfig(config: PiStatusConfig): void {
  const { global } = getConfigPaths();
  mkdirSync(path.dirname(global), { recursive: true });
  writeFileSync(global, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function isDisabledByEnv(): boolean {
  const value = process.env[DISABLE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

// ---------------------------------------------------------------------------
// Component value resolvers
// ---------------------------------------------------------------------------

function resolveComponentValue(
  id: ComponentId,
  state: RuntimeState,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): string {
  switch (id) {
    case "pi_symbol":
      return "π";
    case "session": {
      const name = pi.getSessionName();
      return name || "";
    }
    case "cwd": {
      try {
        return path.basename(ctx.cwd || process.cwd());
      } catch {
        return "";
      }
    }
    case "model":
      return state.modelName || "";
    case "thinking":
      return state.thinkingLevel || "";
    case "tokens": {
      if (!state.tokenUsage) return "";
      if (state.tokenUsage >= 1000) return `${(state.tokenUsage / 1000).toFixed(1)}k`;
      return `${state.tokenUsage}`;
    }
    case "turn":
      return state.running ? `${state.turnIndex}` : "";
    case "git_branch":
      return state.gitBranch || "";
    case "tools_count": {
      try {
        const count = pi.getActiveTools().length;
        return count ? `${count}t` : "";
      } catch {
        return "";
      }
    }
    case "current_tool":
      return state.currentTool || "";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Title builder
// ---------------------------------------------------------------------------

async function refreshGitBranch(state: RuntimeState, pi: ExtensionAPI): Promise<void> {
  try {
    const result = await pi.exec("git", ["branch", "--show-current"], { timeout: 3000 });
    if (result.code === 0) {
      state.gitBranch = result.stdout.trim();
    } else {
      state.gitBranch = "";
    }
  } catch {
    state.gitBranch = "";
  }
}

function buildTitle(config: PiStatusConfig, state: RuntimeState, pi: ExtensionAPI, ctx: ExtensionContext): string {
  const parts: string[] = [];
  for (const comp of config.components) {
    if (!comp.enabled) continue;
    const value = resolveComponentValue(comp.id as ComponentId, state, pi, ctx);
    if (value) {
      parts.push(value);
    }
  }
  return parts.join(config.separator);
}

function setTitle(config: PiStatusConfig, state: RuntimeState, pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (state.destroyed) return;
  if (!ctx.hasUI) return;
  ctx.ui.setTitle(buildTitle(config, state, pi, ctx));
}

// ---------------------------------------------------------------------------
// Main extension
// ---------------------------------------------------------------------------

export default function piStatus(pi: ExtensionAPI) {
  let config = readPiStatusConfig();

  const state: RuntimeState = {
    enabled: !isDisabledByEnv(),
    running: false,
    destroyed: false,
    reapplyTimer: undefined,
    turnIndex: 0,
    modelName: "",
    thinkingLevel: "",
    gitBranch: "",
    tokenUsage: 0,
    currentTool: "",
  };

  try {
    state.thinkingLevel = pi.getThinkingLevel() ?? "";
  } catch {
    // ignore
  }

  const live = (ctx: ExtensionContext): boolean => !state.destroyed && state.enabled && ctx.hasUI;

  function refresh(ctx: ExtensionContext): void {
    if (live(ctx)) setTitle(config, state, pi, ctx);
  }

  /** Re-apply the title on the next tick. pi writes its own title around
   *  some events (after extensions' session_start, on a session rename via
   *  session_info_changed, on a model switch), so a title set inside the
   *  handler can be overwritten straight away. */
  function reapplySoon(ctx: ExtensionContext): void {
    if (state.reapplyTimer) clearTimeout(state.reapplyTimer);
    state.reapplyTimer = setTimeout(() => {
      state.reapplyTimer = undefined;
      refresh(ctx);
    }, 0);
  }

  function clearTimers(): void {
    if (state.reapplyTimer) clearTimeout(state.reapplyTimer);
    state.reapplyTimer = undefined;
  }

  /** The agent started working. The title is rewritten only when something
   *  in it changes (a turn, a tool); busy state is pi's own terminal
   *  progress (terminal.showTerminalProgress). */
  function start(ctx: ExtensionContext): void {
    clearTimers();
    state.running = true;
    state.currentTool = "";
    state.turnIndex = 1;
    refresh(ctx);
  }

  /** The agent is idle: show the idle title. */
  function stop(ctx: ExtensionContext): void {
    clearTimers();
    state.running = false;
    state.currentTool = "";
    refresh(ctx);
    reapplySoon(ctx);
  }

  /** Turn pi-status on or off for this session. Off hands the title back to
   *  pi's own format on its next update. */
  function setEnabled(ctx: ExtensionContext, enabled: boolean): void {
    state.enabled = enabled;
    if (!enabled) {
      clearTimers();
      return;
    }
    if (state.running) start(ctx);
    else {
      refresh(ctx);
      reapplySoon(ctx);
    }
  }

  // ── Lifecycle events ──────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    if (state.destroyed) return;
    // Re-read config on session start (may have changed between sessions)
    config = readPiStatusConfig();
    if (!state.enabled) return;
    await refreshGitBranch(state, pi);
    if (ctx.model) state.modelName = ctx.model.id || ctx.model.provider;
    try {
      state.thinkingLevel = pi.getThinkingLevel() ?? "";
    } catch {
      // ignore
    }
    refresh(ctx);
    reapplySoon(ctx);
  });

  pi.on("session_info_changed", async (_event, ctx) => {
    if (state.destroyed) return;
    reapplySoon(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (state.destroyed) return;
    start(ctx);
    await refreshGitBranch(state, pi);
    const usage = ctx.getContextUsage();
    if (usage) state.tokenUsage = usage.tokens ?? 0;
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (state.destroyed) return;
    stop(ctx);
  });

  pi.on("turn_start", async (event, _ctx) => {
    if (state.destroyed) return;
    state.turnIndex = event.turnIndex;
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (state.destroyed) return;
    state.currentTool = event.toolName;
    refresh(ctx);
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    if (state.destroyed) return;
    state.currentTool = "";
    refresh(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (state.destroyed) return;
    state.modelName = event.model.id || event.model.provider;
    if (!state.running) reapplySoon(ctx);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (state.destroyed) return;
    state.thinkingLevel = event.level ?? "";
    if (!state.running) refresh(ctx);
  });

  pi.on("session_shutdown", async () => {
    clearTimers();
    state.running = false;
    state.destroyed = true;
  });

  // ── Command: /pi-status ──────────────────────────────────────────────

  async function handleOn(ctx: ExtensionContext) {
    if (state.destroyed) return;
    setEnabled(ctx, true);
    ctx.ui.notify("pi-status enabled", "info");
  }

  async function handleOff(ctx: ExtensionContext) {
    if (state.destroyed) return;
    setEnabled(ctx, false);
    ctx.ui.notify("pi-status disabled", "info");
  }

  async function handleComponents(ctx: ExtensionCommandContext) {
    if (state.destroyed) return;
    const comps = config.components.map((c) => ({ ...c }));

    await ctx.ui.custom((tui, theme, _kb, done) => {
      let cursor = 0;
      const container = new Container();

      function titlePreview(): string {
        const parts: string[] = [];
        for (const c of comps) {
          if (!c.enabled) continue;
          const val = resolveComponentValue(c.id as ComponentId, state, pi, ctx);
          if (val) parts.push(val);
        }
        const joined = parts.join(config.separator);
        return joined || theme.fg("dim", "(empty)");
      }

      function rebuild() {
        try {
          container.clear();

          // ── preview (single line) ──
          container.addChild(
            new Text(
              theme.fg("dim", "Preview: ") +
                theme.fg("accent", theme.bold(titlePreview())),
              1,
              0,
            ),
          );

          // ── component list ──
          const maxLabelW = Math.max(
            ...comps.map(
              (c) => (COMPONENT_LABELS[c.id as ComponentId] ?? c.id).length,
            ),
          );
          for (let i = 0; i < comps.length; i++) {
            const c = comps[i]!;
            const checked = c.enabled ? "✓" : " ";
            const label = (COMPONENT_LABELS[c.id as ComponentId] ?? c.id).padEnd(
              maxLabelW,
            );
            const marker = i === cursor ? "›" : " ";
            const line = `${marker} [${checked}] ${label}`;
            container.addChild(
              new Text(i === cursor ? theme.fg("accent", line) : line, 1, 0),
            );
          }

          // ── help ──
          container.addChild(
            new Text(
              theme.fg(
                "dim",
                "↑↓ move   Space toggle   Ctrl+↑/↓ reorder   Enter/Esc done",
              ),
              1,
              0,
            ),
          );

          tui.requestRender();
        } catch {
          // Silently ignore render errors to avoid freezing the TUI.
        }
      }

      function persist() {
        config.components = comps;
        writePiStatusConfig(config);
        setTitle(config, state, pi, ctx);
      }

      rebuild();

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (matchesKey(data, Key.up)) {
            cursor = Math.max(0, cursor - 1);
            rebuild();
            return;
          }
          if (matchesKey(data, Key.down)) {
            cursor = Math.min(comps.length - 1, cursor + 1);
            rebuild();
            return;
          }
          if (matchesKey(data, Key.space)) {
            comps[cursor]!.enabled = !comps[cursor]!.enabled;
            config.components = comps;
            setTitle(config, state, pi, ctx);
            rebuild();
            return;
          }
          if (matchesKey(data, Key.ctrl("up")) && cursor > 0) {
            [comps[cursor - 1], comps[cursor]] = [
              comps[cursor]!,
              comps[cursor - 1]!,
            ];
            cursor--;
            config.components = comps;
            setTitle(config, state, pi, ctx);
            rebuild();
            return;
          }
          if (
            matchesKey(data, Key.ctrl("down")) &&
            cursor < comps.length - 1
          ) {
            [comps[cursor], comps[cursor + 1]] = [
              comps[cursor + 1]!,
              comps[cursor]!,
            ];
            cursor++;
            config.components = comps;
            setTitle(config, state, pi, ctx);
            rebuild();
            return;
          }
          if (
            matchesKey(data, Key.escape) ||
            matchesKey(data, Key.enter)
          ) {
            persist();
            done(undefined);
            return;
          }
        },
      };
    });

    ctx.ui.notify("Component settings updated", "info");
  }

  async function handleSeparator(ctx: ExtensionCommandContext) {
    if (state.destroyed) return;
    const newChar = await ctx.ui.input(
      `Current separator: "${config.separator}". Enter new separator:`,
      config.separator,
    );

    if (newChar === undefined || newChar === null) {
      ctx.ui.notify("Separator change cancelled", "warning");
      return;
    }

    if (newChar.length > 5) {
      ctx.ui.notify(
        "Separator too long (max 5 characters). Use a short string like '|', '·', ' - '",
        "error",
      );
      return;
    }

    config.separator = newChar || config.separator;
    writePiStatusConfig(config);
    setTitle(config, state, pi, ctx);
    ctx.ui.notify(`Separator changed to "${config.separator}"`, "info");
  }

  async function handleReset(ctx: ExtensionCommandContext) {
    if (state.destroyed) return;
    const ok = await ctx.ui.confirm(
      "Reset pi-status config?",
      "This restores the default status bar components and separator. Continue?",
    );

    if (!ok) {
      ctx.ui.notify("Reset cancelled", "warning");
      return;
    }

    config = structuredClone(DEFAULT_CONFIG);
    writePiStatusConfig(config);
    setEnabled(ctx, !isDisabledByEnv());
    ctx.ui.notify("pi-status config reset to defaults", "info");
  }

  async function showMainMenu(ctx: ExtensionCommandContext) {
    if (state.destroyed) return;
    const action = await ctx.ui.custom<string>((tui, theme, _kb, done) => {
      let cursor = 0;
      const container = new Container();

      const enabledText = (enabled: boolean) =>
        enabled ? theme.fg("success", "enabled") : theme.fg("warning", "disabled");
      const statusText = () => {
        if (!state.enabled && isDisabledByEnv()) {
          return theme.fg("warning", "disabled") + theme.fg("dim", ` by ${DISABLE_ENV}`);
        }
        return enabledText(state.enabled);
      };

      const items = [
        {
          label: (selected: boolean) =>
            `${selected ? theme.fg("accent", "Status: ") : "Status: "}${statusText()}`,
          action: "toggle",
        },
        { label: (selected: boolean) => selected ? theme.fg("accent", "Change components") : "Change components", action: "components" },
        { label: (selected: boolean) => selected ? theme.fg("accent", "Change separator") : "Change separator", action: "separator" },
        { label: (selected: boolean) => selected ? theme.fg("accent", "Reset to defaults") : "Reset to defaults", action: "reset" },
        { label: (selected: boolean) => selected ? theme.fg("accent", "Close") : "Close", action: "close" },
      ];

      function statusLine(): string {
        return "pi-status:";
      }

      function rebuild() {
        try {
          container.clear();
          container.addChild(new Text(statusLine(), 1, 0));
          container.addChild(new Text("", 0, 0));

          for (let i = 0; i < items.length; i++) {
            const item = items[i]!;
            const selected = i === cursor;
            const marker = selected ? theme.fg("accent", "›") : " ";
            const line = `  ${marker} ${item.label(selected)}`;
            container.addChild(new Text(line, 1, 0));
          }

          tui.requestRender();
        } catch {
          // Silently ignore render errors.
        }
      }

      rebuild();

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (matchesKey(data, Key.up)) {
            cursor = Math.max(0, cursor - 1);
            rebuild();
            return;
          }
          if (matchesKey(data, Key.down)) {
            cursor = Math.min(items.length - 1, cursor + 1);
            rebuild();
            return;
          }
          if (
            matchesKey(data, Key.space) ||
            matchesKey(data, Key.enter)
          ) {
            const item = items[cursor]!;
            if (item.action === "toggle") {
              setEnabled(ctx, !state.enabled);
              rebuild();
              return;
            }
            done(item.action);
            return;
          }
          if (matchesKey(data, Key.escape)) {
            done("close");
            return;
          }
        },
      };
    });

    if (action === "components") return handleComponents(ctx);
    if (action === "separator") return handleSeparator(ctx);
    if (action === "reset") return handleReset(ctx);
    // "close" or undefined — nothing further to do.
  }

  pi.registerCommand("pi-status", {
    description:
      "Configure the terminal title. Subcommands: on, off, components, separator, reset. " +
      "No argument shows a menu.",
    handler: async (args, ctx) => {
      if (state.destroyed) return;
      const parts = args.trim().toLowerCase().split(/\s+/);
      const sub = parts[0]!;

      switch (sub) {
        case "on":
          return handleOn(ctx);
        case "off":
          return handleOff(ctx);
        case "components":
          return handleComponents(ctx);
        case "separator":
          return handleSeparator(ctx);
        case "reset":
          return handleReset(ctx);
        case "status":
        default:
          // Empty or unknown → show the interactive menu.
          return showMainMenu(ctx);
      }
    },
  });
}

// Re-export for config consumers
export { readPiStatusConfig, DEFAULT_CONFIG, ALL_COMPONENT_IDS, COMPONENT_LABELS };
export type { PiStatusConfig, ComponentConfig, ComponentId };
