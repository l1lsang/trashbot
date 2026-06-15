import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Client } from "discord.js";
import { config } from "./config.js";
import { ensureGuildSettings, getGuildSettings, loadState, saveState } from "./storage.js";
import type { DoumState, GuildSettings } from "./types.js";
import type { ServerTagAutomation } from "./server-tag.js";

interface AdminServerOptions {
  client: Client;
  automation: ServerTagAutomation;
}

function jsonHeaders(): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };
}

function commonHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    ...commonHeaders(),
    ...jsonHeaders()
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    ...commonHeaders(),
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function isAuthorized(request: IncomingMessage): boolean {
  if (!config.adminUiToken) {
    return false;
  }

  return request.headers.authorization === `Bearer ${config.adminUiToken}`;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("요청 본문이 너무 큽니다.");
    }
  }

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body) as unknown;
}

function stringSetting(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function selectedGuildId(client: Client, requestedGuildId?: string | null): string {
  const requested = typeof requestedGuildId === "string" ? requestedGuildId.trim() : "";
  if (requested) {
    return requested;
  }

  return config.discordGuildId || client.guilds.cache.first()?.id || "";
}

function applySettingsPatch(state: DoumState, guildId: string, patch: unknown): GuildSettings {
  const raw = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
  const help = raw.help && typeof raw.help === "object" ? (raw.help as Record<string, unknown>) : {};
  const serverTag = raw.serverTag && typeof raw.serverTag === "object" ? (raw.serverTag as Record<string, unknown>) : {};
  const settings = ensureGuildSettings(state, guildId);

  settings.help = {
    systemPrompt: stringSetting(help.systemPrompt, settings.help.systemPrompt, 4000),
    maxAnswerLength: numberSetting(help.maxAnswerLength, settings.help.maxAnswerLength, 300, 1900)
  };
  settings.serverTag = {
    ...settings.serverTag,
    enabled: booleanSetting(serverTag.enabled, settings.serverTag.enabled),
    guildId,
    targetGuildId: stringSetting(serverTag.targetGuildId, settings.serverTag.targetGuildId || guildId, 32) || guildId,
    targetTag: stringSetting(serverTag.targetTag, settings.serverTag.targetTag, 4),
    roleId: stringSetting(serverTag.roleId, settings.serverTag.roleId, 32),
    roleName:
      stringSetting(serverTag.roleName, settings.serverTag.roleName, 80) ||
      settings.serverTag.roleName ||
      "DOUM 태그 인증",
    removeWhenMissing: booleanSetting(serverTag.removeWhenMissing, settings.serverTag.removeWhenMissing),
    scanOnReady: booleanSetting(serverTag.scanOnReady, settings.serverTag.scanOnReady),
    scanIntervalMinutes: numberSetting(serverTag.scanIntervalMinutes, settings.serverTag.scanIntervalMinutes, 1, 1440)
  };
  settings.updatedAt = new Date().toISOString();
  state.guildSettings[guildId] = settings;
  return settings;
}

function runtimePayload(client: Client): unknown {
  return {
    botReady: client.isReady(),
    botUser: client.user?.tag ?? null,
    guilds: client.guilds.cache.map((guild) => ({
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount
    }))
  };
}

function statePayload(client: Client, state: DoumState, guildId: string): unknown {
  const settings = getGuildSettings(state, guildId);

  return {
    state,
    selectedGuildId: guildId,
    settings,
    runtime: runtimePayload(client)
  };
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  client: Client,
  automation: ServerTagAutomation,
  searchParams: URLSearchParams
): Promise<void> {
  if (pathname === "/api/meta" && request.method === "GET") {
    sendJson(response, 200, {
      authConfigured: Boolean(config.adminUiToken),
      runtime: runtimePayload(client),
      defaultGuildId: selectedGuildId(client)
    });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, {
      error: config.adminUiToken
        ? "관리자 토큰이 올바르지 않습니다."
        : "ADMIN_UI_TOKEN이 설정되지 않아 관리 API가 잠겨 있습니다."
    });
    return;
  }

  if (pathname === "/api/state" && request.method === "GET") {
    const state = await loadState();
    const guildId = selectedGuildId(client, searchParams.get("guildId"));
    sendJson(response, 200, statePayload(client, state, guildId));
    return;
  }

  if (pathname === "/api/settings" && request.method === "POST") {
    const body = await readJsonBody(request);
    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const guildId = selectedGuildId(client, stringSetting(raw.guildId, "", 32));
    const state = await loadState();
    applySettingsPatch(state, guildId, raw);
    await saveState(state);
    await automation.rescheduleFromState();
    sendJson(response, 200, statePayload(client, await loadState(), guildId));
    return;
  }

  if (pathname === "/api/server-tag/scan" && request.method === "POST") {
    const body = await readJsonBody(request);
    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const guildId = selectedGuildId(client, stringSetting(raw.guildId, "", 32));
    const summary = await automation.scanNow(guildId);
    sendJson(response, 200, {
      summary,
      ...statePayload(client, await loadState(), guildId)
    });
    return;
  }

  sendJson(response, 404, { error: "찾을 수 없는 API 경로입니다." });
}

function adminHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DOUM Admin</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f9;
      color: #172033;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: #f6f7f9;
    }

    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }

    h2 {
      margin: 0 0 16px;
      font-size: 16px;
      letter-spacing: 0;
    }

    section {
      border: 1px solid #d7dce5;
      border-radius: 8px;
      background: #ffffff;
      padding: 18px;
      margin-top: 14px;
    }

    label {
      display: grid;
      gap: 7px;
      color: #4b5565;
      font-size: 13px;
      font-weight: 650;
    }

    input,
    select,
    textarea {
      width: 100%;
      border: 1px solid #c8d0dc;
      border-radius: 6px;
      padding: 10px 11px;
      font: inherit;
      color: #111827;
      background: #ffffff;
      outline: none;
    }

    textarea {
      min-height: 220px;
      resize: vertical;
      line-height: 1.5;
    }

    input:focus,
    select:focus,
    textarea:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    }

    input[type="checkbox"] {
      width: 18px;
      height: 18px;
      padding: 0;
      accent-color: #2563eb;
    }

    button {
      min-height: 40px;
      border: 1px solid #1d4ed8;
      border-radius: 6px;
      padding: 0 14px;
      font: inherit;
      font-weight: 700;
      color: #ffffff;
      background: #2563eb;
      cursor: pointer;
    }

    button.secondary {
      border-color: #0f766e;
      background: #0f766e;
    }

    button.ghost {
      border-color: #c8d0dc;
      color: #172033;
      background: #ffffff;
    }

    button:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 40px;
      color: #334155;
      font-size: 14px;
      font-weight: 650;
    }

    .status {
      min-height: 32px;
      display: flex;
      align-items: center;
      color: #334155;
      font-size: 14px;
    }

    .runtime,
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .metric {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      min-height: 74px;
      background: #f8fafc;
    }

    .metric span {
      display: block;
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }

    .metric strong {
      display: block;
      margin-top: 8px;
      overflow-wrap: anywhere;
      font-size: 18px;
      line-height: 1.25;
    }

    pre {
      max-height: 160px;
      overflow: auto;
      margin: 12px 0 0;
      border: 1px solid #fee2e2;
      border-radius: 8px;
      padding: 10px;
      color: #991b1b;
      background: #fff7f7;
      white-space: pre-wrap;
    }

    .hidden {
      display: none;
    }

    @media (max-width: 760px) {
      main {
        width: min(100vw - 20px, 1120px);
        padding-top: 18px;
      }

      header,
      .toolbar {
        align-items: stretch;
        flex-direction: column;
      }

      .grid,
      .runtime,
      .summary {
        grid-template-columns: 1fr;
      }

      button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>DOUM Admin</h1>
        <div class="status" id="status">연결 대기</div>
      </div>
      <div class="toolbar">
        <input id="token" type="password" autocomplete="current-password" placeholder="ADMIN_UI_TOKEN">
        <button class="ghost" id="unlock">연결</button>
      </div>
    </header>

    <section>
      <h2>서버 선택</h2>
      <div class="grid">
        <label>
          설정할 서버
          <select id="guildSelect"></select>
        </label>
        <label>
          선택된 서버 ID
          <input id="selectedGuildId" readonly>
        </label>
      </div>
    </section>

    <section>
      <h2>런타임</h2>
      <div class="runtime" id="runtime"></div>
    </section>

    <section>
      <h2>GPT</h2>
      <div class="grid">
        <label>
          최대 답변 길이
          <input id="maxAnswerLength" type="number" min="300" max="1900" step="50">
        </label>
      </div>
      <label style="margin-top:14px">
        시스템 프롬프트
        <textarea id="systemPrompt" spellcheck="false"></textarea>
      </label>
    </section>

    <section>
      <h2>서버 태그 역할</h2>
      <div class="grid">
        <label class="row"><input id="tagEnabled" type="checkbox"> 자동지급 사용</label>
        <label class="row"><input id="removeWhenMissing" type="checkbox"> 태그 해제 시 역할 회수</label>
        <label class="row"><input id="scanOnReady" type="checkbox"> 봇 시작 시 스캔</label>
        <label>
          스캔 주기(분)
          <input id="scanIntervalMinutes" type="number" min="1" max="1440" step="1">
        </label>
        <label>
          태그 기준 서버 ID
          <input id="targetGuildId" inputmode="numeric" placeholder="비우면 선택 서버 기준">
        </label>
        <label>
          태그 문자열
          <input id="targetTag" maxlength="4" placeholder="선택">
        </label>
        <label>
          지급 역할 ID
          <input id="roleId" inputmode="numeric" placeholder="없으면 자동 생성">
        </label>
        <label>
          지급 역할 이름
          <input id="roleName" maxlength="80">
        </label>
      </div>
    </section>

    <section>
      <div class="toolbar">
        <button id="save">이 서버 설정 저장</button>
        <button class="secondary" id="scan">이 서버 지금 스캔</button>
      </div>
      <div class="summary" id="summary" style="margin-top:14px"></div>
      <pre class="hidden" id="errors"></pre>
    </section>
  </main>

  <script>
    const tokenKey = "doum_admin_token";
    const guildKey = "doum_admin_guild_id";
    let runtimeGuilds = [];

    function el(id) {
      return document.getElementById(id);
    }

    function setBusy(isBusy) {
      el("save").disabled = isBusy;
      el("scan").disabled = isBusy;
      el("unlock").disabled = isBusy;
      el("guildSelect").disabled = isBusy;
    }

    function setStatus(text) {
      el("status").textContent = text;
    }

    function token() {
      return el("token").value.trim();
    }

    function selectedGuildId() {
      return el("guildSelect").value || el("selectedGuildId").value.trim();
    }

    async function api(path, options) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token(),
          ...(options && options.headers ? options.headers : {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "요청 실패");
      }
      return payload;
    }

    function metric(label, value) {
      const item = document.createElement("div");
      item.className = "metric";
      const small = document.createElement("span");
      const strong = document.createElement("strong");
      small.textContent = label;
      strong.textContent = value;
      item.append(small, strong);
      return item;
    }

    function renderGuildSelect(runtime, selectedId) {
      runtimeGuilds = runtime && runtime.guilds ? runtime.guilds : [];
      const select = el("guildSelect");
      const existing = selectedId || localStorage.getItem(guildKey) || (runtimeGuilds[0] && runtimeGuilds[0].id) || "";
      select.replaceChildren();

      if (!runtimeGuilds.length && existing) {
        const option = document.createElement("option");
        option.value = existing;
        option.textContent = existing;
        select.append(option);
      }

      runtimeGuilds.forEach((guild) => {
        const option = document.createElement("option");
        option.value = guild.id;
        option.textContent = guild.name + " (" + guild.id + ")";
        select.append(option);
      });

      if (existing) {
        select.value = existing;
      }
      el("selectedGuildId").value = select.value || existing;
    }

    function renderRuntime(runtime, selectedId) {
      const guild = runtime && runtime.guilds ? runtime.guilds.find((item) => item.id === selectedId) : null;
      const target = el("runtime");
      target.replaceChildren(
        metric("봇 상태", runtime && runtime.botReady ? "Ready" : "Not ready"),
        metric("봇 계정", runtime && runtime.botUser ? runtime.botUser : "-"),
        metric("서버 수", runtime && runtime.guilds ? String(runtime.guilds.length) : "0"),
        metric("선택 서버", guild ? guild.name : selectedId || "-")
      );
    }

    function renderSummary(summary) {
      const target = el("summary");
      if (!summary) {
        target.replaceChildren(metric("최근 스캔", "-"), metric("확인", "0"), metric("지급", "0"), metric("회수", "0"));
        el("errors").classList.add("hidden");
        return;
      }

      target.replaceChildren(
        metric("최근 스캔", summary.scannedAt || "-"),
        metric("확인", String(summary.checked || 0)),
        metric("태그 일치", String(summary.matched || 0)),
        metric("지급", String(summary.granted || 0)),
        metric("회수", String(summary.removed || 0)),
        metric("유지", String(summary.unchanged || 0)),
        metric("건너뜀", String(summary.skipped || 0)),
        metric("오류", String(summary.errors ? summary.errors.length : 0))
      );

      const errors = el("errors");
      if (summary.errors && summary.errors.length) {
        errors.textContent = summary.errors.join("\\n");
        errors.classList.remove("hidden");
      } else {
        errors.classList.add("hidden");
      }
    }

    function fillForm(settings, selectedId) {
      el("selectedGuildId").value = selectedId || "";
      el("maxAnswerLength").value = settings.help.maxAnswerLength;
      el("systemPrompt").value = settings.help.systemPrompt;
      el("tagEnabled").checked = settings.serverTag.enabled;
      el("removeWhenMissing").checked = settings.serverTag.removeWhenMissing;
      el("scanOnReady").checked = settings.serverTag.scanOnReady;
      el("scanIntervalMinutes").value = settings.serverTag.scanIntervalMinutes;
      el("targetGuildId").value = settings.serverTag.targetGuildId || selectedId || "";
      el("targetTag").value = settings.serverTag.targetTag || "";
      el("roleId").value = settings.serverTag.roleId || "";
      el("roleName").value = settings.serverTag.roleName || "";
      renderSummary(settings.serverTag.lastScanSummary);
    }

    function collectSettings() {
      return {
        guildId: selectedGuildId(),
        help: {
          maxAnswerLength: Number(el("maxAnswerLength").value),
          systemPrompt: el("systemPrompt").value
        },
        serverTag: {
          enabled: el("tagEnabled").checked,
          removeWhenMissing: el("removeWhenMissing").checked,
          scanOnReady: el("scanOnReady").checked,
          scanIntervalMinutes: Number(el("scanIntervalMinutes").value),
          targetGuildId: el("targetGuildId").value,
          targetTag: el("targetTag").value,
          roleId: el("roleId").value,
          roleName: el("roleName").value
        }
      };
    }

    async function loadMeta() {
      const response = await fetch("/api/meta");
      const payload = await response.json();
      const selectedId = localStorage.getItem(guildKey) || payload.defaultGuildId || "";
      renderGuildSelect(payload.runtime, selectedId);
      renderRuntime(payload.runtime, selectedId);
      if (!payload.authConfigured) {
        setStatus("ADMIN_UI_TOKEN 설정 필요");
      }
    }

    async function loadState() {
      setBusy(true);
      try {
        const guildId = selectedGuildId();
        const payload = await api("/api/state?guildId=" + encodeURIComponent(guildId), { method: "GET" });
        renderGuildSelect(payload.runtime, payload.selectedGuildId);
        renderRuntime(payload.runtime, payload.selectedGuildId);
        fillForm(payload.settings, payload.selectedGuildId);
        localStorage.setItem(guildKey, payload.selectedGuildId);
        setStatus("연결됨");
      } catch (error) {
        setStatus(error.message);
      } finally {
        setBusy(false);
      }
    }

    async function saveSettings() {
      setBusy(true);
      try {
        const payload = await api("/api/settings", {
          method: "POST",
          body: JSON.stringify(collectSettings())
        });
        renderGuildSelect(payload.runtime, payload.selectedGuildId);
        renderRuntime(payload.runtime, payload.selectedGuildId);
        fillForm(payload.settings, payload.selectedGuildId);
        localStorage.setItem(guildKey, payload.selectedGuildId);
        setStatus("저장됨");
      } catch (error) {
        setStatus(error.message);
      } finally {
        setBusy(false);
      }
    }

    async function scanNow() {
      setBusy(true);
      try {
        const payload = await api("/api/server-tag/scan", {
          method: "POST",
          body: JSON.stringify({ guildId: selectedGuildId() })
        });
        renderGuildSelect(payload.runtime, payload.selectedGuildId);
        renderRuntime(payload.runtime, payload.selectedGuildId);
        fillForm(payload.settings, payload.selectedGuildId);
        renderSummary(payload.summary);
        localStorage.setItem(guildKey, payload.selectedGuildId);
        setStatus("스캔 완료");
      } catch (error) {
        setStatus(error.message);
      } finally {
        setBusy(false);
      }
    }

    el("token").value = localStorage.getItem(tokenKey) || "";
    el("unlock").addEventListener("click", () => {
      localStorage.setItem(tokenKey, token());
      loadState();
    });
    el("guildSelect").addEventListener("change", () => {
      el("selectedGuildId").value = selectedGuildId();
      localStorage.setItem(guildKey, selectedGuildId());
      if (token()) loadState();
    });
    el("save").addEventListener("click", saveSettings);
    el("scan").addEventListener("click", scanNow);

    loadMeta().then(() => {
      if (token()) loadState();
    });
  </script>
</body>
</html>`;
}

export function startAdminServer(options: AdminServerOptions): Server | undefined {
  if (!config.adminUiEnabled) {
    return undefined;
  }

  const server = createServer((request, response) => {
    const host = request.headers.host ?? `${config.adminUiHost}:${config.adminUiPort}`;
    const url = new URL(request.url ?? "/", `http://${host}`);

    void (async () => {
      if (url.pathname === "/" && request.method === "GET") {
        sendHtml(response, adminHtml());
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url.pathname, options.client, options.automation, url.searchParams);
        return;
      }

      sendJson(response, 404, { error: "찾을 수 없는 경로입니다." });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      sendJson(response, 500, { error: message });
    });
  });

  server.on("error", (error) => {
    console.error("DOUM admin UI server failed.", error);
  });

  server.listen(config.adminUiPort, config.adminUiHost, () => {
    console.log(`DOUM admin UI: http://${config.adminUiHost}:${config.adminUiPort}`);
    if (!config.adminUiToken) {
      console.warn("ADMIN_UI_TOKEN is not set. Admin API requests will be rejected.");
    }
  });

  return server;
}
