export const directions = ["상승", "하락", "보합"] as const;

export type Direction = (typeof directions)[number];
export type Confidence = "낮음" | "보통" | "높음";
export type FaceRevealReaction = "긍정" | "부정" | "정보 부족" | "해당 없음";

export interface UserPoints {
  displayName: string;
  points: number;
}

export interface PredictionEntry {
  userId: string;
  displayName: string;
  direction: Direction;
  stake: number;
  createdAt: string;
}

export interface DetectionFlags {
  petting: boolean;
  greeting: boolean;
  cute: boolean;
  sweetTone: boolean;
  praise: boolean;
  ignored: boolean;
  serverBlocked: boolean;
  selfBlockedByPersonality: boolean;
  faceReveal: boolean;
  faceRevealReaction: FaceRevealReaction;
}

export interface PredictionResult {
  safetyStop: boolean;
  safetyReason?: string;
  direction: Direction;
  currentIndex: number;
  delta: number;
  finalIndex: number;
  confidence: Confidence;
  flags: DetectionFlags;
  analysis: string[];
  oneLine: string;
}

export interface Settlement {
  result: Direction;
  delta: number;
  previousIndex: number;
  finalIndex: number;
  winners: string[];
  losers: string[];
  settledAt: string;
}

export interface IndexEvent {
  type: "settlement" | "personality_block";
  label: string;
  direction: Direction;
  delta: number;
  previousIndex: number;
  finalIndex: number;
  createdAt: string;
}

export interface BotState {
  version: 1;
  index: number;
  mood: Direction;
  recentFlow: string;
  users: Record<string, UserPoints>;
  predictions: Record<string, PredictionEntry>;
  lastPrediction?: PredictionResult;
  history: Settlement[];
  indexHistory: IndexEvent[];
  updatedAt: string;
}
