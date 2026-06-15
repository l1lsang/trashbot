import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { DoumState, GuildSettings, HelpSettings, ServerTagScanSummary, ServerTagSettings } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

const defaultSystemPrompt = `
당신은 "DOUM"이라는 디스코드 도움 봇입니다.

역할:
- 사용자의 질문을 한국어로 명확하고 실용적으로 답합니다.
- 서버 운영, 디스코드 사용법, 일반 지식, 간단한 코드/문서 작업을 도와줍니다.
- 모르면 추측을 사실처럼 말하지 말고 확인이 필요하다고 말합니다.
- 위험하거나 불법적인 요청, 개인정보 침해, 괴롭힘, 자해 조장, 악성코드 제작은 거절합니다.
- 답변은 친절하지만 장황하지 않게 작성합니다.
`.trim();

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function stringValue(value: unknown, fallback = "", maxLength = 2000): string {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().slice(0, maxLength);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function createDefaultHelpSettings(): HelpSettings {
  return {
    systemPrompt: defaultSystemPrompt,
    maxAnswerLength: 1200
  };
}

function createDefaultServerTagSettings(guildId = "", enabled = false): ServerTagSettings {
  return {
    enabled,
    guildId,
    targetGuildId: guildId,
    targetTag: "",
    roleId: "",
    roleName: "DOUM 태그 인증",
    removeWhenMissing: true,
    scanOnReady: false,
    scanIntervalMinutes: 10
  };
}

export function createDefaultGuildSettings(guildId = "", enabled = false): GuildSettings {
  return {
    help: createDefaultHelpSettings(),
    serverTag: createDefaultServerTagSettings(guildId, enabled),
    updatedAt: now()
  };
}

export function createDefaultState(): DoumState {
  const defaultGuildId = config.discordGuildId;
  const defaultGuildSettings = createDefaultGuildSettings(defaultGuildId, false);

  return {
    version: 1,
    help: defaultGuildSettings.help,
    serverTag: defaultGuildSettings.serverTag,
    guildSettings: {},
    updatedAt: now()
  };
}

function normalizeHelpSettings(value: unknown, fallback: HelpSettings): HelpSettings {
  const raw = value && typeof value === "object" ? (value as Partial<HelpSettings>) : {};

  return {
    systemPrompt: stringValue(raw.systemPrompt, fallback.systemPrompt, 4000),
    maxAnswerLength: clampInteger(raw.maxAnswerLength, fallback.maxAnswerLength, 300, 1900)
  };
}

function normalizeScanSummary(value: unknown): ServerTagScanSummary | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Partial<ServerTagScanSummary>;

  return {
    guildId: stringValue(raw.guildId, ""),
    guildName: stringValue(raw.guildName, "알 수 없는 서버", 200),
    checked: clampInteger(raw.checked, 0, 0, Number.MAX_SAFE_INTEGER),
    matched: clampInteger(raw.matched, 0, 0, Number.MAX_SAFE_INTEGER),
    granted: clampInteger(raw.granted, 0, 0, Number.MAX_SAFE_INTEGER),
    removed: clampInteger(raw.removed, 0, 0, Number.MAX_SAFE_INTEGER),
    unchanged: clampInteger(raw.unchanged, 0, 0, Number.MAX_SAFE_INTEGER),
    skipped: clampInteger(raw.skipped, 0, 0, Number.MAX_SAFE_INTEGER),
    errors: Array.isArray(raw.errors) ? raw.errors.map(String).slice(0, 20) : [],
    scannedAt: stringValue(raw.scannedAt, now())
  };
}

function normalizeServerTagSettings(
  value: unknown,
  fallback: ServerTagSettings,
  guildIdFallback = fallback.guildId
): ServerTagSettings {
  const raw = value && typeof value === "object" ? (value as Partial<ServerTagSettings>) : {};
  const guildId = stringValue(raw.guildId, guildIdFallback, 32);
  const targetGuildId = stringValue(raw.targetGuildId, fallback.targetGuildId || guildId, 32);

  return {
    enabled: booleanValue(raw.enabled, fallback.enabled),
    guildId,
    targetGuildId: targetGuildId || guildId,
    targetTag: stringValue(raw.targetTag, fallback.targetTag, 4),
    roleId: stringValue(raw.roleId, fallback.roleId, 32),
    roleName: stringValue(raw.roleName, fallback.roleName, 80) || fallback.roleName,
    removeWhenMissing: booleanValue(raw.removeWhenMissing, fallback.removeWhenMissing),
    scanOnReady: booleanValue(raw.scanOnReady, fallback.scanOnReady),
    scanIntervalMinutes: clampInteger(raw.scanIntervalMinutes, fallback.scanIntervalMinutes, 1, 1440),
    lastScanAt: stringValue(raw.lastScanAt, ""),
    lastScanSummary: normalizeScanSummary(raw.lastScanSummary)
  };
}

