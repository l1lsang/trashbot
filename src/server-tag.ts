import {
  Client,
  Events,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  User,
  type Role
} from "discord.js";
import { config } from "./config.js";
import { loadState, saveState } from "./storage.js";
import type { DoumState, ServerTagScanSummary } from "./types.js";

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

function configuredGuildId(state: DoumState, client: Client): string {
  return state.serverTag.guildId || config.discordGuildId || client.guilds.cache.first()?.id || "";
}

function configuredTargetGuildId(state: DoumState, fallbackGuildId: string): string {
  return state.serverTag.targetGuildId || fallbackGuildId;
}

async function resolveManagedGuild(client: Client, state: DoumState): Promise<Guild> {
  const guildId = configuredGuildId(state, client);
  if (!guildId) {
    throw new Error("관리할 Discord 서버 ID가 없습니다. DISCORD_GUILD_ID 또는 관리 UI의 서버 ID를 설정해주세요.");
  }

  return client.guilds.cache.get(guildId) ?? client.guilds.fetch(guildId);
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

async function ensureTagRole(guild: Guild, state: DoumState): Promise<Role> {
  if (state.serverTag.roleId) {
    const configuredRole = await guild.roles.fetch(state.serverTag.roleId).catch(() => null);
    if (configuredRole) {
      return configuredRole;
    }
  }

  const roleName = state.serverTag.roleName || "DOUM 태그 인증";
  const existingRole = guild.roles.cache.find((role) => !role.managed && role.name === roleName);
  if (existingRole) {
    state.serverTag.roleId = existingRole.id;
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
  state.serverTag.roleId = role.id;
  return role;
}

async function fetchFreshUser(user: User): Promise<User> {
  return user.fetch(true).catch(() => user);
}

function userMatchesServerTag(user: User, state: DoumState, fallbackGuildId: string): boolean {
  const primaryGuild = user.primaryGuild;
  const targetGuildId = configuredTargetGuildId(state, fallbackGuildId);
  const targetTag = normalizeTag(state.serverTag.targetTag);
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
  state: DoumState,
  reason = "DOUM 서버 태그 자동 동기화"
): Promise<MemberSyncResult> {
  if (!state.serverTag.enabled || member.user.bot) {
    return {
      matched: false,
      granted: false,
      removed: false,
      unchanged: false,
      skipped: true
    };
  }

  const role = await ensureTagRole(member.guild, state);
  const freshUser = await fetchFreshUser(member.user);
  const matched = userMatchesServerTag(freshUser, state, member.guild.id);
  const hasRole = member.roles.cache.has(role.id);

  if (matched && !hasRole) {
    await assertCanManageRole(member.guild, role);
    await member.roles.add(role, reason);
    return { matched, granted: true, removed: false, unchanged: false, skipped: false };
  }

  if (!matched && hasRole && state.serverTag.removeWhenMissing) {
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

export async function scanConfiguredGuildServerTags(client: Client): Promise<ServerTagScanSummary> {
  const state = await loadState();
  const guild = await resolveManagedGuild(client, state);
  const summary = createSummary(guild);

  if (!state.serverTag.enabled) {
    summary.skipped = 1;
    summary.errors.push("서버 태그 자동지급이 꺼져 있습니다.");
    state.serverTag.lastScanAt = summary.scannedAt;
    state.serverTag.lastScanSummary = summary;
    await saveState(state);
    return summary;
  }

  try {
    await guild.members.fetch();
  } catch (error) {
    const message = error instanceof Error ? error.message : "멤버 목록을 가져오지 못했습니다.";
    summary.errors.push(message);
    state.serverTag.lastScanAt = summary.scannedAt;
    state.serverTag.lastScanSummary = summary;
    await saveState(state);
    return summary;
  }

  for (const member of guild.members.cache.values()) {
    summary.checked += 1;

    try {
      const result = await syncMemberServerTagRole(member, state);

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
  state.serverTag.lastScanAt = summary.scannedAt;
  state.serverTag.lastScanSummary = summary;
  await saveState(state);
  return summary;
}

export class ServerTagAutomation {
  private scanTimer: NodeJS.Timeout | undefined;

  constructor(private readonly client: Client) {}

  register(): void {
    this.client.once(Events.ClientReady, () => {
      void this.handleReady();
    });

    this.client.on(Events.GuildMemberAdd, (member) => {
      void this.syncMember(member, "DOUM 서버 태그 신규 멤버 자동 확인");
    });

    this.client.on(Events.UserUpdate, (_oldUser, newUser) => {
      void this.syncUserInConfiguredGuild(newUser.id, "DOUM 서버 태그 변경 자동 확인");
    });
  }

  async scanNow(): Promise<ServerTagScanSummary> {
    if (!this.client.isReady()) {
      throw new Error("Discord 클라이언트가 아직 준비되지 않았습니다.");
    }

    return scanConfiguredGuildServerTags(this.client);
  }

  async syncMember(member: GuildMember, reason?: string): Promise<void> {
    const state = await loadState();
    await syncMemberServerTagRole(member, state, reason);
    await saveState(state);
  }

  async syncUserInConfiguredGuild(userId: string, reason?: string): Promise<void> {
    const state = await loadState();
    if (!state.serverTag.enabled) {
      return;
    }

    const guild = await resolveManagedGuild(this.client, state);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return;
    }

    await syncMemberServerTagRole(member, state, reason);
    await saveState(state);
  }

  async rescheduleFromState(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = undefined;
    }

    const state = await loadState();
    if (!state.serverTag.enabled || state.serverTag.scanIntervalMinutes <= 0) {
      return;
    }

    this.scanTimer = setInterval(() => {
      void this.scanNow().catch((error) => {
        console.error("DOUM server tag scheduled scan failed.", error);
      });
    }, state.serverTag.scanIntervalMinutes * 60_000);
  }

  private async handleReady(): Promise<void> {
    const state = await loadState();
    if (state.serverTag.enabled && state.serverTag.scanOnReady) {
      await this.scanNow().catch((error) => {
        console.error("DOUM server tag startup scan failed.", error);
      });
    }

    await this.rescheduleFromState();
  }
}
