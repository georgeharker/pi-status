/**
 * The /pi-title menus, built on pi's own settings components: a
 * SettingsList (as in pi's /settings) for the main menu, with submenus for
 * the components, the separator and reset. They reach the extension only
 * through MenuDeps.
 */
import {
  getSelectListTheme,
  getSettingsListTheme,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  Key,
  SelectList,
  SettingsList,
  Text,
  matchesKey,
  type Component,
  type SettingItem,
} from "@earendil-works/pi-tui";
import {
  COMPONENT_LABELS,
  DISABLE_ENV,
  MAX_SEPARATOR_LENGTH,
  type ComponentConfig,
  type ComponentId,
} from "./config.js";

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
  separator(): string;
  /** Save and show a separator. */
  setSeparator(separator: string): void;
  /** Restore and save the default config. */
  reset(): void;
  enabled(): boolean;
  /** Whether PI_TITLE_DISABLED (or PI_STATUS_DISABLED) turned pi-title off. */
  disabledByEnv(): boolean;
  setEnabled(enabled: boolean): void;
}

const ON = "enabled";
const OFF = "disabled";

/** The id of the row under a SettingsList's cursor. SettingsList offers
 *  selectItem(id) to move the cursor but no way to read it, which
 *  reordering needs; this reads its private state, and gives undefined
 *  (reordering is then skipped) if that ever changes shape. */
function selectedId(list: SettingsList): string | undefined {
  // SAFETY: reads SettingsList's private selectedIndex and items (pi-tui
  // 1.5). Both are checked before use, so a different shape yields
  // undefined rather than a wrong row.
  const internal = list as unknown as { selectedIndex?: unknown; items?: SettingItem[] };
  return typeof internal.selectedIndex === "number" ? internal.items?.[internal.selectedIndex]?.id : undefined;
}

/** The component picker: Space/Enter toggles, Ctrl+↑/↓ reorders, a live
 *  preview above; Esc saves and closes. */
function componentPicker(theme: Theme, deps: MenuDeps, onClose: () => void): Component {
  const comps = deps.components().map((c) => ({ ...c }));
  const items: SettingItem[] = comps.map((c) => ({
    id: c.id,
    label: COMPONENT_LABELS[c.id],
    currentValue: c.enabled ? ON : OFF,
    values: [ON, OFF],
  }));
  const preview = new Text("", 1, 0);
  const showPreview = () =>
    preview.setText(theme.fg("dim", "Preview: ") + theme.fg("accent", theme.bold(deps.preview(comps) || "(empty)")));
  const close = () => {
    deps.saveComponents(comps);
    onClose();
  };
  const list = new SettingsList(
    items,
    Math.min(items.length + 2, 15),
    getSettingsListTheme(),
    (id, value) => {
      const c = comps.find((x) => x.id === id);
      if (c) c.enabled = value === ON;
      deps.applyComponents(comps);
      showPreview();
    },
    close,
  );
  showPreview();
  const container = new Container();
  container.addChild(preview);
  container.addChild(list);
  container.addChild(new Text(theme.fg("dim", "Ctrl+↑/↓ reorder"), 1, 0));

  const move = (by: -1 | 1): void => {
    const id = selectedId(list);
    const from = comps.findIndex((c) => c.id === id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= comps.length) return;
    [comps[from], comps[to]] = [comps[to]!, comps[from]!];
    [items[from], items[to]] = [items[to]!, items[from]!];
    list.selectItem(id as ComponentId);
    deps.applyComponents(comps);
    showPreview();
    list.invalidate();
  };

  return {
    render: (w: number) => container.render(w),
    invalidate: () => container.invalidate(),
    handleInput: (data: string) => {
      if (matchesKey(data, Key.ctrl("up"))) return move(-1);
      if (matchesKey(data, Key.ctrl("down"))) return move(1);
      list.handleInput(data);
    },
  };
}

/** A single-line Input submenu for the separator. */
function separatorInput(theme: Theme, deps: MenuDeps, done: (value?: string) => void): Component {
  const error = new Text("", 1, 0);
  // Not prefilled: Input has no way to put its cursor at the end of a set
  // value. The current separator is the placeholder; Enter on an empty
  // field keeps it.
  const input = new Input({ placeholder: `${JSON.stringify(deps.separator())} (current)` });
  input.focused = true;
  input.onSubmit = (value) => {
    if (value.length > MAX_SEPARATOR_LENGTH) {
      error.setText(theme.fg("error", `At most ${MAX_SEPARATOR_LENGTH} characters, e.g. '|', '·', ' - '`));
      return;
    }
    if (value) deps.setSeparator(value);
    done(JSON.stringify(deps.separator()));
  };
  input.onEscape = () => done();
  const container = new Container();
  container.addChild(new Text(theme.fg("dim", "New separator (Enter to save, Esc to cancel):"), 1, 0));
  container.addChild(input);
  container.addChild(error);
  return {
    render: (w: number) => container.render(w),
    invalidate: () => container.invalidate(),
    handleInput: (data: string) => input.handleInput(data),
  };
}

const enabledCount = (deps: MenuDeps) => `${deps.components().filter((c) => c.enabled).length} on`;
const statusValue = (deps: MenuDeps) => (deps.enabled() ? ON : deps.disabledByEnv() ? `${OFF} (${DISABLE_ENV})` : OFF);

/** /pi-title: status, components, separator and reset in one settings list. */
export async function showSettings(ctx: ExtensionCommandContext, deps: MenuDeps): Promise<void> {
  await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
    const items: SettingItem[] = [
      {
        id: "status",
        label: "Status",
        description: "Whether pi-title sets the terminal title",
        currentValue: statusValue(deps),
        values: [ON, OFF],
      },
      {
        id: "components",
        label: "Components",
        description: "What the title shows, and in which order",
        currentValue: enabledCount(deps),
        submenu: (_value, close) => componentPicker(theme, deps, () => close(enabledCount(deps))),
      },
      {
        id: "separator",
        label: "Separator",
        description: "Placed between the components",
        currentValue: JSON.stringify(deps.separator()),
        submenu: (_value, close) => separatorInput(theme, deps, close),
      },
      {
        id: "reset",
        label: "Reset to defaults",
        description: "Restore the default components and separator",
        currentValue: "",
        submenu: (_value, close) => {
          const confirm = new SelectList(
            [
              { value: "reset", label: "Reset to defaults" },
              { value: "cancel", label: "Cancel" },
            ],
            2,
            getSelectListTheme(),
          );
          confirm.onSelect = (item) => {
            if (item.value === "reset") {
              deps.reset();
              list.updateValue("status", statusValue(deps));
              list.updateValue("components", enabledCount(deps));
              list.updateValue("separator", JSON.stringify(deps.separator()));
            }
            close();
          };
          confirm.onCancel = () => close();
          return confirm;
        },
      },
    ];
    const list = new SettingsList(
      items,
      items.length + 2,
      getSettingsListTheme(),
      (id, value) => {
        if (id === "status") deps.setEnabled(value === ON);
      },
      () => done(),
    );
    return list;
  });
}

/** /pi-title components: the picker on its own. */
export async function editComponents(ctx: ExtensionCommandContext, deps: MenuDeps): Promise<void> {
  await ctx.ui.custom<void>((_tui, theme, _kb, done) => componentPicker(theme, deps, () => done()));
  ctx.ui.notify("Component settings updated", "info");
}
