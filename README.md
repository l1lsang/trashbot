# DOUM 봇

GPT 기반 Discord 도움 봇입니다. `/도움` 명령으로 GPT 답변을 호출하고, 서버 태그를 표시한 멤버에게 지정 역할을 자동 지급합니다. 관리자 UI에서 GPT 프롬프트와 서버 태그 역할 설정을 바꿀 수 있습니다.

## 준비

1. Discord Developer Portal에서 애플리케이션과 Bot을 만듭니다.
2. Bot 설정에서 `SERVER MEMBERS INTENT`를 켭니다.
3. OAuth2 URL Generator에서 `bot`, `applications.commands` scope를 선택합니다.
4. 봇 권한은 최소 `Manage Roles`, `Use Slash Commands`, `View Channels`가 필요합니다.
5. `.env.example`을 참고해 `.env`를 만듭니다.
6. 의존성을 설치합니다.

```bash
npm install
```

PowerShell에서 실행 정책 오류가 나면 Windows 명령 실행 파일을 직접 쓰면 됩니다.

```powershell
npm.cmd install
```

## 환경 변수

- `DISCORD_TOKEN`: Discord 봇 토큰
- `DISCORD_CLIENT_ID`: Discord 애플리케이션 ID
- `DISCORD_GUILD_ID`: 테스트/운영 서버 ID. 비우면 전역 슬래시 명령으로 등록합니다.
- `OPENAI_API_KEY`: GPT 호출용 OpenAI API 키
- `OPENAI_MODEL`: 사용할 OpenAI 모델
- `ADMIN_UI_ENABLED`: 관리 UI 사용 여부
- `ADMIN_UI_HOST`: 관리 UI 바인딩 주소
- `ADMIN_UI_PORT`: 관리 UI 포트
- `ADMIN_UI_TOKEN`: 관리 UI API 토큰

## 실행

슬래시 명령을 먼저 등록합니다.

```bash
npm run deploy:commands
```

개발 모드로 실행합니다.

```bash
npm run dev
```

빌드 후 실행하려면:

```bash
npm run build
npm start
```

관리 UI 기본 주소는 `http://127.0.0.1:8787`입니다. 페이지에서 `ADMIN_UI_TOKEN` 값을 입력하면 설정을 저장하고 서버 태그 스캔을 실행할 수 있습니다.

관리 UI의 `서버 선택`에서 봇이 들어가 있는 Discord 서버를 고른 뒤 저장하면, GPT 프롬프트와 서버 태그 역할 설정이 서버마다 따로 저장됩니다.

## 명령어

- `/도움 질문:<내용>`: DOUM 봇이 GPT로 답변합니다.

## 서버 태그 역할

관리 UI에서 서버를 선택한 뒤 다음 값을 설정합니다.

- `태그 기준 서버 ID`: 사용자가 표시해야 하는 서버 태그의 원본 서버 ID. 보통 관리 서버 ID와 같습니다.
- `태그 문자열`: 특정 태그 텍스트까지 확인할 때만 입력합니다.
- `지급 역할 ID`: 이미 만든 역할을 쓰려면 입력합니다.
- `지급 역할 이름`: 역할 ID가 없을 때 찾거나 새로 만들 역할 이름입니다.

봇의 최고 역할이 지급할 역할보다 위에 있어야 역할을 추가/회수할 수 있습니다.

## 설정 저장

서버별 설정은 `data/doum-state.json`의 `guildSettings`에 저장됩니다. `.env`는 Discord 토큰, OpenAI 키, 관리자 UI 포트와 토큰처럼 서버별로 나누지 않는 실행 환경 값만 둡니다.
