import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type ComponentConfig } from "./config.js";
import { editComponents, showMainMenu, type MenuDeps } from "./menu.js";

const KEY = { up: "\x1b[A", down: "\x1b[B", space: " ", enter: "\r", escape: "\x1b", ctrlUp: "\x1b[1;5A" };

/** A ctx whose ui.custom runs the menu and feeds it `keys`, recording the
 *  rendered lines after the last key. */
function fakeCtx(keys: string[]) {
  const notices: string[] = [];
  let lastRender: string[] = [];
  const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };
  const tui = { requestRender: () => undefined };
  const ctx = {
    ui: {
      notify: (m: string) => notices.push(m),
      custom: (factory: any) =>
        new Promise((resolve) => {
          const component = factory(tui, theme, {}, resolve);
          for (const k of keys) component.handleInput(k);
          lastRender = component.render(120).map((l: string) => l.trim());
        }),
    },
  };
  return { ctx: ctx as any, notices, rendered: () => lastRender };
}

function deps(over: Partial<MenuDeps> = {}) {
  let components = DEFAULT_CONFIG.components.map((c) => ({ ...c }));
  let enabled = true;
  const saved: ComponentConfig[][] = [];
  const applied: ComponentConfig[][] = [];
  const d: MenuDeps = {
    components: () => components,
    preview: (cs) => cs.filter((c) => c.enabled).map((c) => c.id).join(" - "),
    applyComponents: (cs) => applied.push(cs.map((c) => ({ ...c }))),
    saveComponents: (cs) => {
      components = cs.map((c) => ({ ...c }));
      saved.push(components);
    },
    enabled: () => enabled,
    disabledByEnv: () => false,
    setEnabled: (on) => {
      enabled = on;
    },
    ...over,
  };
  return { d, saved, applied, isEnabled: () => enabled };
}

describe("editComponents", () => {
  test("Space toggles, Ctrl+↑ reorders, Enter saves", async () => {
    const { d, saved, applied } = deps();
    // pi_symbol is first: move to session (2nd), switch it off, move it to the top.
    const { ctx, notices } = fakeCtx([KEY.down, KEY.space, KEY.ctrlUp, KEY.enter]);
    await editComponents(ctx, d);
    expect(saved).toHaveLength(1);
    const ids = saved[0]!.map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual(["session", "pi_symbol"]);
    expect(saved[0]![0]).toEqual({ id: "session", enabled: false });
    expect(applied.length).toBe(2); // the toggle and the move were shown live
    expect(notices).toContain("Component settings updated");
  });

  test("the cursor follows a moved row", async () => {
    const { d } = deps();
    const { ctx, rendered } = fakeCtx([KEY.down, KEY.ctrlUp]);
    void editComponents(ctx, d);
    await new Promise((r) => setTimeout(r, 0));
    const rows = rendered().filter((l) => l.includes("["));
    expect(rows[0]).toStartWith("› [✓] Session name");
  });
});

describe("showMainMenu", () => {
  test("toggling status stays in the menu", async () => {
    const { d, isEnabled } = deps();
    const { ctx } = fakeCtx([KEY.space, KEY.escape]);
    expect(await showMainMenu(ctx, d)).toBeUndefined();
    expect(isEnabled()).toBe(false);
  });

  test("other entries close it with their action", async () => {
    const { d } = deps();
    expect(await showMainMenu(fakeCtx([KEY.down, KEY.enter]).ctx, d)).toBe("components");
    expect(await showMainMenu(fakeCtx([KEY.down, KEY.down, KEY.enter]).ctx, d)).toBe("separator");
    expect(await showMainMenu(fakeCtx([KEY.down, KEY.down, KEY.down, KEY.down, KEY.enter]).ctx, d)).toBeUndefined();
  });
});
