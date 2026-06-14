import { config } from "./config.js";
import type { BotState, Direction, IndexEvent, PredictionEntry, Settlement, UserPoints } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

export function ensureUser(state: BotState, userId: string, displayName: string): UserPoints {
  const existing = state.users[userId];
  if (existing) {
    existing.displayName = displayName;
    return existing;
  }

  state.users[userId] = {
    displayName,
    points: config.startingPoints
  };

  return state.users[userId];
}

export function placePrediction(
  state: BotState,
  userId: string,
  displayName: string,
  direction: Direction
): PredictionEntry {
  const user = ensureUser(state, userId, displayName);
  const existing = state.predictions[userId];

  if (existing) {
    user.points += existing.stake;
  }

  if (user.points < config.betStake) {
    throw new Error(`냥포인트가 부족합니다. 현재 ${user.points}냥, 필요 ${config.betStake}냥입니다.`);
  }

  user.points -= config.betStake;

  const prediction: PredictionEntry = {
    userId,
    displayName,
    direction,
    stake: config.betStake,
    createdAt: now()
  };

  state.predictions[userId] = prediction;
  state.recentFlow = `${displayName} 님이 ${direction} 예측을 접수했습니다.`;
  return prediction;
}

export function recordIndexEvent(
  state: BotState,
  event: Omit<IndexEvent, "createdAt"> & { createdAt?: string }
): IndexEvent {
  const indexEvent: IndexEvent = {
    ...event,
    createdAt: event.createdAt ?? now()
  };

  state.indexHistory = [indexEvent, ...(state.indexHistory ?? [])].slice(0, 30);
  return indexEvent;
}

export function settlePredictions(state: BotState, result: Direction, requestedDelta?: number): Settlement {
  const previousIndex = state.index;
  const delta = Number.isFinite(requestedDelta)
    ? Number(requestedDelta)
    : result === "상승"
      ? config.betStake
      : result === "하락"
        ? -config.betStake
        : 0;

  const winners: string[] = [];
  const losers: string[] = [];

  for (const prediction of Object.values(state.predictions)) {
    const user = ensureUser(state, prediction.userId, prediction.displayName);

    if (prediction.direction === result) {
      user.points += prediction.stake * 2;
      winners.push(prediction.displayName);
    } else {
      losers.push(prediction.displayName);
    }
  }

  const finalIndex = Math.max(0, previousIndex + delta);
  state.index = finalIndex;
  state.mood = result;
  state.recentFlow = `${result} 결과로 ${delta >= 0 ? "+" : ""}${delta} 변동, ${previousIndex}에서 ${finalIndex}로 마감했습니다.`;
  state.predictions = {};
  recordIndexEvent(state, {
    type: "settlement",
    label: "세냥장 마감",
    direction: result,
    delta,
    previousIndex,
    finalIndex
  });

  const settlement: Settlement = {
    result,
    delta,
    previousIndex,
    finalIndex,
    winners,
    losers,
    settledAt: now()
  };

  state.history = [settlement, ...state.history].slice(0, 20);
  return settlement;
}

export function formatStatus(state: BotState): string {
  return [
    "🐾 세냥 지수 현황",
    "",
    `- 현재 지수: ${state.index}`,
    `- 현재 분위기: ${state.mood}`,
    `- 최근 흐름: ${state.recentFlow}`,
    `- 진행 중 예측: ${Object.keys(state.predictions).length}명`,
    "- 해석: 세냥장은 순수 오락용 분위기 지수로만 봐주세요.",
    "",
    "※ 이 지수는 순수 오락용입니다."
  ].join("\n");
}

export function formatPredictionReceipt(prediction: PredictionEntry): string {
  const title =
    prediction.direction === "상승"
      ? "🐱 상승 예측 접수 완료"
      : prediction.direction === "하락"
        ? "🐱 하락 예측 접수 완료"
        : "🐾 보합 예측 접수 완료";

  return [
    title,
    "",
    `- 참가자: ${prediction.displayName}`,
    `- 예측 방향: ${prediction.direction}`,
    `- 사용 포인트: ${prediction.stake}냥`,
    "- 안내: 이 포인트는 현실 가치가 없는 오락용 포인트입니다."
  ].join("\n");
}

export function formatSettlement(settlement: Settlement, automated = false): string {
  const winnerText = settlement.winners.length ? settlement.winners.join(", ") : "없음";
  const loserText = settlement.losers.length ? settlement.losers.join(", ") : "없음";
  const deltaText = settlement.delta >= 0 ? `+${settlement.delta}` : String(settlement.delta);

  return [
    automated ? "📊 세냥장 자동 마감" : "📊 세냥장 마감",
    "",
    `- ${automated ? "자동 결과" : "공식 결과"}: ${settlement.result}`,
    `- 지수 변화: ${deltaText}`,
    `- 최종 세냥 지수: ${settlement.finalIndex}`,
    `- 적중자: ${winnerText}`,
    `- 미적중자: ${loserText}`,
    automated
      ? "- 오늘의 총평: 마지막 예측 결과를 기준으로 자동 정산했어요."
      : "- 오늘의 총평: 세냥장 마감입니다. 결과 제공 기준으로만 귀엽게 정산했어요.",
    "",
    automated
      ? "※ 자동결산은 마지막 예측을 게임 결과로 사용하는 오락용 기능이며, 실제 감정 판단이 아닙니다."
      : "※ 모든 결과는 오락용입니다."
  ].join("\n");
}

export function formatRanking(state: BotState): string {
  const ranking = Object.values(state.users)
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  const rows = ranking.length
    ? ranking.map((user, index) => `${index + 1}. ${user.displayName} - ${user.points}냥`)
    : ["아직 랭킹에 표시할 참가자가 없습니다."];

  return ["🏆 세냥 예측 랭킹", "", ...rows, "", "※ 냥포인트는 현실 가치가 없는 오락용 포인트입니다."].join(
    "\n"
  );
}