function normalizeGuildSettings(value: unknown, fallback: GuildSettings, guildId: string): GuildSettings {
  const raw = value && typeof value === "object" ? (value as Partial<GuildSettings>) : {};

  return {
    help: normalizeHelpSettings(raw.help, fallback.help),
    serverTag: normalizeServerTagSettings(raw.serverTag, fallback.serverTag, guildId),
    updatedAt: stringValue(raw.updatedAt, now())
  };
}

function normalizeGuildSettingsMap(value: unknown, fallback: GuildSettings): Record<string, GuildSettings> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, GuildSettings> = {};
  for (const [guildId, rawSettings] of Object.entries(value)) {
    const id = stringValue(guildId, "", 32);
    if (!id) {
      continue;
    }

    normalized[id] = normalizeGuildSettings(rawSettings, createDefaultGuildSettings(id, false), id);
  }

  if (Object.keys(normalized).length > 0) {
    return normalized;
  }

  return {};
}

export function normalizeState(value: unknown): DoumState {
  const defaults = createDefaultState();
  const raw = value && typeof value === "object" ? (value as Partial<DoumState>) : {};
  const help = normalizeHelpSettings(raw.help, defaults.help);
  const serverTag = normalizeServerTagSettings(raw.serverTag, defaults.serverTag, defaults.serverTag.guildId);
  const legacyFallback: GuildSettings = {
    help,
    serverTag,
    updatedAt: stringValue(raw.updatedAt, now())
  };
  const guildSettings = normalizeGuildSettingsMap(raw.guildSettings, legacyFallback);

  if (Object.keys(guildSettings).length === 0 && serverTag.guildId) {
    guildSettings[serverTag.guildId] = normalizeGuildSettings(legacyFallback, legacyFallback, serverTag.guildId);
  }

  return {
    version: 1,
    help,
    serverTag,
    guildSettings,
    updatedAt: stringValue(raw.updatedAt, now())
  };
}

export function ensureGuildSettings(state: DoumState, guildId: string, guildName?: string): GuildSettings {
  const id = stringValue(guildId, "", 32);
  if (!id) {
    return {
      help: state.help,
      serverTag: state.serverTag,
      updatedAt: state.updatedAt
    };
  }

  const existing = state.guildSettings[id];
  if (existing) {
    existing.serverTag.guildId = id;
    if (!existing.serverTag.targetGuildId) {
      existing.serverTag.targetGuildId = id;
    }
    return existing;
  }

  const created = normalizeGuildSettings(
    {
      help: state.help,
      serverTag: {
        ...state.serverTag,
        enabled: false,
        guildId: id,
        targetGuildId: id,
        roleId: "",
        lastScanAt: "",
        lastScanSummary: undefined
      }
    },
    createDefaultGuildSettings(id, false),
    id
  );

  created.updatedAt = now();
  state.guildSettings[id] = created;
  void guildName;
  return created;
}

export function getGuildSettings(state: DoumState, guildId: string | null | undefined): GuildSettings {
  if (!guildId) {
    return {
      help: state.help,
      serverTag: state.serverTag,
      updatedAt: state.updatedAt
    };
  }

  return state.guildSettings[guildId] ?? {
    help: state.help,
    serverTag: {
      ...state.serverTag,
      enabled: false,
      guildId,
      targetGuildId: guildId,
      roleId: "",
      lastScanAt: "",
      lastScanSummary: undefined
    },
    updatedAt: state.updatedAt
  };
}

export async function loadState(): Promise<DoumState> {
  await fs.mkdir(path.dirname(config.dataFile), { recursive: true });

  try {
    const raw = await fs.readFile(config.dataFile, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultState();
    }

    throw error;
  }
}

export async function saveState(state: DoumState): Promise<void> {
  const normalized = normalizeState({
    ...state,
    updatedAt: now()
  });

  await fs.mkdir(path.dirname(config.dataFile), { recursive: true });
  await fs.writeFile(config.dataFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
