import "dotenv/config";
import path from "node:path";

function integerFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function adminUiHostFromEnv(): string {
  const requestedHost = process.env.ADMIN_UI_HOST?.trim();
  const renderPort = process.env.PORT?.trim();

  if (renderPort && (!requestedHost || requestedHost === "127.0.0.1" || requestedHost === "localhost")) {
    return "0.0.0.0";
  }

  return requestedHost || "127.0.0.1";
}
export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
  dataFile: path.join(process.cwd(), "data", "doum-state.json"),
  adminUiEnabled: booleanFromEnv(process.env.ADMIN_UI_ENABLED, true),
  adminUiHost: adminUiHostFromEnv(),
  adminUiPort: integerFromEnv(process.env.PORT ?? process.env.ADMIN_UI_PORT, 8787),
  adminUiToken: process.env.ADMIN_UI_TOKEN ?? ""
};

function requireEnvValues(entries: Array<[string, string]>): void {
  const missing = entries.filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.map(([name]) => name).join(", ")}`);
  }
}

export function requireDiscordBotConfig(): void {
  requireEnvValues([["DISCORD_TOKEN", config.discordToken]]);
}

export function requireDiscordCommandConfig(): void {
  requireEnvValues([
    ["DISCORD_TOKEN", config.discordToken],
    ["DISCORD_CLIENT_ID", config.discordClientId]
  ]);
}


