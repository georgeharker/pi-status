/**
 * The /pi-status menus: the main menu and the component picker. Both are a
 * cursor over a list of rows (runList); they reach the extension only through
 * MenuDeps.
 */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, Text, matchesKey } from "@earendil-works/pi-tui";
import { COMPONENT_LABELS, DISABLE_ENV, type ComponentConfig } from "./config.js";

type Theme = Parameters<Parameters<ExtensionCommandContext["ui"]["custom"]>[0]>[1];

/** What the menus need from the extension. */
export interface MenuDeps {
  components(): ComponentConfig[];
  /** The title these components would give now. */
  preview(components: ComponentConfig[]): string;
  /** Show these components in the title, without saving them. */
  applyComponents(components: ComponentConfig[]): void;
  /** Save these components and show them. */
  saveComponents(components: ComponentConfig[]): void;
  enabled(): boolean;
  /** Whether PI_STATUS_DISABLED turned pi-status off. */
  disabledByEnv(): boolean;
  setEnabled(enabled: boolean): void;
}

interface ListView<R> {
  /** Lines above the list. */
  header?(theme: Theme): string[];
  /** One line per row; `selected` is the row under the cursor. */
  rows(theme: Theme, cursor: number): string[];
  /** Lines below the list. */
  footer?(theme: Theme): string[];
  /** A key the list does not handle itself (it handles up and down).
   *  Return a result to close the menu with it, "redraw" to redraw, or
   *  nothing to ignore the key. */
  onKey(data: string, cursor: number): { close: R | undefined } | "redraw" | undefined;
  /** Cursor moves (to keep it valid when rows move). */
  setCursor?(cursor: number): number;
}

/** A keyboard-driven list: ↑/↓ move the cursor, the view handles the rest. */
function runList<R>(ctx: ExtensionCommandContext, view: ListView<R>): Promise<R | undefined> {
  return ctx.ui.custom<R | undefined>((tui, theme, _kb, done) => {
    const container = new Container();
    let cursor = 0;
    const count = () => view.rows(theme, cursor).length;
    const line = (text: string) => container.addChild(new Text(text, 1, 0));
    const redraw = () => {
      container.clear();
      for (const l of view.header?.(theme) ?? []) line(l);
      for (const l of view.rows(theme, cursor)) line(l);
      for (const l of view.footer?.(theme) ?? []) line(l);
      tui.requestRender();
    };
    redraw();
    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
          const next = matchesKey(data, Key.up) ? cursor - 1 : cursor + 1;
          cursor = Math.min(Math.max(next, 0), count() - 1);
          redraw();
          return;
        }
        const result = view.onKey(data, cursor);
        if (result === "redraw") {
          cursor = view.setCursor?.(cursor) ?? cursor;
          redraw();
        } else if (result) done(result.close);
      },
    };
  });
}

/** The component picker: Space toggles, Ctrl+↑/↓ reorders, with a live
 *  preview; Enter or Esc saves. */
export async function editComponents(ctx: ExtensionCommandContext, deps: MenuDeps): Promise<void> {
  const comps = deps.components().map((c) => ({ ...c }));
  const labelWidth = Math.max(...comps.map((c) => COMPONENT_LABELS[c.id].length));
  let moveTo: number | null = null;
  const swap = (a: number, b: number) => {
    [comps[a], comps[b]] = [comps[b]!, comps[a]!];
    moveTo = b;
  };

  await runList<true>(ctx, {
    header: (theme) => [
      theme.fg("dim", "Preview: ") + theme.fg("accent", theme.bold(deps.preview(comps) || "(empty)")),
    ],
    rows: (theme, cursor) =>
      comps.map((c, i) => {
        const text = `${i === cursor ? "›" : " "} [${c.enabled ? "✓" : " "}] ${COMPONENT_LABELS[c.id].padEnd(labelWidth)}`;
        return i === cursor ? theme.fg("accent", text) : text;
      }),
    footer: (theme) => [theme.fg("dim", "↑↓ move   Space toggle   Ctrl+↑/↓ reorder   Enter/Esc done")],
    onKey: (data, cursor) => {
      if (matchesKey(data, Key.space)) {
        comps[cursor]!.enabled = !comps[cursor]!.enabled;
      } else if (matchesKey(data, Key.ctrl("up")) && cursor > 0) {
        swap(cursor, cursor - 1);
      } else if (matchesKey(data, Key.ctrl("down")) && cursor < comps.length - 1) {
        swap(cursor, cursor + 1);
      } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
        return { close: true };
      } else {
        return undefined;
      }
      deps.applyComponents(comps);
      return "redraw";
    },
    setCursor: (cursor) => {
      const next = moveTo ?? cursor;
      moveTo = null;
      return next;
    },
  });

  deps.saveComponents(comps);
  ctx.ui.notify("Component settings updated", "info");
}

export type MainMenuAction = "components" | "separator" | "reset";

/** The main menu. Toggling status happens in place; the other entries close
 *  it and return their action. */
export async function showMainMenu(
  ctx: ExtensionCommandContext,
  deps: MenuDeps,
): Promise<MainMenuAction | undefined> {
  const items: Array<{ label: (theme: Theme) => string; action: MainMenuAction | "toggle" | "close" }> = [
    {
      label: (theme) => {
        if (!deps.enabled() && deps.disabledByEnv()) {
          return "Status: " + theme.fg("warning", "disabled") + theme.fg("dim", ` by ${DISABLE_ENV}`);
        }
        return "Status: " + (deps.enabled() ? theme.fg("success", "enabled") : theme.fg("warning", "disabled"));
      },
      action: "toggle",
    },
    { label: () => "Change components", action: "components" },
    { label: () => "Change separator", action: "separator" },
    { label: () => "Reset to defaults", action: "reset" },
    { label: () => "Close", action: "close" },
  ];

  const chosen = await runList<MainMenuAction | "close">(ctx, {
    header: () => ["pi-status:", ""],
    rows: (theme, cursor) =>
      items.map((item, i) => `  ${i === cursor ? theme.fg("accent", "›") : " "} ${item.label(theme)}`),
    onKey: (data, cursor) => {
      if (matchesKey(data, Key.escape)) return { close: "close" };
      if (!matchesKey(data, Key.space) && !matchesKey(data, Key.enter)) return undefined;
      const item = items[cursor]!;
      if (item.action !== "toggle") return { close: item.action };
      deps.setEnabled(!deps.enabled());
      return "redraw";
    },
  });
  return chosen === "close" ? undefined : chosen;
}
