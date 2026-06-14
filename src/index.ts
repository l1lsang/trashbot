import {
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits
} from "discord.js";
import { analyzeScenario, generateConversationReply, type ChatMemoryItem } from "./ai.js";
import { createIndexChartPayload } from "./chart.js";
import { config, requireDiscordRuntimeConfig } from "./config.js";
import {
  formatPredictionReceipt,
  formatRanking,
  formatSettlement,
  formatStatus,
  placePrediction,
  settlePredictions
} from "./game.js";
import { formatPrediction } from "./senyang.js";
import { loadState, saveState } from "./storage.js";
import type { Direction } from "./types.js";

const slashConversationMemory = new Map<string, ChatMemoryItem[]>();

function limitDiscordMessage(text: string): string {
  if (text.length <= 1900) {
    return text;
  }

  return `${text.slice(0, 1880)}\n...`;
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

function asDirection(value: string): Direction {
  if (value === "상승" || value === "하락" || value === "보합") {
    return value;
  }

  throw new Error(`알 수 없는 방향입니다: ${value}`);
}

function messagePayload(content: string, options: Omit<BaseMessageOptions, "content"> = {}): BaseMessageOptions {
  return {
    ...options,
    content: limitDiscordMessage(content)
  };
}

async function handlePredictionCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const state = await loadState();
  const scenario = interaction.options.getString("상황", true);
  const currentIndex = interaction.options.getInteger("현재지수") ?? state.index;

  await interaction.deferReply();
  const result = await analyzeScenario(scenario, currentIndex);
  state.lastPrediction = result;
  state.recentFlow = result.safetyStop
    ? "최근 예측은 안전 중단으로 처리되었습니다."
    : `최근 예측은 ${result.direction}, 예상 변화 ${result.delta >= 0 ? "+" : ""}${result.delta}입니다.`;

  await saveState(state);
  await interaction.editReply(limitDiscordMessage(formatPrediction(result)));
}

function slashChatKey(interaction: ChatInputCommandInteraction): string {
  return `${interaction.guildId ?? "dm"}:${interaction.channelId}:${interaction.user.id}`;
}

function getSlashChatMemory(interaction: ChatInputCommandInteraction): ChatMemoryItem[] {
  return slashConversationMemory.get(slashChatKey(interaction)) ?? [];
}

function rememberSlashChat(interaction: ChatInputCommandInteraction, author: string, message: string): void {
  const key = slashChatKey(interaction);
  const memory = slashConversationMemory.get(key) ?? [];
  memory.push({ author, content: message });
  slashConversationMemory.set(key, memory.slice(-12));
}

function rememberSenyangReply(interaction: ChatInputCommandInteraction, reply: string): void {
  const key = slashChatKey(interaction);
  const memory = slashConversationMemory.get(key) ?? [];
  memory.push({ author: "세냥", content: reply });
  slashConversationMemory.set(key, memory.slice(-12));
}

async function handleSenyangCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const message = interaction.options.getString("메시지", true);
  const author = displayNameFromInteraction(interaction);
  const memory = getSlashChatMemory(interaction);

  await interaction.deferReply();
  const reply = await generateConversationReply(message, author, memory);
  const content = reply ?? "세냥장 중계석이 잠깐 조용해졌어요. 다시 한 번 말 걸어주세요냥.";
  rememberSlashChat(interaction, author, message);
  rememberSenyangReply(interaction, content);

  await interaction.editReply(limitDiscordMessage(content));
}

async function handleBetCommand(interaction: ChatInputCommandInteraction, direction: Direction): Promise<void> {
  const state = await loadState();
  const prediction = placePrediction(state, interaction.user.id, displayNameFromInteraction(interaction), direction);
  await saveState(state);
  await interaction.reply(limitDiscordMessage(formatPredictionReceipt(prediction)));
}

async function handleSettlementCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const state = await loadState();
  const result = asDirection(interaction.options.getString("결과", true));
  const requestedDelta = interaction.options.getInteger("지수변화") ?? undefined;
  const settlement = settlePredictions(state, result, requestedDelta);
  const latestIndexEvent = state.indexHistory[0];
  const chart = latestIndexEvent ? createIndexChartPayload(state, latestIndexEvent) : undefined;

  await saveState(state);
  await interaction.reply(
    messagePayload(formatSettlement(settlement), {
      embeds: chart ? [chart.embed] : [],
      files: chart?.files ?? []
    })
  );
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    switch (interaction.commandName) {
      case "세냥":
        await handleSenyangCommand(interaction);
        return;
      case "상태": {
        const state = await loadState();
        const latestIndexEvent = state.indexHistory[0];
        const chart = latestIndexEvent ? createIndexChartPayload(state, latestIndexEvent) : undefined;
        await interaction.reply(
          messagePayload(formatStatus(state), {
            embeds: chart ? [chart.embed] : [],
            files: chart?.files ?? []
          })
        );
        return;
      }
      case "예측":
        await handlePredictionCommand(interaction);
        return;
      case "매수":
        await handleBetCommand(interaction, "상승");
        return;
      case "매도":
        await handleBetCommand(interaction, "하락");
        return;
      case "보합":
        await handleBetCommand(interaction, "보합");
        return;
      case "결산":
        await handleSettlementCommand(interaction);
        return;
      case "랭킹": {
        const state = await loadState();
        await interaction.reply(limitDiscordMessage(formatRanking(state)));
        return;
      }
      default:
        await interaction.reply({ content: "알 수 없는 세냥장 명령입니다냥.", ephemeral: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    const content = `세냥장 처리 중 문제가 생겼어요: ${message}`;

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
    intents: [GatewayIntentBits.Guilds]
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    console.log("Slash command mode enabled. No MessageContent intent is requested.");
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    await handleCommand(interaction);
  });

  await client.login(config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
