import { REST, Routes } from "discord.js";
import { config, requireDiscordCommandConfig } from "./config.js";
import { commandsJson } from "./commands.js";

async function main(): Promise<void> {
  requireDiscordCommandConfig();

  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);

  console.log(`Registering ${commandsJson.length} slash commands...`);
  await rest.put(route, { body: commandsJson });
  console.log(config.discordGuildId ? "Guild slash commands registered." : "Global slash commands registered.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
