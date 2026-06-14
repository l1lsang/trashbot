import "dotenv/config";
import path from "node:path";

function listFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function integerFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chanceFromEnv(value: string | undefined, fallback: number): number {
  return Math.min(1, Math.max(0, numberFromEnv(value, fallback)));
}

function minutesFromEnv(value: string | undefined, fallback: number): number {
  return Math.max(0, integerFromEnv(value, fallback));
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  messageContentIntentEnabled: booleanFromEnv(process.env.DISCORD_MESSAGE_CONTENT_INTENT, false),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
  replyChannelIds: listFromEnv(process.env.BOT_REPLY_CHANNEL_IDS),
  triggerKeywords: listFromEnv(process.env.BOT_TRIGGER_KEYWORDS).length
    ? listFromEnv(process.env.BOT_TRIGGER_KEYWORDS)
    : ["세냥", "세냥장", "냥포인트"],
  startingPoints: integerFromEnv(process.env.STARTING_POINTS, 100),
  betStake: integerFromEnv(process.env.BET_STAKE, 10),
  proactiveReplyChance: chanceFromEnv(process.env.BOT_PROACTIVE_REPLY_CHANCE, 0.01),
  personalityBlockChance: chanceFromEnv(process.env.BOT_PERSONALITY_BLOCK_CHANCE, 0.001),
  proactiveCooldownMs: minutesFromEnv(process.env.BOT_PROACTIVE_COOLDOWN_MINUTES, 10) * 60 * 1000,
  personalityBlockCooldownMs: minutesFromEnv(process.env.BOT_PERSONALITY_BLOCK_COOLDOWN_MINUTES, 360) * 60 * 1000,
  dataFile: path.join(process.cwd(), "data", "state.json")
};

export function requireDiscordRuntimeConfig(): void {
  const missing = [
    ["DISCORD_TOKEN", config.discordToken],
    ["DISCORD_CLIENT_ID", config.discordClientId]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.map(([name]) => name).join(", ")}`);
  }
}
