import { Client, Events, Guild, GuildMember, PermissionFlagsBits, User, type Role } from "discord.js";
import { config } from "./config.js";
import { ensureGuildSettings, getGuildSettings, loadState, saveState } from "./storage.js";
import type { GuildSettings, ServerTagScanSummary } from "./types.js";

interface MemberSyncResult {
  matched: boolean;
  granted: boolean;
  removed: boolean;
  unchanged: boolean;
  skipped: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function normalizeTag(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function configuredTargetGuildId(settings: GuildSettings, fallbackGuildId: string): string {
  return settings.serverTag.targetGuildId || fallbackGuildId;
}

async function resolveGuild(client: Client, guildId: string): Promise<Guild> {
  const id = guildId || config.discordGuildId || client.guilds.cache.first()?.id || "";
  if (!id) {
    throw new Error("스캔할 Discord 서버 ID가 없습니다.");
  }

  return client.guilds.cache.get(id) ?? client.guilds.fetch(id);
}

async function fetchBotMember(guild: Guild): Promise<GuildMember | null> {
  if (guild.members.me) {
    return guild.members.me;
  }

  const botUserId = guild.client.user?.id;
  if (!botUserId) {
    return null;
  }

  return guild.members.fetch(botUserId).catch(() => null);
}

async function assertCanManageRole(guild: Guild, role: Role): Promise<void> {
  const botMember = await fetchBotMember(guild);

  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("봇에게 역할 관리 권한이 없습니다.");
  }

  if (role.position >= botMember.roles.highest.position) {
    throw new Error(`봇 최고 역할보다 '${role.name}' 역할이 높거나 같아서 지급할 수 없습니다.`);
  }
}

async function ensureTagRole(guild: Guild, settings: GuildSettings): Promise<Role> {
  if (settings.serverTag.roleId) {
    const configuredRole = await guild.roles.fetch(settings.serverTag.roleId).catch(() => null);
    if (configuredRole) {
      return configuredRole;
    }
  }

  const roleName = settings.serverTag.roleName || "DOUM 태그 인증";
  const existingRole = guild.roles.cache.find((role) => !role.managed && role.name === roleName);
  if (existingRole) {
    settings.serverTag.roleId = existingRole.id;
    return existingRole;
  }

  const botMember = await fetchBotMember(guild);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("태그 지급 역할을 만들려면 봇에게 역할 관리 권한이 필요합니다.");
  }

  const role = await guild.roles.create({
    name: roleName,
    reason: "DOUM 서버 태그 자동지급 역할 생성"
  });
  settings.serverTag.roleId = role.id;
  return role;
}

async function fetchFreshUser(user: User): Promise<User> {
  return user.fetch(true).catch(() => user);
}

function userMatchesServerTag(user: User, settings: GuildSettings, fallbackGuildId: string): boolean {
  const primaryGuild = user.primaryGuild;
  const targetGuildId = configuredTargetGuildId(settings, fallbackGuildId);
  const targetTag = normalizeTag(settings.serverTag.targetTag);
  const userTag = normalizeTag(primaryGuild?.tag);

  if (!primaryGuild || primaryGuild.identityEnabled !== true || !primaryGuild.identityGuildId || !userTag) {
    return false;
  }

  if (primaryGuild.identityGuildId !== targetGuildId) {
    return false;
  }

  return targetTag ? userTag === targetTag : true;
}

export async function syncMemberServerTagRole(
  member: GuildMember,
  settings: GuildSettings,
  reason = "DOUM 서버 태그 자동 동기화"
): Promise<MemberSyncResult> {
  if (!settings.serverTag.enabled || member.user.bot) {
    return {
      matched: false,
      granted: false,
      removed: false,
      unchanged: false,
      skipped: true
    };
  }

  const role = await ensureTagRole(member.guild, settings);
  const freshUser = await fetchFreshUser(member.user);
  const matched = userMatchesServerTag(freshUser, settings, member.guild.id);
  const hasRole = member.roles.cache.has(role.id);

  if (matched && !hasRole) {
    await assertCanManageRole(member.guild, role);
    await member.roles.add(role, reason);
    return { matched, granted: true, removed: false, unchanged: false, skipped: false };
  }

  if (!matched && hasRole && settings.serverTag.removeWhenMissing) {
    await assertCanManageRole(member.guild, role);
    await member.roles.remove(role, reason);
    return { matched, granted: false, removed: true, unchanged: false, skipped: false };
  }

  return { matched, granted: false, removed: false, unchanged: true, skipped: false };
}

function createSummary(guild: Guild, scannedAt = now()): ServerTagScanSummary {
  return {
    guildId: guild.id,
    guildName: guild.name,
    checked: 0,
    matched: 0,
    granted: 0,
    removed: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    scannedAt
  };
}

