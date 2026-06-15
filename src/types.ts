export interface ChatMemoryItem {
  author: string;
  content: string;
}

export interface HelpSettings {
  systemPrompt: string;
  maxAnswerLength: number;
}

export interface ServerTagScanSummary {
  guildId: string;
  guildName: string;
  checked: number;
  matched: number;
  granted: number;
  removed: number;
  unchanged: number;
  skipped: number;
  errors: string[];
  scannedAt: string;
}

export interface ServerTagSettings {
  enabled: boolean;
  guildId: string;
  targetGuildId: string;
  targetTag: string;
  roleId: string;
  roleName: string;
  removeWhenMissing: boolean;
  scanOnReady: boolean;
  scanIntervalMinutes: number;
  lastScanAt?: string;
  lastScanSummary?: ServerTagScanSummary;
}

export interface DoumState {
  version: 1;
  help: HelpSettings;
  serverTag: ServerTagSettings;
  updatedAt: string;
}
