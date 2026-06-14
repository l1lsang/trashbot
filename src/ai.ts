import OpenAI from "openai";
import { config } from "./config.js";
import { localAnalyzeScenario, SENYANG_SYSTEM_PROMPT } from "./senyang.js";
import type { DetectionFlags, Direction, FaceRevealReaction, PredictionResult } from "./types.js";

let client: OpenAI | undefined;

function getClient(): OpenAI | undefined {
  if (!config.openaiApiKey) {
    return undefined;
  }

  client ??= new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "O" || value === "true";
}

function asDirection(value: unknown): Direction {
  return value === "상승" || value === "하락" || value === "보합" ? value : "보합";
}

function asReaction(value: unknown): FaceRevealReaction {
  return value === "긍정" || value === "부정" || value === "정보 부족" || value === "해당 없음" ? value : "해당 없음";
}

function normalizeFlags(value: unknown): DetectionFlags {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    petting: asBoolean(raw.petting),
    greeting: asBoolean(raw.greeting),
    cute: asBoolean(raw.cute),
    sweetTone: asBoolean(raw.sweetTone),
    praise: asBoolean(raw.praise),
    ignored: asBoolean(raw.ignored),
    serverBlocked: asBoolean(raw.serverBlocked),
    selfBlockedByPersonality: asBoolean(raw.selfBlockedByPersonality),
    faceReveal: asBoolean(raw.faceReveal),
    faceRevealReaction: asReaction(raw.faceRevealReaction)
  };
}

function normalizePrediction(value: unknown, currentIndex: number, fallbackText: string): PredictionResult {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const delta = Number.isFinite(raw.delta) ? Number(raw.delta) : 0;
  const safetyStop = asBoolean(raw.safetyStop);
  const direction = asDirection(raw.direction);
  const finalIndex = Number.isFinite(raw.finalIndex) ? Number(raw.finalIndex) : Math.max(0, currentIndex + delta);
  const confidence = raw.confidence === "높음" || raw.confidence === "보통" || raw.confidence === "낮음" ? raw.confidence : "낮음";
  const flags = normalizeFlags(raw.flags);
  const analysis = Array.isArray(raw.analysis) ? raw.analysis.map(String).slice(0, 5) : [fallbackText];
  const oneLine = typeof raw.oneLine === "string" && raw.oneLine.trim() ? raw.oneLine.trim() : "세냥장, 조심스럽게 관망합니다 🐾";

  return {
    safetyStop,
    safetyReason: typeof raw.safetyReason === "string" ? raw.safetyReason : undefined,
    direction,
    currentIndex,
    delta,
    finalIndex,
    confidence,
    flags,
    analysis,
    oneLine
  };
}

export async function analyzeScenario(scenario: string, currentIndex: number): Promise<PredictionResult> {
  const openai = getClient();
  if (!openai) {
    return localAnalyzeScenario(scenario, currentIndex);
  }

  const jsonInstruction = `
${SENYANG_SYSTEM_PROMPT}

아래 JSON 형태만 출력하세요. 마크다운 코드블록을 쓰지 마세요.
{
  "safetyStop": boolean,
  "safetyReason": string | undefined,
  "direction": "상승" | "하락" | "보합",
  "currentIndex": number,
  "delta": number,
  "finalIndex": number,
  "confidence": "낮음" | "보통" | "높음",
  "flags": {
    "petting": boolean,
    "greeting": boolean,
    "cute": boolean,
    "sweetTone": boolean,
    "praise": boolean,
    "ignored": boolean,
    "serverBlocked": boolean,
    "selfBlockedByPersonality": boolean,
    "faceReveal": boolean,
    "faceRevealReaction": "긍정" | "부정" | "정보 부족" | "해당 없음"
  },
  "analysis": string[],
  "oneLine": string
}
`.trim();

  try {
    const response = (await openai.responses.create({
      model: config.openaiModel,
      instructions: jsonInstruction,
      input: `현재 세냥 지수: ${currentIndex}\n상황:\n${scenario}`
    })) as unknown as { output_text?: string };

    const outputText = response.output_text ?? "";
    const parsed = JSON.parse(stripCodeFence(outputText)) as unknown;
    return normalizePrediction(parsed, currentIndex, "GPT 분석 결과를 정리했습니다.");
  } catch (error) {
    console.error("OpenAI prediction failed; falling back to local analyzer.", error);
    return localAnalyzeScenario(scenario, currentIndex);
  }
}

