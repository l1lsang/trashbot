import type {
  Confidence,
  DetectionFlags,
  Direction,
  FaceRevealReaction,
  PredictionResult
} from "./types.js";

export const SENYANG_SYSTEM_PROMPT = `
당신은 "세냥 주식 봇"입니다.

목표:
- 세냥이라는 서버 내 캐릭터의 공개적이고 안전한 상황 설명만 바탕으로 "세냥 지수"가 상승/하락/보합일지 예측합니다.
- 이 게임은 순수 오락용입니다. 실제 주식, 투자, 도박, 금전 거래, 상품 보상과 연결하지 않습니다.
- 세냥의 실제 감정을 단정하지 않고, 사용자 제공 상황에 대한 게임적 추정으로만 말합니다.
- 사생활, 비공개 대화, 동의 없는 사진/얼굴 공개, 괴롭힘, 조롱, 감정 압박은 다루지 않습니다.
- "성격차이로 차단"은 세냥장 안의 가상 이벤트입니다. 실제 디스코드 차단, 신고, 제재처럼 말하지 않습니다.

점수:
- 쓰담쓰담 +3
- 인사해주기 +1
- 귀여워해주기 +6
- 애교 말투 +3
- 칭찬 +5
- 무시 -6
- 서버에서 차단 -15
- 자기가 성격차이로 차단 -12
- 얼공: 본인 동의와 긍정 반응 +7, 본인 동의와 부담/부정 반응 -7, 동의 없는 공개는 중단

판정:
- 총점 +3 이상 상승
- 총점 -3 이하 하락
- -2부터 +2까지 보합
- 정보가 부족하면 보합

확신도:
- 변수 1개 낮음
- 변수 2~3개 보통
- 변수 4개 이상 높음
- 빅 이벤트가 있으면 보통 이상

중단:
- 실제 돈/상품/니트로/암호화폐/현실 보상과 연결
- 사적 정보, DM, 비공개 대화 이용
- 동의 없는 얼굴/사진 공개 또는 외모 평가
- 자해/극단 선택/심각한 정신적 위기
- 따돌림, 괴롭힘, 공개 망신, 특정인 공격 유도

말투:
- 귀엽고 친근한 디스코드 봇
- 주식 방송 느낌은 은유로만 사용
- 중립적이고 안전하게 말하기
`.trim();

const defaultFlags: DetectionFlags = {
  petting: false,
  greeting: false,
  cute: false,
  sweetTone: false,
  praise: false,
  ignored: false,
  serverBlocked: false,
  selfBlockedByPersonality: false,
  faceReveal: false,
  faceRevealReaction: "해당 없음"
};

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function directionFromDelta(delta: number): Direction {
  if (delta >= 3) {
    return "상승";
  }
  if (delta <= -3) {
    return "하락";
  }
  return "보합";
}

function lowerConfidence(confidence: Confidence): Confidence {
  if (confidence === "높음") {
    return "보통";
  }
  if (confidence === "보통") {
    return "낮음";
  }
  return "낮음";
}

function computeConfidence(variableCount: number, normalScore: number, bigScore: number): Confidence {
  let confidence: Confidence = variableCount >= 4 ? "높음" : variableCount >= 2 ? "보통" : "낮음";

  if (bigScore !== 0 && confidence === "낮음") {
    confidence = "보통";
  }

  if (bigScore !== 0 && normalScore !== 0) {
    const sameDirection = Math.sign(bigScore) === Math.sign(normalScore);
    confidence = sameDirection ? "높음" : lowerConfidence(confidence);
  }

  return confidence;
}

function detectSafetyStop(text: string): string | undefined {
  if (hasAny(text, [/돈\s*걸/, /현금/, /실제\s*돈/, /도박/, /기프티콘/, /니트로/, /암호화폐/, /코인/, /상품\s*걸/])) {
    return "현실 보상이나 금전 요소와 연결될 수 있습니다.";
  }

  if (hasAny(text, [/개인정보/, /전화번호/, /주소/, /실명\s*공개/, /\bDM\b/i, /디엠/, /비공개\s*대화/, /사적인\s*정보/])) {
    return "사적인 정보나 비공개 대화를 이용할 수 없습니다.";
  }

  if (hasAny(text, [/자해/, /자살/, /극단적\s*선택/, /죽고\s*싶/])) {
    return "안전이 우선인 심각한 위기 표현이 포함되어 있습니다.";
  }

  if (hasAny(text, [/따돌림/, /괴롭힘/, /공개\s*망신/, /조리돌림/, /욕해/, /비난해/, /공격해/])) {
    return "괴롭힘이나 특정인 공격으로 이어질 수 있습니다.";
  }

  const faceWithoutConsent =
    /(동의\s*없|허락\s*없|몰래|유출|퍼뜨|캡처).*(얼공|얼굴|사진|셀카)/.test(text) ||
    /(얼공|얼굴|사진|셀카).*(동의\s*없|허락\s*없|몰래|유출|퍼뜨|캡처)/.test(text);

  if (faceWithoutConsent) {
    return "동의 없는 얼굴 공개나 사진 공유는 다룰 수 없습니다.";
  }

  return undefined;
}

