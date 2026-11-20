import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ALL_COMPONENT_IDS,
  DEFAULT_CONFIG,
  configPaths,
  isDisabledByEnv,
  loadConfig,
  normalizeConfig,
  saveConfig,
} from "./config.js";

const ids = (c: { components: Array<{ id: string; enabled: boolean }> }, enabled?: boolean) =>
  c.components.filter((x) => enabled === undefined || x.enabled === enabled).map((x) => x.id);

describe("normalizeConfig", () => {
  test("nothing stored is the default", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(ids(DEFAULT_CONFIG, true)).toEqual(["pi_symbol", "session", "cwd"]);
  });

  test("keeps the stored order, then adds left-out components in their default state", () => {
    const c = normalizeConfig({ components: [{ id: "cwd", enabled: true }, { id: "model", enabled: true }] });
    expect(ids(c).slice(0, 2)).toEqual(["cwd", "model"]);
    expect(ids(c).sort()).toEqual([...ALL_COMPONENT_IDS].sort());
    expect(ids(c, true)).toEqual(["cwd", "model", "pi_symbol", "session"]);
  });

  test("drops unknown and repeated components; enabled defaults to true", () => {
    const c = normalizeConfig({
      components: [{ id: "spinner", enabled: true }, { id: "session" }, { id: "session", enabled: false }],
    });
    expect(ids(c)).not.toContain("spinner");
    expect(c.components.filter((x) => x.id === "session")).toEqual([{ id: "session", enabled: true }]);
  });

  test("a bad separator or components list falls back", () => {
    const c = normalizeConfig({ separator: 3, components: "nope" });
    expect(c).toEqual(DEFAULT_CONFIG);
  });
});

describe("loadConfig / saveConfig", () => {
  function dirs() {
    const root = mkdtempSync(path.join(tmpdir(), "pi-status-config-"));
    const agent = path.join(root, "agent");
    const project = path.join(root, "project");
    mkdirSync(path.join(project, ".pi"), { recursive: true });
    return { paths: configPaths(project, agent), agent, project };
  }

  test("no files: the default", () => {
    expect(loadConfig(dirs().paths)).toEqual(DEFAULT_CONFIG);
  });

  test("the project file is read in place of the global file", () => {
    const { paths } = dirs();
    mkdirSync(path.dirname(paths.global), { recursive: true });
    writeFileSync(paths.global, JSON.stringify({ separator: " G " }));
    expect(loadConfig(paths).separator).toBe(" G ");
    writeFileSync(paths.project, JSON.stringify({ separator: " P " }));
    expect(loadConfig(paths).separator).toBe(" P ");
  });

  test("a malformed or non-object file is ignored", () => {
    const { paths } = dirs();
    writeFileSync(paths.project, "{ not json");
    expect(loadConfig(paths)).toEqual(DEFAULT_CONFIG);
    writeFileSync(paths.project, JSON.stringify([1, 2]));
    expect(loadConfig(paths)).toEqual(DEFAULT_CONFIG);
  });

  test("saving writes only the global file (creating the agent dir)", () => {
    const { paths } = dirs();
    saveConfig({ ...DEFAULT_CONFIG, separator: " | " }, paths);
    expect(JSON.parse(readFileSync(paths.global, "utf-8")).separator).toBe(" | ");
    expect(() => readFileSync(paths.project)).toThrow();
  });

  test("the global file lives in pi's agent dir", () => {
    const { paths, agent } = dirs();
    expect(paths.global).toBe(path.join(agent, "pi-status.json"));
  });
});

describe("isDisabledByEnv", () => {
  test("1/true/yes/on disable; anything else does not", () => {
    for (const v of ["1", "true", " YES ", "on"]) expect(isDisabledByEnv({ PI_STATUS_DISABLED: v })).toBe(true);
    for (const v of [undefined, "", "0", "off", "no"]) expect(isDisabledByEnv({ PI_STATUS_DISABLED: v })).toBe(false);
  });
});
