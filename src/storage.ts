import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { DoumState, HelpSettings, ServerTagScanSummary, ServerTagSettings } from "./types.js";

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

export function createDefaultState(): DoumState {
  const defaultGuildId = config.discordGuildId;

  return {
    version: 1,
    help: {
      systemPrompt: defaultSystemPrompt,
      maxAnswerLength: 1200
    },
    serverTag: {
      enabled: true,
      guildId: defaultGuildId,
      targetGuildId: defaultGuildId,
      targetTag: "",
      roleId: "",
      roleName: "DOUM 태그 인증",
      removeWhenMissing: true,
      scanOnReady: true,
      scanIntervalMinutes: 10
    },
    updatedAt: now()
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

export function normalizeState(value: unknown): DoumState {
  const defaults = createDefaultState();
  const raw = value && typeof value === "object" ? (value as Partial<DoumState>) : {};
  const rawHelp: Partial<HelpSettings> = raw.help && typeof raw.help === "object" ? raw.help : {};
  const rawServerTag: Partial<ServerTagSettings> =
    raw.serverTag && typeof raw.serverTag === "object" ? raw.serverTag : {};
  const lastScanSummary = normalizeScanSummary(rawServerTag.lastScanSummary);

  return {
    version: 1,
    help: {
      systemPrompt: stringValue(rawHelp.systemPrompt, defaults.help.systemPrompt, 4000),
      maxAnswerLength: clampInteger(rawHelp.maxAnswerLength, defaults.help.maxAnswerLength, 300, 1900)
    },
    serverTag: {
      enabled: booleanValue(rawServerTag.enabled, defaults.serverTag.enabled),
      guildId: stringValue(rawServerTag.guildId, defaults.serverTag.guildId, 32),
      targetGuildId: stringValue(rawServerTag.targetGuildId, defaults.serverTag.targetGuildId, 32),
      targetTag: stringValue(rawServerTag.targetTag, defaults.serverTag.targetTag, 4),
      roleId: stringValue(rawServerTag.roleId, defaults.serverTag.roleId, 32),
      roleName: stringValue(rawServerTag.roleName, defaults.serverTag.roleName, 80) || defaults.serverTag.roleName,
      removeWhenMissing: booleanValue(rawServerTag.removeWhenMissing, defaults.serverTag.removeWhenMissing),
      scanOnReady: booleanValue(rawServerTag.scanOnReady, defaults.serverTag.scanOnReady),
      scanIntervalMinutes: clampInteger(rawServerTag.scanIntervalMinutes, defaults.serverTag.scanIntervalMinutes, 1, 1440),
      lastScanAt: stringValue(rawServerTag.lastScanAt, ""),
      lastScanSummary
    },
    updatedAt: stringValue(raw.updatedAt, now())
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
