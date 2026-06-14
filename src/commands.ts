import { SlashCommandBuilder } from "discord.js";

const resultChoices = [
  { name: "상승", value: "상승" },
  { name: "하락", value: "하락" },
  { name: "보합", value: "보합" }
] as const;

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("세냥")
    .setDescription("세냥 봇과 슬래시 명령으로 대화합니다.")
    .addStringOption((option) =>
      option
        .setName("메시지")
        .setDescription("세냥에게 보낼 말입니다.")
        .setRequired(true)
        .setMaxLength(1500)
    ),
  new SlashCommandBuilder().setName("상태").setDescription("현재 세냥 지수와 분위기를 보여줍니다."),
  new SlashCommandBuilder()
    .setName("예측")
    .setDescription("사용자가 제공한 상황을 바탕으로 세냥 지수를 예측합니다.")
    .addStringOption((option) =>
      option.setName("상황").setDescription("예: 오늘 세냥한테 다들 안녕이라고 해줬어.").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("현재지수")
        .setDescription("기준으로 삼을 현재 지수입니다. 생략하면 저장된 지수를 사용합니다.")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(10000)
    ),
  new SlashCommandBuilder().setName("매수").setDescription("상승 예측을 접수합니다. 실제 매수가 아닙니다."),
  new SlashCommandBuilder().setName("매도").setDescription("하락 예측을 접수합니다. 실제 매도가 아닙니다."),
  new SlashCommandBuilder().setName("보합").setDescription("큰 변화 없음 예측을 접수합니다."),
  new SlashCommandBuilder()
    .setName("결산")
    .setDescription("공식 결과로 정산합니다. 결과를 생략하면 마지막 예측 기준으로 자동결산합니다.")
    .addStringOption((option) =>
      option
        .setName("결과")
        .setDescription("공식 결과입니다. 생략하면 마지막 /예측 결과를 사용합니다.")
        .setRequired(false)
        .addChoices(...resultChoices)
    )
    .addIntegerOption((option) =>
      option
        .setName("지수변화")
        .setDescription("예: 7 또는 -5. 자동결산에서는 생략하면 마지막 예측 변화값을 씁니다.")
        .setRequired(false)
        .setMinValue(-10000)
        .setMaxValue(10000)
    ),
  new SlashCommandBuilder()
    .setName("자동결산")
    .setDescription("마지막 /예측 결과를 기준으로 자동 정산합니다."),
  new SlashCommandBuilder().setName("랭킹").setDescription("가상 냥포인트 순위를 보여줍니다.")
];

export const commandsJson = commandBuilders.map((command) => command.toJSON());
