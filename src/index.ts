import {
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Message
} from "discord.js";
import { analyzeScenario, generateConversationReply, generateProactiveReply, type ChatMemoryItem } from "./ai.js";
import { createIndexChartEmbed } from "./chart.js";
import { config, requireDiscordRuntimeConfig } from "./config.js";
import {
  formatPredictionReceipt,
  formatRanking,
  formatSettlement,
  formatStatus,
  placePrediction,
  recordIndexEvent,
  settlePredictions
} from "./game.js";
import { formatPrediction, localAnalyzeScenario } from "./senyang.js";
import { loadState, saveState } from "./storage.js";
import type { Direction } from "./types.js";

const channelMemory = new Map<string, ChatMemoryItem[]>();
const lastProactiveAtByChannel = new Map<string, number>();
const lastPersonalityBlockAtByChannel = new Map<string, number>();

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

function displayNameFromMessage(message: Message): string {
  return message.member?.displayName ?? message.author.globalName ?? message.author.username;
}

function asDirection(value: string): Direction {
  if (value === "상승" || value === "하락" || value === "보합") {
    return value;
  }

  throw new Error(`알 수 없는 방향입니다: ${value}`);
}

function rememberMessage(message: Message): ChatMemoryItem[] {
  const channelId = message.channelId;
  const memory = channelMemory.get(channelId) ?? [];
  const cleanContent = message.cleanContent.trim();

  if (cleanContent) {
    memory.push({
      author: displayNameFromMessage(message),
      content: cleanContent
    });
  }

  const trimmed = memory.slice(-12);
  channelMemory.set(channelId, trimmed);
  return trimmed;
}

function shouldReplyToMessage(message: Message, botUserId: string): boolean {
  if (message.author.bot) {
    return false;
  }

  if (config.replyChannelIds.length > 0 && !config.replyChannelIds.includes(message.channelId)) {
    return false;
  }

  const cleanContent = message.cleanContent.trim();
  if (!cleanContent) {
    return false;
  }

  const mentionedBot = message.mentions.users.has(botUserId);
  const hasTriggerKeyword = config.triggerKeywords.some((keyword) => cleanContent.includes(keyword));

  return mentionedBot || hasTriggerKeyword;
}

function isPassiveMessageEligible(message: Message): boolean {
  if (message.author.bot) {
    return false;
  }

  if (config.replyChannelIds.length > 0 && !config.replyChannelIds.includes(message.channelId)) {
    return false;
  }

  return Boolean(message.cleanContent.trim());
}

async function showTyping(message: Message): Promise<void> {
  const channelWithTyping = message.channel as { sendTyping?: () => Promise<unknown> };
  await channelWithTyping.sendTyping?.().catch(() => undefined);
}

function messagePayload(content: string, options: Omit<BaseMessageOptions, "content"> = {}): BaseMessageOptions {
  return {
    ...options,
    content: limitDiscordMessage(content)
  };
}

async function sendToMessageChannel(message: Message, payload: string | BaseMessageOptions): Promise<void> {
  const finalPayload = typeof payload === "string" ? messagePayload(payload) : payload;
  const sendableChannel = message.channel as { send?: (options: BaseMessageOptions) => Promise<unknown> };

  if (sendableChannel.send) {
    await sendableChannel.send(finalPayload);
    return;
  }

  await message.reply(finalPayload);
}

function deltaText(delta: number): string {
  return delta >= 0 ? `+${delta}` : String(delta);
}

async function triggerPersonalityBlockEvent(message: Message): Promise<void> {
  const displayName = displayNameFromMessage(message);
  const state = await loadState();
  const result = localAnalyzeScenario(
    `세냥이 성격차이로 ${displayName} 님을 가상 차단했다. 실제 디스코드 차단은 아니다.`,
    state.index
  );

  state.index = result.finalIndex;
  state.mood = result.direction;
  state.lastPrediction = result;
  state.recentFlow = `${displayName} 님과 성격차이 가상 차단 이벤트 발동. 세냥 지수 ${deltaText(result.delta)}.`;
  const indexEvent = recordIndexEvent(state, {
    type: "personality_block",
    label: "성격차이 가상 차단",
    direction: result.direction,
    delta: result.delta,
    previousIndex: result.currentIndex,
    finalIndex: result.finalIndex
  });

  await saveState(state);

  await sendToMessageChannel(
    message,
    messagePayload(
      [
        "📉 세냥장 긴급 공시",
        "",
        `${displayName} 님과 세냥의 성격차이 가상 차단이 발동했습니다냥.`,
        "- 실제 디스코드 차단: 아님",
        "- 게임 이벤트: 자기가 성격차이로 차단 O",
        `- 세냥 지수: ${result.currentIndex} → ${result.finalIndex} (${deltaText(result.delta)})`,
        "",
        "※ 장난용 세냥장 이벤트이며, 실제 차단이나 제재와 전혀 관련이 없습니다."
      ].join("\n"),
      { embeds: [createIndexChartEmbed(state, indexEvent)] }
    )
  );
}

async function maybeSendProactiveMessage(message: Message, memory: ChatMemoryItem[]): Promise<void> {
  if (!isPassiveMessageEligible(message)) {
    return;
  }

  const now = Date.now();
  const lastProactiveAt = lastProactiveAtByChannel.get(message.channelId) ?? 0;
  const lastPersonalityBlockAt = lastPersonalityBlockAtByChannel.get(message.channelId) ?? 0;
  const canProactivelyTalk = now - lastProactiveAt >= config.proactiveCooldownMs;
  const canPersonalityBlock = now - lastPersonalityBlockAt >= config.personalityBlockCooldownMs;

  if (canPersonalityBlock && Math.random() < config.personalityBlockChance) {
    await showTyping(message);
    await triggerPersonalityBlockEvent(message);
    lastPersonalityBlockAtByChannel.set(message.channelId, now);
    lastProactiveAtByChannel.set(message.channelId, now);
    return;
  }

  if (!canProactivelyTalk || Math.random() >= config.proactiveReplyChance) {
    return;
  }

  await showTyping(message);
  const reply = await generateProactiveReply(memory);

  if (reply) {
    await sendToMessageChannel(message, reply);
    lastProactiveAtByChannel.set(message.channelId, now);
  }
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

  await saveState(state);
  await interaction.reply(
    messagePayload(formatSettlement(settlement), {
      embeds: latestIndexEvent ? [createIndexChartEmbed(state, latestIndexEvent)] : []
    })
  );
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    switch (interaction.commandName) {
      case "상태": {
        const state = await loadState();
        const latestIndexEvent = state.indexHistory[0];
        await interaction.reply(
          messagePayload(formatStatus(state), {
            embeds: latestIndexEvent ? [createIndexChartEmbed(state, latestIndexEvent)] : []
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

async function handleNaturalMessage(message: Message, botUserId: string): Promise<void> {
  if (message.author.bot) {
    return;
  }

  const memory = rememberMessage(message);
  if (!shouldReplyToMessage(message, botUserId)) {
    await maybeSendProactiveMessage(message, memory);
    return;
  }

  await showTyping(message);
  const reply = await generateConversationReply(message.cleanContent, displayNameFromMessage(message), memory);

  if (reply) {
    await message.reply({ content: limitDiscordMessage(reply) });
  }
}

async function main(): Promise<void> {
  requireDiscordRuntimeConfig();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    await handleCommand(interaction);
  });

  client.on(Events.MessageCreate, async (message) => {
    const botUserId = client.user?.id;
    if (!botUserId) {
      return;
    }

    await handleNaturalMessage(message, botUserId);
  });

  await client.login(config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
