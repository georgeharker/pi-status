import { expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig } from "./config.js";
import { EMPTY_SNAPSHOT, buildTitle } from "./title.js";

const snap = { ...EMPTY_SNAPSHOT, session: "my-session", cwd: "/work/my-project", model: "claude-x" };

test("the default title is π - session - folder", () => {
  expect(buildTitle(DEFAULT_CONFIG, snap)).toBe("π - my-session - my-project");
});

test("the title follows the configured order and separator, skipping empty parts", () => {
  const config = normalizeConfig({
    separator: " | ",
    components: [
      { id: "model", enabled: true },
      { id: "git_branch", enabled: true },
      { id: "pi_symbol", enabled: false },
      { id: "session", enabled: true },
      { id: "cwd", enabled: false },
    ],
  });
  expect(buildTitle(config, snap)).toBe("claude-x | my-session");
});
