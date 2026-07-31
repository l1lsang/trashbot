import { InteractionType, type Message, type User } from "discord.js";
import { config } from "./config.js";
import { ensureGuildSettings, mutateState } from "./storage.js";
import type { BumpStats, BumpUserStats } from "./types.js";

export interface TrackedBump {
  guildId: string;
  messageId: string;
  userId: string;
  username: string;
  bumpedAt: string;
}

export interface RecordBumpResult {
  recorded: boolean;
  total: number;
  userCount: number;
}

function commandInvoker(message: Message): User | undefined {
  const legacyInteraction = message.interaction;
  if (
    legacyInteraction?.type !== InteractionType.ApplicationCommand ||
    legacyInteraction.commandName.toLowerCase() !== "bump"
  ) {
    return undefined;
  }

  return legacyInteraction.user ?? message.interactionMetadata?.user;
}

export function trackedBumpFromMessage(message: Message): TrackedBump | undefined {
  if (!message.guildId || message.author.id !== config.disboardBotId) {
    return undefined;
  }

  const user = commandInvoker(message);
  if (!user) {
    return undefined;
  }

  return {
    guildId: message.guildId,
    messageId: message.id,
    userId: user.id,
    username: user.globalName ?? user.username,
    bumpedAt: message.createdAt.toISOString()
  };
}

export async function recordBump(bump: TrackedBump): Promise<RecordBumpResult> {
  return mutateState((state) => {
    const settings = ensureGuildSettings(state, bump.guildId);
    const stats = settings.bumpStats;
    if (stats.processedMessageIds.includes(bump.messageId)) {
      return {
        recorded: false,
        total: stats.total,
        userCount: stats.users[bump.userId]?.count ?? 0
      };
    }

    const previous: BumpUserStats | undefined = stats.users[bump.userId];
    const userStats: BumpUserStats = {
      userId: bump.userId,
      username: bump.username,
      count: (previous?.count ?? 0) + 1,
      lastBumpAt: bump.bumpedAt
    };

    stats.users[bump.userId] = userStats;
    stats.total += 1;
    stats.lastBumpAt = bump.bumpedAt;
    stats.processedMessageIds.push(bump.messageId);
    stats.processedMessageIds = stats.processedMessageIds.slice(-500);
    settings.updatedAt = new Date().toISOString();

    return {
      recorded: true,
      total: stats.total,
      userCount: userStats.count
    };
  });
}

export async function resetBumpStats(guildId: string, userId?: string): Promise<number> {
  return mutateState((state) => {
    const settings = state.guildSettings[guildId];
    if (!settings) {
      return 0;
    }

    const stats = settings.bumpStats;
    const resetAt = new Date().toISOString();
    if (userId) {
      const removed = stats.users[userId]?.count ?? 0;
      delete stats.users[userId];
      stats.total = Math.max(0, stats.total - removed);
      stats.lastResetAt = resetAt;
      settings.updatedAt = resetAt;
      return removed;
    }

    const removed = stats.total;
    settings.bumpStats = {
      total: 0,
      users: {},
      processedMessageIds: stats.processedMessageIds,
      lastResetAt: resetAt
    } satisfies BumpStats;
    settings.updatedAt = resetAt;
    return removed;
  });
}
