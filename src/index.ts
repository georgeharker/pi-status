/**
 * pi-title: the terminal title, built from configurable components.
 *
 * pi's events keep a TitleSnapshot current; the title (title.ts) is a pure
 * function of it and the config (config.ts), set only when something in it
 * changes. Busy state is pi's own terminal progress
 * (terminal.showTerminalProgress), not part of the title.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  MAX_SEPARATOR_LENGTH,
  isDisabledByEnv,
  loadConfig,
  saveConfig,
  type ComponentConfig,
  type PiTitleConfig,
} from "./config.js";
import { EMPTY_SNAPSHOT, buildTitle, type TitleSnapshot } from "./title.js";
import { editComponents, showSettings, type MenuDeps } from "./menu.js";

export default function piTitle(pi: ExtensionAPI) {
  let config: PiTitleConfig = loadConfig();
  let enabled = !isDisabledByEnv();
  let destroyed = false;
  /** Whether the agent is working (the turn component shows only then). */
  let running = false;
  /** Event-fed parts of the snapshot; the rest is read when the title is
   *  built (see snapshot). */
  const seen = { model: "", thinking: "", tokens: 0, turn: 1, gitBranch: "", currentTool: "" };
  let reapplyTimer: ReturnType<typeof setTimeout> | undefined;

  const safe = <T>(read: () => T, fallback: T): T => {
    try {
      return read() ?? fallback;
    } catch {
      return fallback;
    }
  };
  seen.thinking = safe(() => pi.getThinkingLevel(), "");

  function snapshot(ctx: ExtensionContext): TitleSnapshot {
    return {
      ...EMPTY_SNAPSHOT,
      session: safe(() => pi.getSessionName(), "") ?? "",
      cwd: ctx.cwd || process.cwd(),
      model: seen.model,
      thinking: seen.thinking,
      tokens: seen.tokens,
      turn: running ? seen.turn : null,
      gitBranch: seen.gitBranch,
      toolsCount: safe(() => pi.getActiveTools().length, 0),
      currentTool: seen.currentTool,
    };
  }

  function refresh(ctx: ExtensionContext): void {
    if (destroyed || !enabled || !ctx.hasUI) return;
    ctx.ui.setTitle(buildTitle(config, snapshot(ctx)));
  }

  /** Refresh again on the next tick: pi writes its own title around some
   *  events (after extensions' session_start, on a rename, on a model
   *  switch), so a title set inside the handler can be overwritten at once. */
  function refreshSoon(ctx: ExtensionContext): void {
    if (reapplyTimer) clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(() => {
      reapplyTimer = undefined;
      refresh(ctx);
    }, 0);
  }

  function cancelRefresh(): void {
    if (reapplyTimer) clearTimeout(reapplyTimer);
    reapplyTimer = undefined;
  }

  async function refreshGitBranch(): Promise<void> {
    const result = await pi.exec("git", ["branch", "--show-current"], { timeout: 3000 }).catch(() => null);
    seen.gitBranch = result?.code === 0 ? result.stdout.trim() : "";
  }

  /** Turn pi-title on or off for this session. Off leaves the title to pi's
   *  own format on its next update. */
  function setEnabled(ctx: ExtensionContext, on: boolean): void {
    enabled = on;
    if (!on) return cancelRefresh();
    refresh(ctx);
    refreshSoon(ctx);
  }

  // ── Events ────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    if (destroyed) return;
    config = loadConfig(); // may have changed between sessions
    if (ctx.model) seen.model = ctx.model.id || ctx.model.provider;
    seen.thinking = safe(() => pi.getThinkingLevel(), "");
    await refreshGitBranch();
    refresh(ctx);
    refreshSoon(ctx);
  });

  pi.on("session_info_changed", async (_event, ctx) => {
    if (!destroyed) refreshSoon(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (destroyed) return;
    running = true;
    seen.turn = 1;
    seen.currentTool = "";
    refresh(ctx);
    await refreshGitBranch();
    seen.tokens = safe(() => ctx.getContextUsage()?.tokens ?? 0, 0);
    refresh(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (destroyed) return;
    running = false;
    seen.currentTool = "";
    refresh(ctx);
    refreshSoon(ctx);
  });

  pi.on("turn_start", async (event, ctx) => {
    if (destroyed) return;
    seen.turn = event.turnIndex;
    refresh(ctx);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    if (destroyed) return;
    seen.currentTool = event.toolName;
    refresh(ctx);
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    if (destroyed) return;
    seen.currentTool = "";
    refresh(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (destroyed) return;
    seen.model = event.model.id || event.model.provider;
    refreshSoon(ctx);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (destroyed) return;
    seen.thinking = event.level ?? "";
    refresh(ctx);
  });

  pi.on("session_shutdown", async () => {
    cancelRefresh();
    running = false;
    destroyed = true;
  });

  // ── /pi-title ────────────────────────────────────────────────────────

  const menuDeps = (ctx: ExtensionCommandContext): MenuDeps => ({
    components: () => config.components,
    preview: (components: ComponentConfig[]) => buildTitle({ ...config, components }, snapshot(ctx)),
    applyComponents: (components) => {
      config = { ...config, components: components.map((c) => ({ ...c })) };
      refresh(ctx);
    },
    saveComponents: (components) => {
      config = { ...config, components: components.map((c) => ({ ...c })) };
      saveConfig(config);
      refresh(ctx);
    },
    separator: () => config.separator,
    setSeparator: (separator) => {
      config = { ...config, separator };
      saveConfig(config);
      refresh(ctx);
    },
    reset: () => {
      config = structuredClone(DEFAULT_CONFIG);
      saveConfig(config);
      setEnabled(ctx, !isDisabledByEnv());
    },
    enabled: () => enabled,
    disabledByEnv: () => isDisabledByEnv(),
    setEnabled: (on) => setEnabled(ctx, on),
  });

  async function changeSeparator(ctx: ExtensionCommandContext): Promise<void> {
    const entered = await ctx.ui.input(
      `Current separator: "${config.separator}". Enter new separator:`,
      config.separator,
    );
    if (entered === undefined || entered === null) {
      ctx.ui.notify("Separator change cancelled", "warning");
      return;
    }
    if (entered.length > MAX_SEPARATOR_LENGTH) {
      ctx.ui.notify(
        `Separator too long (max ${MAX_SEPARATOR_LENGTH} characters). Use a short string like '|', '·', ' - '`,
        "error",
      );
      return;
    }
    if (entered) menuDeps(ctx).setSeparator(entered);
    ctx.ui.notify(`Separator changed to "${config.separator}"`, "info");
  }

  async function reset(ctx: ExtensionCommandContext): Promise<void> {
    const ok = await ctx.ui.confirm(
      "Reset pi-title config?",
      "This restores the default title components and separator. Continue?",
    );
    if (!ok) {
      ctx.ui.notify("Reset cancelled", "warning");
      return;
    }
    menuDeps(ctx).reset();
    ctx.ui.notify("pi-title config reset to defaults", "info");
  }

  pi.registerCommand("pi-title", {
    description:
      "Configure the terminal title. Subcommands: on, off, components, separator, reset. " +
      "No argument shows a menu.",
    handler: async (args, ctx) => {
      if (destroyed) return;
      switch (args.trim().toLowerCase().split(/\s+/)[0]) {
        case "on":
          setEnabled(ctx, true);
          return ctx.ui.notify("pi-title enabled", "info");
        case "off":
          setEnabled(ctx, false);
          return ctx.ui.notify("pi-title disabled", "info");
        case "components":
          return editComponents(ctx, menuDeps(ctx));
        case "separator":
          return changeSeparator(ctx);
        case "reset":
          return reset(ctx);
        default:
          // Empty, "status" or unknown: the settings.
          return showSettings(ctx, menuDeps(ctx));
      }
    },
  });
}

// For config consumers.
export { loadConfig as readPiTitleConfig, DEFAULT_CONFIG, ALL_COMPONENT_IDS, COMPONENT_LABELS } from "./config.js";
export type { PiTitleConfig, ComponentConfig, ComponentId } from "./config.js";
