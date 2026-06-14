import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { BotState, Direction, IndexEvent, Settlement, UserPoints } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

export function createDefaultState(): BotState {
  return {
    version: 1,
    index: 100,
    mood: "보합",
    recentFlow: "아직 결산된 흐름이 없습니다.",
    users: {},
    predictions: {},
    history: [],
    indexHistory: [],
    updatedAt: now()
  };
}

function normalizeDirection(value: unknown): Direction {
  return value === "상승" || value === "하락" || value === "보합" ? value : "보합";
}

function normalizeUsers(value: unknown): Record<string, UserPoints> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, UserPoints> = {};
  for (const [id, rawUser] of Object.entries(value)) {
    if (!rawUser || typeof rawUser !== "object") {
      continue;
    }

    const user = rawUser as Partial<UserPoints>;
    normalized[id] = {
      displayName: String(user.displayName ?? "이름 없음"),
      points: Number.isFinite(user.points) ? Number(user.points) : config.startingPoints
    };
  }

  return normalized;
}

function normalizeSettlement(value: unknown): Settlement | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Partial<Settlement>;
  if (!Number.isFinite(raw.previousIndex) || !Number.isFinite(raw.finalIndex) || !Number.isFinite(raw.delta)) {
    return undefined;
  }

  return {
    result: normalizeDirection(raw.result),
    delta: Number(raw.delta),
    previousIndex: Number(raw.previousIndex),
    finalIndex: Number(raw.finalIndex),
    winners: Array.isArray(raw.winners) ? raw.winners.map(String) : [],
    losers: Array.isArray(raw.losers) ? raw.losers.map(String) : [],
    settledAt: String(raw.settledAt ?? now())
  };
}

function normalizeIndexEvent(value: unknown): IndexEvent | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Partial<IndexEvent>;
  if (!Number.isFinite(raw.previousIndex) || !Number.isFinite(raw.finalIndex) || !Number.isFinite(raw.delta)) {
    return undefined;
  }

  return {
    type: raw.type === "personality_block" ? "personality_block" : "settlement",
    label: String(raw.label ?? "세냥 지수 변동"),
    direction: normalizeDirection(raw.direction),
    delta: Number(raw.delta),
    previousIndex: Number(raw.previousIndex),
    finalIndex: Number(raw.finalIndex),
    createdAt: String(raw.createdAt ?? now())
  };
}

function indexEventsFromSettlements(history: Settlement[]): IndexEvent[] {
  return history.map((settlement) => ({
    type: "settlement",
    label: "세냥장 마감",
    direction: settlement.result,
    delta: settlement.delta,
    previousIndex: settlement.previousIndex,
    finalIndex: settlement.finalIndex,
    createdAt: settlement.settledAt
  }));
}

export async function loadState(): Promise<BotState> {
  await fs.mkdir(path.dirname(config.dataFile), { recursive: true });

  try {
    const raw = await fs.readFile(config.dataFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<BotState>;
    const history = Array.isArray(parsed.history)
      ? parsed.history.map(normalizeSettlement).filter((item): item is Settlement => Boolean(item))
      : [];
    const indexHistory = Array.isArray(parsed.indexHistory)
      ? parsed.indexHistory.map(normalizeIndexEvent).filter((item): item is IndexEvent => Boolean(item))
      : indexEventsFromSettlements(history);

    return {
      ...createDefaultState(),
      ...parsed,
      version: 1,
      index: Number.isFinite(parsed.index) ? Number(parsed.index) : 100,
      mood: normalizeDirection(parsed.mood),
      recentFlow: parsed.recentFlow ?? "아직 결산된 흐름이 없습니다.",
      users: normalizeUsers(parsed.users),
      predictions: parsed.predictions ?? {},
      history,
      indexHistory,
      updatedAt: parsed.updatedAt ?? now()
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultState();
    }

    throw error;
  }
}

export async function saveState(state: BotState): Promise<void> {
  state.updatedAt = now();
  await fs.mkdir(path.dirname(config.dataFile), { recursive: true });
  await fs.writeFile(config.dataFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
