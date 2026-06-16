import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} from "discord.js";
import { startAdminServer } from "./admin-ui.js";
import { generateHelpReply } from "./ai.js";
import { config, requireDiscordBotConfig } from "./config.js";
import { ServerTagAutomation, type ServerTagBulkScanSummary } from "./server-tag.js";
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

function formatBulkScanSummary(result: ServerTagBulkScanSummary, scope: "all" | "current"): string {
  if (result.guildCount === 0) {
    return "DOUM이 참여 중인 Discord 서버가 없습니다.";
  }

  const totals = result.summaries.reduce(
    (acc, summary) => ({
      checked: acc.checked + summary.checked,
      matched: acc.matched + summary.matched,
      granted: acc.granted + summary.granted,
      removed: acc.removed + summary.removed,
      unchanged: acc.unchanged + summary.unchanged,
      skipped: acc.skipped + summary.skipped,
      errors: acc.errors + summary.errors.length
    }),
    {
      checked: 0,
      matched: 0,
      granted: 0,
      removed: 0,
      unchanged: 0,
      skipped: 0,
      errors: result.failures.length
    }
  );

  const scopeLabel = scope === "all" ? "전체 서버" : "현재 서버";
  const detailLines = result.summaries.slice(0, 8).map((summary) => {
    const errorText = summary.errors.length > 0 ? `, 오류 ${summary.errors.length}` : "";
    return `- ${summary.guildName}: 확인 ${summary.checked}, 일치 ${summary.matched}, 지급 ${summary.granted}, 회수 ${summary.removed}${errorText}`;
  });
  const hiddenGuildCount = Math.max(0, result.summaries.length - detailLines.length);
  if (hiddenGuildCount > 0) {
    detailLines.push(`- 외 ${hiddenGuildCount}개 서버`);
  }

  const issueLines = [
    ...result.failures.map((failure) => `- ${failure.guildName}: ${failure.message}`),
    ...result.summaries.flatMap((summary) =>
      summary.errors.slice(0, 2).map((error) => `- ${summary.guildName}: ${error}`)
    )
  ].slice(0, 8);

  const lines = [
    `서버 태그 업데이트 완료 (${scopeLabel})`,
    `대상 서버 ${result.guildCount}개 / 완료 ${result.summaries.length}개 / 실패 ${result.failures.length}개`,
    `확인 ${totals.checked}명, 태그 일치 ${totals.matched}명, 지급 ${totals.granted}명, 회수 ${totals.removed}명, 유지 ${totals.unchanged}명, 건너뜀 ${totals.skipped}명, 오류 ${totals.errors}개`
  ];

  if (detailLines.length > 0) {
    lines.push("", "서버별 요약:", ...detailLines);
  }

  if (issueLines.length > 0) {
    lines.push("", "확인할 내용:", ...issueLines);
  }

  return limitDiscordMessage(lines.join("\n"));
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

async function handleUpdateCommand(
  interaction: ChatInputCommandInteraction,
  automation: ServerTagAutomation
): Promise<void> {
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({ content: "`/업데이트`는 Discord 서버 안에서만 사용할 수 있습니다.", ephemeral: true });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: "`/업데이트`는 역할 관리 권한이 있는 사용자만 사용할 수 있습니다.", ephemeral: true });
    return;
  }

  const requestedScope = interaction.options.getString("범위");
  const scope: "all" | "current" = requestedScope === "current" ? "current" : "all";

  await interaction.deferReply({ ephemeral: true });

  const result: ServerTagBulkScanSummary =
    scope === "current"
      ? {
          guildCount: 1,
          summaries: [await automation.scanNow(guildId)],
          failures: []
        }
      : await automation.scanAllNow();

  await interaction.editReply(formatBulkScanSummary(result, scope));
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  automation: ServerTagAutomation
): Promise<void> {
  try {
    switch (interaction.commandName) {
      case "도움":
        await handleHelpCommand(interaction);
        return;
      case "업데이트":
        await handleUpdateCommand(interaction, automation);
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
  requireDiscordBotConfig();

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

    await handleCommand(interaction, serverTagAutomation);

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
