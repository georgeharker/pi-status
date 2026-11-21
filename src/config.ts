/**
 * pi-title configuration: the components and separator of the title, kept
 * in pi-title.json in pi's agent dir (pi's getAgentDir: PI_CODING_AGENT_DIR,
 * else ~/.pi/agent). That is the only file pi-title writes. A project's
 * .pi/pi-title.json, if present, is read instead (a per-project override,
 * never written). pi's own settings.json is never read or written.
 *
 * Earlier versions were named pi-status: a pi-status.json (global or
 * project) is still read when there is no pi-title.json beside it, and
 * PI_STATUS_DISABLED is honoured alongside PI_TITLE_DISABLED.
 */
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const ALL_COMPONENT_IDS = [
  "pi_symbol",
  "session",
  "cwd",
  "model",
  "thinking",
  "tokens",
  "turn",
  "git_branch",
  "tools_count",
  "current_tool",
] as const;

export type ComponentId = (typeof ALL_COMPONENT_IDS)[number];

export interface ComponentConfig {
  id: ComponentId;
  enabled: boolean;
}

export interface PiTitleConfig {
  separator: string;
  components: ComponentConfig[];
}

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  pi_symbol: "π symbol",
  session: "Session name",
  cwd: "Working directory",
  model: "Current model",
  thinking: "Thinking level",
  tokens: "Token usage",
  turn: "Turn number",
  git_branch: "Git branch",
  tools_count: "Active tool count",
  current_tool: "Current tool name",
};

const DEFAULT_ENABLED: ReadonlySet<ComponentId> = new Set(["pi_symbol", "session", "cwd"]);

export const DEFAULT_CONFIG: PiTitleConfig = {
  separator: " - ",
  components: ALL_COMPONENT_IDS.map((id) => ({ id, enabled: DEFAULT_ENABLED.has(id) })),
};

/** The longest separator /pi-title accepts. */
export const MAX_SEPARATOR_LENGTH = 5;

/** Set to 1/true/yes/on to start with pi-title disabled. */
export const DISABLE_ENV = "PI_TITLE_DISABLED";
/** The same, from when this was pi-status. */
export const LEGACY_DISABLE_ENV = "PI_STATUS_DISABLED";

const isComponentId = (id: unknown): id is ComponentId =>
  typeof id === "string" && (ALL_COMPONENT_IDS as readonly string[]).includes(id);

/** A pi-title.json as read from disk, before it is checked. */
export interface StoredConfig {
  separator?: unknown;
  components?: unknown;
}

/** A usable config from whatever was stored: a missing or malformed value
 *  is the default; unknown components (e.g. ones a later or earlier version
 *  had) are dropped; the stored order is kept, and components it leaves out
 *  are added at the end in their default state. */
export function normalizeConfig(stored: StoredConfig | undefined): PiTitleConfig {
  if (!stored) return structuredClone(DEFAULT_CONFIG);
  const separator = typeof stored.separator === "string" ? stored.separator : DEFAULT_CONFIG.separator;
  const listed = Array.isArray(stored.components) ? stored.components : [];
  const components: ComponentConfig[] = [];
  const seen = new Set<ComponentId>();
  for (const c of listed as Array<{ id?: unknown; enabled?: unknown }>) {
    if (!isComponentId(c?.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    components.push({ id: c.id, enabled: c.enabled !== false });
  }
  for (const id of ALL_COMPONENT_IDS) {
    if (!seen.has(id)) components.push({ id, enabled: DEFAULT_ENABLED.has(id) });
  }
  return { separator, components };
}

export interface ConfigPaths {
  /** <agent dir>/pi-title.json: read when there is no project file, and
   *  the only file written. */
  global: string;
  /** <cwd>/.pi/pi-title.json: read in place of the global file. */
  project: string;
  /** The pi-status.json beside each, read when it is missing. */
  legacyGlobal: string;
  legacyProject: string;
}

export function configPaths(cwd: string = process.cwd(), agentDir: string = getAgentDir()): ConfigPaths {
  return {
    global: path.join(agentDir, "pi-title.json"),
    project: path.join(cwd, ".pi", "pi-title.json"),
    legacyGlobal: path.join(agentDir, "pi-status.json"),
    legacyProject: path.join(cwd, ".pi", "pi-status.json"),
  };
}

/** The file at `filePath` if it is a JSON object, else undefined (missing,
 *  unreadable, malformed, or not an object). */
function readStored(filePath: string): StoredConfig | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const parsed: StoredConfig | null = JSON.parse(readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The config in effect: the project file, else the global file, else the
 *  default; normalized. */
export function loadConfig(paths: ConfigPaths = configPaths()): PiTitleConfig {
  return normalizeConfig(
    readStored(paths.project) ??
      readStored(paths.legacyProject) ??
      readStored(paths.global) ??
      readStored(paths.legacyGlobal),
  );
}

/** Write `config` to the global file. */
export function saveConfig(config: PiTitleConfig, paths: ConfigPaths = configPaths()): void {
  mkdirSync(path.dirname(paths.global), { recursive: true });
  writeFileSync(paths.global, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function isDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return [DISABLE_ENV, LEGACY_DISABLE_ENV].some((name) => {
    const value = env[name]?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "on";
  });
}
