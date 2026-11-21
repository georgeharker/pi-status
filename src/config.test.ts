import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, configPaths, isDisabledByEnv, loadConfig, saveConfig } from "./config.js";

test("settings saved are the settings restored; nothing saved is the default", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-title-config-"));
  const paths = configPaths(path.join(root, "project"), path.join(root, "agent"));
  expect(loadConfig(paths)).toEqual(DEFAULT_CONFIG);

  const config = {
    separator: " | ",
    components: DEFAULT_CONFIG.components.map((c) => ({ ...c, enabled: !c.enabled })),
  };
  saveConfig(config, paths);
  expect(loadConfig(paths)).toEqual(config);
});

test("a pi-status.json from before the rename is read until a pi-title.json is saved", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-title-config-"));
  const paths = configPaths(path.join(root, "project"), path.join(root, "agent"));
  const legacy = { separator: " · ", components: DEFAULT_CONFIG.components };
  mkdirSync(path.dirname(paths.legacyGlobal), { recursive: true });
  writeFileSync(paths.legacyGlobal, JSON.stringify(legacy));
  expect(loadConfig(paths)).toEqual(legacy);

  saveConfig(DEFAULT_CONFIG, paths);
  expect(loadConfig(paths)).toEqual(DEFAULT_CONFIG);
});

test("PI_TITLE_DISABLED or the older PI_STATUS_DISABLED turns it off", () => {
  expect(isDisabledByEnv({})).toBe(false);
  expect(isDisabledByEnv({ PI_TITLE_DISABLED: "yes" })).toBe(true);
  expect(isDisabledByEnv({ PI_STATUS_DISABLED: "1" })).toBe(true);
  expect(isDisabledByEnv({ PI_TITLE_DISABLED: "0" })).toBe(false);
});
