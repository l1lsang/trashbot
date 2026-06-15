import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits
} from "discord.js";
import { startAdminServer } from "./admin-ui.js";
import { generateHelpReply } from "./ai.js";
import { config, requireDiscordRuntimeConfig } from "./config.js";
import { ServerTagAutomation } from "./server-tag.js";
import { getGuildSettings, loadState } from "./storage.js";
import type { ChatMemoryItem } from "./types.js";

const helpConversationMemory = new Map<string, ChatMemoryItem[]>();

function limitDiscordMessage(text: string, maxLength = 1900): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 20))}\n...`;
}

function displayNameFromInteraction(interaction: ChatInputCommandInteraction): string {
  const member = interaction.member;
  if (member && "displayName" in member && typeof member.displayName === "string") {
    return member.displayName;
  }

  if (member && "nick" in member && typeof member.nick === "string" && member.nick) {
    return member.nick;
  }

  return interaction.user.globalName ?? interaction.user.username;
}

function slashChatKey(interaction: ChatInputCommandInteraction): string {
  return `${interaction.guildId ?? "dm"}:${interaction.channelId}:${interaction.user.id}`;
}

function getSlashChatMemory(interaction: ChatInputCommandInteraction): ChatMemoryItem[] {
  return helpConversationMemory.get(slashChatKey(interaction)) ?? [];
}

function rememberSlashChat(interaction: ChatInputCommandInteraction, author: string, message: string): void {
  const key = slashChatKey(interaction);
  const memory = helpConversationMemory.get(key) ?? [];
  memory.push({ author, content: message });
  helpConversationMemory.set(key, memory.slice(-12));
}

function rememberDoumReply(interaction: ChatInputCommandInteraction, reply: string): void {
  const key = slashChatKey(interaction);
  const memory = helpConversationMemory.get(key) ?? [];
  memory.push({ author: "DOUM", content: reply });
  helpConversationMemory.set(key, memory.slice(-12));
}

async function handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const message = interaction.options.getString("질문", true);
  const author = displayNameFromInteraction(interaction);
  const memory = getSlashChatMemory(interaction);
  const state = await loadState();
  const settings = getGuildSettings(state, interaction.guildId);

  await interaction.deferReply();
  const reply = await generateHelpReply(message, author, memory, settings.help);
  const content = reply ?? "DOUM이 답변을 만들지 못했습니다. 조금 뒤에 다시 시도해주세요.";
  rememberSlashChat(interaction, author, message);
  rememberDoumReply(interaction, content);

  await interaction.editReply(limitDiscordMessage(content, settings.help.maxAnswerLength + 80));
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    switch (interaction.commandName) {
      case "도움":
        await handleHelpCommand(interaction);
        return;
      default:
        await interaction.reply({ content: "알 수 없는 DOUM 명령입니다.", ephemeral: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    const content = `DOUM 처리 중 문제가 생겼습니다: ${message}`;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(limitDiscordMessage(content));
    } else {
      await interaction.reply({ content: limitDiscordMessage(content), ephemeral: true });
    }
  }
}

async function main(): Promise<void> {
  requireDiscordRuntimeConfig();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });
  const serverTagAutomation = new ServerTagAutomation(client);
  serverTagAutomation.register();
  startAdminServer({ client, automation: serverTagAutomation });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    console.log("DOUM slash command mode enabled. MessageContent intent is not requested.");
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    await handleCommand(interaction);

    if (interaction.inCachedGuild()) {
      void serverTagAutomation.syncMember(interaction.member, "DOUM 명령 사용 시 서버 태그 자동 확인").catch((error) => {
        console.error("DOUM server tag interaction sync failed.", error);
      });
    }
  });

  await client.login(config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
