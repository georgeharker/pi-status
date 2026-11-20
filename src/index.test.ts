import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import piStatus from "./index.js";

type Handler = (event: any, ctx: any) => unknown;

/** A fake pi with the API surface pi-status uses, and a ctx whose title
 *  writes are recorded. */
function harness(opts: { sessionName?: string } = {}) {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => unknown }>();
  let sessionName = opts.sessionName ?? "my-session";
  const pi = {
    on(event: string, h: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), h]);
      return () => undefined;
    },
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    getSessionName: () => sessionName,
    getThinkingLevel: () => "high",
    getActiveTools: () => [],
    exec: async () => ({ code: 0, stdout: "main\n", stderr: "" }),
  };
  const titles: string[] = [];
  const notices: string[] = [];
  const ctx = {
    hasUI: true,
    cwd: "/work/my-project",
    model: { id: "claude-x", provider: "anthropic" },
    ui: {
      setTitle: (t: string) => titles.push(t),
      notify: (m: string) => notices.push(m),
    },
    getContextUsage: () => ({ tokens: 1234 }),
    isIdle: () => true,
    hasPendingMessages: () => false,
  };
  piStatus(pi as any);
  const emit = async (event: string, payload: any = {}) => {
    for (const h of handlers.get(event) ?? []) await h({ type: event, ...payload }, ctx);
  };
  return {
    pi,
    ctx,
    titles,
    notices,
    emit,
    command: (args: string) => commands.get("pi-status")!.handler(args, ctx),
    rename: (name: string) => {
      sessionName = name;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

let agentDir = "";
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedCwd = process.cwd();

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "pi-status-test-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  // A project folder without a .pi/pi-status.json.
  process.chdir(mkdtempSync(path.join(tmpdir(), "pi-status-proj-")));
});

afterEach(() => {
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  process.chdir(savedCwd);
});

describe("title", () => {
  test("idle title after session start: π - session - cwd", async () => {
    const h = harness();
    await h.emit("session_start");
    expect(h.titles.at(-1)).toBe("π - my-session - my-project");
  });

  test("the spinner runs while the agent works and stops at agent_end", async () => {
    const h = harness();
    await h.emit("session_start");
    await h.emit("agent_start");
    expect(h.titles.at(-1)).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] - π - my-session - my-project$/);
    await h.emit("agent_end");
    expect(h.titles.at(-1)).toBe("π - my-session - my-project");
    const n = h.titles.length;
    await new Promise((r) => setTimeout(r, 200));
    // Only the one re-apply after the run ends; no spinner, no polling.
    expect(h.titles.length).toBeLessThanOrEqual(n + 1);
    await h.emit("session_shutdown");
  });

  test("a session rename is picked up on the next tick", async () => {
    const h = harness();
    await h.emit("session_start");
    h.rename("renamed");
    await h.emit("session_info_changed");
    await tick();
    expect(h.titles.at(-1)).toBe("π - renamed - my-project");
  });

  test("an empty session name drops its part", async () => {
    const h = harness({ sessionName: "" });
    await h.emit("session_start");
    expect(h.titles.at(-1)).toBe("π - my-project");
  });

  test("current tool and thinking level follow their events", async () => {
    writeFileSync(
      path.join(agentDir, "pi-status.json"),
      JSON.stringify({
        separator: " | ",
        // Components a config leaves out are added with their default state
        // (pi_symbol, session and cwd default on), so switch those off.
        components: [
          { id: "thinking", enabled: true },
          { id: "current_tool", enabled: true },
          { id: "pi_symbol", enabled: false },
          { id: "session", enabled: false },
          { id: "cwd", enabled: false },
        ],
      }),
    );
    const h = harness();
    await h.emit("session_start");
    expect(h.titles.at(-1)).toBe("high");
    await h.emit("thinking_level_select", { level: "low", previousLevel: "high" });
    expect(h.titles.at(-1)).toBe("low");
    await h.emit("tool_execution_start", { toolName: "bash" });
    expect(h.titles.at(-1)).toBe("low | bash");
    await h.emit("tool_execution_end", {});
    expect(h.titles.at(-1)).toBe("low");
  });

  test("off stops setting the title; on resumes it", async () => {
    const h = harness();
    await h.emit("session_start");
    await h.command("off");
    const n = h.titles.length;
    await h.emit("agent_start");
    await h.emit("agent_end");
    await tick();
    expect(h.titles.length).toBe(n);
    await h.command("on");
    expect(h.titles.at(-1)).toBe("π - my-session - my-project");
  });

  test("nothing is written after shutdown", async () => {
    const h = harness();
    await h.emit("session_start");
    await h.emit("agent_start");
    await h.emit("session_shutdown");
    const n = h.titles.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(h.titles.length).toBe(n);
  });
});
