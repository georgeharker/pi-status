import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig } from "./config.js";
import { EMPTY_SNAPSHOT, buildTitle, componentValue, formatTokens, type TitleSnapshot } from "./title.js";

const snap = (over: Partial<TitleSnapshot> = {}): TitleSnapshot => ({
  ...EMPTY_SNAPSHOT,
  session: "my-session",
  cwd: "/work/my-project",
  ...over,
});

describe("buildTitle", () => {
  test("default config: π - session - folder", () => {
    expect(buildTitle(DEFAULT_CONFIG, snap())).toBe("π - my-session - my-project");
  });

  test("components with nothing to show are left out", () => {
    expect(buildTitle(DEFAULT_CONFIG, snap({ session: "" }))).toBe("π - my-project");
  });

  test("order and separator come from the config", () => {
    const config = normalizeConfig({
      separator: " | ",
      components: [
        { id: "git_branch", enabled: true },
        { id: "model", enabled: true },
        { id: "pi_symbol", enabled: false },
        { id: "session", enabled: false },
        { id: "cwd", enabled: true },
      ],
    });
    expect(buildTitle(config, snap({ gitBranch: "main", model: "claude-x" }))).toBe("main | claude-x | my-project");
  });
});

describe("componentValue", () => {
  test("cwd shows the folder name, with or without a trailing slash", () => {
    expect(componentValue("cwd", snap({ cwd: "/a/b/proj/" }))).toBe("proj");
    expect(componentValue("cwd", snap({ cwd: "" }))).toBe("");
  });

  test("turn shows only while the agent works", () => {
    expect(componentValue("turn", snap({ turn: 3 }))).toBe("3");
    expect(componentValue("turn", snap({ turn: null }))).toBe("");
  });

  test("tools count and tokens", () => {
    expect(componentValue("tools_count", snap({ toolsCount: 7 }))).toBe("7t");
    expect(componentValue("tools_count", snap({ toolsCount: 0 }))).toBe("");
    expect(componentValue("tokens", snap({ tokens: 1234 }))).toBe("1.2k");
  });
});

describe("formatTokens", () => {
  test("thousands as k, small counts as is, zero as nothing", () => {
    expect(formatTokens(0)).toBe("");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_500)).toBe("12.5k");
  });
});