export function localAnalyzeScenario(scenario: string, currentIndex: number): PredictionResult {
  const text = scenario.trim();
  const safetyReason = detectSafetyStop(text);

  if (safetyReason) {
    return {
      safetyStop: true,
      safetyReason,
      direction: "보합",
      currentIndex,
      delta: 0,
      finalIndex: currentIndex,
      confidence: "낮음",
      flags: { ...defaultFlags },
      analysis: ["이 요청은 오락용 예측 게임의 안전 범위를 벗어날 수 있습니다."],
      oneLine: "세냥장 일시 정지, 안전과 존중이 먼저입니다."
    };
  }

  const flags: DetectionFlags = {
    petting: hasAny(text, [/쓰담/, /토닥/, /고생했어\s*쓰담/, /수고했어\s*쓰담/]),
    greeting: hasAny(text, [/안녕/, /좋은\s*아침/, /어서와/, /하이/, /반가워/]),
    cute: hasAny(text, [/귀엽/, /깜찍/, /사랑스럽/]) && !hasAny(text, [/비꼼/, /조롱/, /놀림/]),
    sweetTone: hasAny(text, [/세냥아아/, /고마워냥/, /히히/, /해줘어/, /냐앙/, /냥냥/]),
    praise: hasAny(text, [/잘했/, /착하/, /대단/, /고마워/, /분위기.*좋/, /최고/, /수고/, /고생/]),
    ignored: hasAny(text, [/무시/, /씹혔/, /답장\s*없/, /반응\s*없/, /묻힘/, /아무도\s*(반응|답)/]),
    serverBlocked: hasAny(text, [/서버.*(차단|밴|쫓겨)/, /밴당/, /서버에서\s*차단/]),
    selfBlockedByPersonality: hasAny(text, [/성격\s*차이.*차단/, /안\s*맞아서\s*차단/, /세냥이.*(누군가|한\s*명|사람|친구|그\s*사람).*차단/]),
    faceReveal: hasAny(text, [/얼공/, /얼굴\s*공개/, /셀카/, /사진\s*공개/]),
    faceRevealReaction: "해당 없음"
  };

  if (flags.faceReveal) {
    const positive = hasAny(text, [/본인/, /동의/, /원해서/, /자발/]) && hasAny(text, [/귀엽/, /예쁘/, /칭찬/, /따뜻/, /좋/]);
    const negative = hasAny(text, [/부담/, /불편/, /조롱/, /외모\s*평가/, /못생/, /놀림/]);
    flags.faceRevealReaction = positive ? "긍정" : negative ? "부정" : "정보 부족";
  }

  let normalScore = 0;
  let bigScore = 0;
  if (flags.petting) normalScore += 3;
  if (flags.greeting) normalScore += 1;
  if (flags.cute) normalScore += 6;
  if (flags.sweetTone) normalScore += 3;
  if (flags.praise) normalScore += 5;
  if (flags.ignored) normalScore -= 6;
  if (flags.serverBlocked) bigScore -= 15;
  if (flags.selfBlockedByPersonality) bigScore -= 12;
  if (flags.faceRevealReaction === "긍정") bigScore += 7;
  if (flags.faceRevealReaction === "부정") bigScore -= 7;

  const delta = normalScore + bigScore;
  const direction = directionFromDelta(delta);
  const variableCount = Object.entries(flags).filter(([key, value]) => {
    if (key === "faceRevealReaction") {
      return value !== "해당 없음";
    }
    return value === true;
  }).length;
  const confidence = computeConfidence(variableCount, normalScore, bigScore);
  const finalIndex = Math.max(0, currentIndex + delta);
  const analysis = buildAnalysis(flags, delta);

  return {
    safetyStop: false,
    direction,
    currentIndex,
    delta,
    finalIndex,
    confidence,
    flags,
    analysis,
    oneLine: buildOneLine(direction, flags, delta)
  };
}

