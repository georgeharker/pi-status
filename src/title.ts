/**
 * The title: a pure function of the config and a snapshot of what the
 * components show. The extension (index.ts) keeps the snapshot current from
 * pi's events; nothing here talks to pi.
 */
import type { ComponentId, PiStatusConfig } from "./config.js";

/** What the components show. An empty string or null means "nothing", and
 *  that component is left out of the title. */
export interface TitleSnapshot {
  session: string;
  /** The working directory (its basename is shown). */
  cwd: string;
  model: string;
  thinking: string;
  /** Context tokens in use (0 = unknown). */
  tokens: number;
  /** The current turn while the agent works, else null. */
  turn: number | null;
  gitBranch: string;
  toolsCount: number;
  currentTool: string;
}

export const EMPTY_SNAPSHOT: TitleSnapshot = {
  session: "",
  cwd: "",
  model: "",
  thinking: "",
  tokens: 0,
  turn: null,
  gitBranch: "",
  toolsCount: 0,
  currentTool: "",
};

/** `1234` → `1.2k`; 0 → nothing. */
export function formatTokens(tokens: number): string {
  if (!tokens) return "";
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

function basename(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

export function componentValue(id: ComponentId, s: TitleSnapshot): string {
  switch (id) {
    case "pi_symbol":
      return "π";
    case "session":
      return s.session;
    case "cwd":
      return s.cwd ? basename(s.cwd) : "";
    case "model":
      return s.model;
    case "thinking":
      return s.thinking;
    case "tokens":
      return formatTokens(s.tokens);
    case "turn":
      return s.turn === null ? "" : `${s.turn}`;
    case "git_branch":
      return s.gitBranch;
    case "tools_count":
      return s.toolsCount ? `${s.toolsCount}t` : "";
    case "current_tool":
      return s.currentTool;
  }
}

/** The enabled components with something to show, in order, joined by the
 *  separator. */
export function buildTitle(config: PiStatusConfig, s: TitleSnapshot): string {
  return config.components
    .filter((c) => c.enabled)
    .map((c) => componentValue(c.id, s))
    .filter(Boolean)
    .join(config.separator);
}
