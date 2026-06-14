import "dotenv/config";
import path from "node:path";

function integerFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
  startingPoints: integerFromEnv(process.env.STARTING_POINTS, 100),
  betStake: integerFromEnv(process.env.BET_STAKE, 10),
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