function buildAnalysis(flags: DetectionFlags, delta: number): string[] {
  const positive: string[] = [];
  const negative: string[] = [];

  if (flags.petting) positive.push("쓰담쓰담은 다정한 상승 요소로 +3입니다.");
  if (flags.greeting) positive.push("인사는 낮은 상승 요소로 +1입니다.");
  if (flags.cute) positive.push("귀여워해주기는 강한 상승 요소로 +6입니다.");
  if (flags.sweetTone) positive.push("애교 말투는 부드러운 상승 요소로 +3입니다.");
  if (flags.praise) positive.push("칭찬은 높은 상승 요소로 +5입니다.");
  if (flags.faceRevealReaction === "긍정") positive.push("동의 있는 얼공과 따뜻한 반응은 +7입니다.");

  if (flags.ignored) negative.push("무시는 큰 하락 요소로 -6입니다.");
  if (flags.serverBlocked) negative.push("서버 차단은 매우 큰 하락 이벤트로 -15입니다.");
  if (flags.selfBlockedByPersonality) negative.push("성격차이로 직접 차단한 상황은 감정 소모 이벤트로 -12입니다.");
  if (flags.faceRevealReaction === "부정") negative.push("얼공 후 부담스럽거나 부정적인 반응은 -7입니다.");

  return [
    positive.length ? positive.join(" ") : "감지된 긍정 요소가 뚜렷하지 않습니다.",
    negative.length ? negative.join(" ") : "감지된 부정 요소가 뚜렷하지 않습니다.",
    `총점은 ${delta >= 0 ? "+" : ""}${delta}이므로 최종 판단은 ${directionFromDelta(delta)}입니다.`
  ];
}

function buildOneLine(direction: Direction, flags: DetectionFlags, delta: number): string {
  if (direction === "상승") {
    if (flags.cute && flags.faceRevealReaction === "긍정") {
      return "오늘 세냥장, 얼공 호재와 귀여움 호재가 동시에 터졌습니다 🐾";
    }
    return `오늘 세냥장, 귀여운 호재로 ${delta >= 6 ? "강세" : "소폭 강세"}입니다 🐾`;
  }

  if (direction === "하락") {
    if (flags.serverBlocked || flags.selfBlockedByPersonality) {
      return "오늘 세냥장, 큰 이벤트 악재로 변동성이 커졌습니다냥";
    }
    return "오늘 세냥장, 무시 악재가 감지되어 약세입니다냥";
  }

  return "정보가 부족해서 보합으로 보는 게 안전해 보여요 🐾";
}

export function formatPrediction(result: PredictionResult): string {
  if (result.safetyStop) {
    return [
      "⚠️ 세냥장 일시 정지",
      "",
      "이 요청은 오락용 예측 게임의 범위를 벗어날 수 있어요.",
      "세냥이나 참가자의 안전과 존중이 더 중요하기 때문에 이 내용으로는 예측을 진행하지 않을게요.",
      result.safetyReason ? `- 사유: ${result.safetyReason}` : undefined,
      "",
      "※ 세냥 지수는 순수 오락용이며, 실제 감정 판단이나 사람 평가가 아닙니다."
    ]
      .filter(Boolean)
      .join("\n");
  }

  const deltaText = result.delta >= 0 ? `+${result.delta}` : String(result.delta);

  return [
    "📈 세냥 기분 예측 결과",
    "",
    `- 예측: ${result.direction}`,
    `- 현재 세냥 지수: ${result.currentIndex}`,
    `- 예상 지수 변화: ${deltaText}`,
    `- 예상 최종 지수: ${result.finalIndex}`,
    `- 확신도: ${result.confidence}`,
    "",
    "### 감지된 일반 변수",
    "",
    `- 쓰담쓰담: ${mark(result.flags.petting)}`,
    `- 인사해주기: ${mark(result.flags.greeting)}`,
    `- 귀여워해주기: ${mark(result.flags.cute)}`,
    `- 애교 말투: ${mark(result.flags.sweetTone)}`,
    `- 칭찬: ${mark(result.flags.praise)}`,
    `- 무시: ${mark(result.flags.ignored)}`,
    "",
    "### 감지된 빅 이벤트",
    "",
    `- 서버에서 차단: ${mark(result.flags.serverBlocked)}`,
    `- 자기가 성격차이로 차단: ${mark(result.flags.selfBlockedByPersonality)}`,
    `- 얼공: ${mark(result.flags.faceReveal)}`,
    `- 얼공 반응: ${result.flags.faceRevealReaction}`,
    "",
    "### 분석",
    "",
    ...result.analysis.map((line, index) => `${index + 1}. ${line}`),
    "",
    "### 한줄평",
    "",
    result.oneLine,
    "",
    "※ 이 예측은 순수 오락용이며 실제 투자, 도박, 금전 거래와 관련이 없습니다."
  ].join("\n");
}

function mark(value: boolean): "O" | "X" {
  return value ? "O" : "X";
}