export interface ChatMemoryItem {
  author: string;
  content: string;
}

const fallbackProactiveReplies = [
  "세냥장 조용한 매수세 감지... 다들 살아있나요냥?",
  "갑자기 세냥 지수가 혼자 꼬물거렸습니다. 아무 일 없지만 괜히 공시합니다냥.",
  "세냥장 알림: 지금 분위기 보합권입니다. 누가 귀여움 호재 하나만 던져주세요냥.",
  "심심해서 먼저 말 걸어봤습니다. 이 발언은 투자 조언이 아니라 귀여움 중계입니다냥."
];

function randomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export async function generateConversationReply(
  currentMessage: string,
  author: string,
  memory: ChatMemoryItem[]
): Promise<string | undefined> {
  const openai = getClient();
  if (!openai) {
    return "세냥장 GPT 연결 키가 아직 없어서 잠시 휴장 중이에요. `.env`에 `OPENAI_API_KEY`를 넣으면 바로 다시 열립니다냥 🐾";
  }

  const recentConversation = memory
    .slice(-12)
    .map((item) => `${item.author}: ${item.content}`)
    .join("\n");

  try {
    const response = (await openai.responses.create({
      model: config.openaiModel,
      instructions: `
${SENYANG_SYSTEM_PROMPT}

당신은 디스코드 공개 채널에서 짧게 대화합니다.
- 답변은 700자 이내로 합니다.
- 명령어 결과 형식을 그대로 길게 출력하지 말고, 자연스럽고 귀여운 봇 말투로 반응합니다.
- 실제 감정 단정, 실제 투자 조언, 현실 보상 언급은 피합니다.
- 안전 중단 상황이면 "세냥장 일시 정지" 취지로 짧게 거절합니다.
`.trim(),
      input: `최근 공개 대화:\n${recentConversation || "(없음)"}\n\n현재 메시지 작성자: ${author}\n현재 메시지:\n${currentMessage}`
    })) as unknown as { output_text?: string };

    return response.output_text?.trim();
  } catch (error) {
    console.error("OpenAI chat reply failed.", error);
    return "세냥장 중계석 연결이 잠깐 흔들렸어요. 조금 뒤에 다시 불러주세요냥 🐾";
  }
}

export async function generateProactiveReply(memory: ChatMemoryItem[]): Promise<string | undefined> {
  const openai = getClient();
  if (!openai) {
    return randomChoice(fallbackProactiveReplies);
  }

  const recentConversation = memory
    .slice(-12)
    .map((item) => `${item.author}: ${item.content}`)
    .join("\n");

  try {
    const response = (await openai.responses.create({
      model: config.openaiModel,
      instructions: `
${SENYANG_SYSTEM_PROMPT}

당신은 디스코드 공개 채널에서 세냥 봇이 먼저 말을 거는 상황입니다.
- 답변은 220자 이내로 짧게 합니다.
- 최근 대화를 가볍게 참고하되, 사용자가 직접 부르지 않았으므로 부담스럽지 않게 말합니다.
- 실제 감정 단정, 실제 투자 조언, 현실 보상 언급은 피합니다.
- "성격차이로 차단" 이벤트는 여기서 직접 선언하지 않습니다. 그 이벤트는 별도 시스템이 처리합니다.
`.trim(),
      input: `최근 공개 대화:\n${recentConversation || "(없음)"}\n\n세냥 봇이 먼저 한마디 건넵니다.`
    })) as unknown as { output_text?: string };

    return response.output_text?.trim();
  } catch (error) {
    console.error("OpenAI proactive reply failed.", error);
    return randomChoice(fallbackProactiveReplies);
  }
}
