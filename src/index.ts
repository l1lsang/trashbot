import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Message
} from "discord.js";
import { startAdminServer } from "./admin-ui.js";
import { generateHelpReply } from "./ai.js";
import { recordBump, resetBumpStats, trackedBumpFromMessage } from "./bump.js";
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

function discordTimestamp(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? `<t:${Math.floor(milliseconds / 1000)}:R>` : "-";
}

async function handleBumpStatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "`/범프통계`는 Discord 서버 안에서만 사용할 수 있습니다.", ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const state = await loadState();
  const stats = getGuildSettings(state, guildId).bumpStats;
  const target = interaction.options.getUser("사용자");

  if (target) {
    const userStats = stats.users[target.id];
    const content = userStats
      ? [`<@${target.id}>님의 범프 통계`, `사용 횟수: **${userStats.count.toLocaleString("ko-KR")}회**`, `최근 사용: ${discordTimestamp(userStats.lastBumpAt)}`].join("\n")
      : `<@${target.id}>님의 기록된 범프 사용 내역이 없습니다.`;
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
    return;
  }

  const ranking = Object.values(stats.users).sort(
    (left, right) => right.count - left.count || Date.parse(right.lastBumpAt) - Date.parse(left.lastBumpAt)
  );
  if (ranking.length === 0) {
    await interaction.editReply("아직 기록된 범프 사용 내역이 없습니다.");
    return;
  }

  const visibleRanking = ranking.slice(0, 20).map(
    (userStats, index) =>
      `${index + 1}. <@${userStats.userId}> — **${userStats.count.toLocaleString("ko-KR")}회** · 최근 ${discordTimestamp(userStats.lastBumpAt)}`
  );
  const hiddenCount = ranking.length - visibleRanking.length;
  const lines = [
    "**DISBOARD 범프 통계**",
    `총 **${stats.total.toLocaleString("ko-KR")}회** · 참여 **${ranking.length.toLocaleString("ko-KR")}명**`,
    "",
    ...visibleRanking
  ];
  if (hiddenCount > 0) {
    lines.push(``, `외 ${hiddenCount.toLocaleString("ko-KR")}명`);
  }

  await interaction.editReply({ content: limitDiscordMessage(lines.join("\n")), allowedMentions: { parse: [] } });
}

async function handleBumpResetCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "`/범프초기화`는 Discord 서버 안에서만 사용할 수 있습니다.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.editReply("`/범프초기화`는 서버 관리 권한이 있는 사용자만 사용할 수 있습니다.");
    return;
  }

  const target = interaction.options.getUser("사용자");
  const removed = await resetBumpStats(guildId, target?.id);
  const content = target
    ? `<@${target.id}>님의 범프 기록 ${removed.toLocaleString("ko-KR")}회를 초기화했습니다.`
    : `이 서버의 범프 기록 ${removed.toLocaleString("ko-KR")}회를 모두 초기화했습니다.`;
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

function discordErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function isExpiredOrAcknowledgedInteraction(error: unknown): boolean {
  const code = discordErrorCode(error);
  return code === 10062 || code === 40060 || code === "InteractionAlreadyReplied";
}

async function reportCommandError(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
  if (isExpiredOrAcknowledgedInteraction(error)) {
    console.warn(
      `Discord interaction expired or was already acknowledged: command=${interaction.commandName} interaction=${interaction.id} code=${discordErrorCode(error)}`
    );
    return;
  }

  const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
  const content = `DOUM 처리 중 문제가 생겼습니다: ${message}`;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(limitDiscordMessage(content));
    } else {
      await interaction.reply({ content: limitDiscordMessage(content), ephemeral: true });
    }
  } catch (responseError) {
    if (isExpiredOrAcknowledgedInteraction(responseError)) {
      console.warn(
        `Could not report command error because the interaction expired: command=${interaction.commandName} interaction=${interaction.id} code=${discordErrorCode(responseError)}`
      );
      return;
    }

    console.error("Failed to report Discord command error.", responseError);
  }
}

async function handleDisboardMessage(message: Message): Promise<void> {
  const bump = trackedBumpFromMessage(message);
  if (!bump) {
    return;
  }

  const result = await recordBump(bump);
  if (result.recorded) {
    console.log(
      `DISBOARD bump tracked: guild=${bump.guildId} user=${bump.userId} userCount=${result.userCount} total=${result.total}`
    );
  }
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
      case "범프통계":
        await handleBumpStatsCommand(interaction);
        return;
      case "범프초기화":
        await handleBumpResetCommand(interaction);
        return;
      default:
        await interaction.reply({ content: "알 수 없는 DOUM 명령입니다.", ephemeral: true });
    }
  } catch (error) {
    console.error(`DOUM command failed: command=${interaction.commandName} interaction=${interaction.id}`, error);
    await reportCommandError(interaction, error);
  }
}

async function main(): Promise<void> {
  requireDiscordBotConfig();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
  });
  const serverTagAutomation = new ServerTagAutomation(client);
  serverTagAutomation.register();
  startAdminServer({ client, automation: serverTagAutomation });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    console.log("DOUM slash command mode and DISBOARD bump tracking enabled. MessageContent intent is not requested.");
  });

  client.on(Events.MessageCreate, (message) => {
    void handleDisboardMessage(message).catch((error) => {
      console.error("DISBOARD bump tracking failed.", error);
    });
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
