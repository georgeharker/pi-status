import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, configPaths, loadConfig, saveConfig } from "./config.js";

test("settings saved are the settings restored; nothing saved is the default", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-status-config-"));
  const paths = configPaths(path.join(root, "project"), path.join(root, "agent"));
  expect(loadConfig(paths)).toEqual(DEFAULT_CONFIG);

  const config = {
    separator: " | ",
    components: DEFAULT_CONFIG.components.map((c) => ({ ...c, enabled: !c.enabled })),
  };
  saveConfig(config, paths);
  expect(loadConfig(paths)).toEqual(config);
});