export async function scanGuildServerTags(client: Client, guildId: string): Promise<ServerTagScanSummary> {
  const state = await loadState();
  const guild = await resolveGuild(client, guildId);
  const settings = ensureGuildSettings(state, guild.id, guild.name);
  const summary = createSummary(guild);

  if (!settings.serverTag.enabled) {
    summary.skipped = 1;
    summary.errors.push("이 서버의 태그 자동지급이 꺼져 있습니다.");
    settings.serverTag.lastScanAt = summary.scannedAt;
    settings.serverTag.lastScanSummary = summary;
    settings.updatedAt = summary.scannedAt;
    await saveState(state);
    return summary;
  }

  try {
    await ensureTagRole(guild, settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : "지급 역할을 준비하지 못했습니다.";
    summary.errors.push(message);
    settings.serverTag.lastScanAt = summary.scannedAt;
    settings.serverTag.lastScanSummary = summary;
    settings.updatedAt = summary.scannedAt;
    await saveState(state);
    return summary;
  }

  try {
    await guild.members.fetch();
  } catch (error) {
    const message = error instanceof Error ? error.message : "멤버 목록을 가져오지 못했습니다.";
    summary.errors.push(message);
    settings.serverTag.lastScanAt = summary.scannedAt;
    settings.serverTag.lastScanSummary = summary;
    settings.updatedAt = summary.scannedAt;
    await saveState(state);
    return summary;
  }

  for (const member of guild.members.cache.values()) {
    summary.checked += 1;

    try {
      const result = await syncMemberServerTagRole(member, settings);

      if (result.matched) summary.matched += 1;
      if (result.granted) summary.granted += 1;
      if (result.removed) summary.removed += 1;
      if (result.unchanged) summary.unchanged += 1;
      if (result.skipped) summary.skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      summary.errors.push(`${member.user.tag ?? member.user.id}: ${message}`);
    }
  }

  summary.errors = summary.errors.slice(0, 20);
  settings.serverTag.lastScanAt = summary.scannedAt;
  settings.serverTag.lastScanSummary = summary;
  settings.updatedAt = summary.scannedAt;
  await saveState(state);
  return summary;
}

export class ServerTagAutomation {
  private readonly scanTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly client: Client) {}

  register(): void {
    this.client.once(Events.ClientReady, () => {
      void this.handleReady();
    });

    this.client.on(Events.GuildMemberAdd, (member) => {
      void this.syncMember(member, "DOUM 서버 태그 신규 멤버 자동 확인");
    });

    this.client.on(Events.UserUpdate, (_oldUser, newUser) => {
      void this.syncUserAcrossGuilds(newUser.id, "DOUM 서버 태그 변경 자동 확인");
    });
  }

  async scanNow(guildId: string): Promise<ServerTagScanSummary> {
    if (!this.client.isReady()) {
      throw new Error("Discord 클라이언트가 아직 준비되지 않았습니다.");
    }

    return scanGuildServerTags(this.client, guildId);
  }

  async syncMember(member: GuildMember, reason?: string): Promise<void> {
    const state = await loadState();
    const settings = ensureGuildSettings(state, member.guild.id, member.guild.name);
    await syncMemberServerTagRole(member, settings, reason);
    await saveState(state);
  }

  async syncUserAcrossGuilds(userId: string, reason?: string): Promise<void> {
    const state = await loadState();

    for (const guild of this.client.guilds.cache.values()) {
      const settings = getGuildSettings(state, guild.id);
      if (!settings.serverTag.enabled) {
        continue;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        continue;
      }

      await syncMemberServerTagRole(member, settings, reason);
      state.guildSettings[guild.id] = settings;
    }

    await saveState(state);
  }

  async rescheduleFromState(): Promise<void> {
    for (const timer of this.scanTimers.values()) {
      clearInterval(timer);
    }
    this.scanTimers.clear();

    const state = await loadState();

    for (const [guildId, settings] of Object.entries(state.guildSettings)) {
      if (!settings.serverTag.enabled || settings.serverTag.scanIntervalMinutes <= 0) {
        continue;
      }

      const timer = setInterval(() => {
        void this.scanNow(guildId).catch((error) => {
          console.error(`DOUM server tag scheduled scan failed for ${guildId}.`, error);
        });
      }, settings.serverTag.scanIntervalMinutes * 60_000);

      this.scanTimers.set(guildId, timer);
    }
  }

  private async handleReady(): Promise<void> {
    const state = await loadState();

    for (const [guildId, settings] of Object.entries(state.guildSettings)) {
      if (settings.serverTag.enabled && settings.serverTag.scanOnReady) {
        await this.scanNow(guildId).catch((error) => {
          console.error(`DOUM server tag startup scan failed for ${guildId}.`, error);
        });
      }
    }

    await this.rescheduleFromState();
  }
}
