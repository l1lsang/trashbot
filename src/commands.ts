import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("도움")
    .setDescription("DOUM 봇에게 질문하고 GPT 답변을 받습니다.")
    .addStringOption((option) =>
      option
        .setName("질문")
        .setDescription("DOUM에게 물어볼 내용입니다.")
        .setRequired(true)
        .setMaxLength(1800)
    ),
  new SlashCommandBuilder()
    .setName("업데이트")
    .setDescription("서버 태그 역할을 지금 동기화합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("범위")
        .setDescription("동기화할 서버 범위입니다. 기본값은 전체 서버입니다.")
        .addChoices(
          { name: "전체 서버", value: "all" },
          { name: "현재 서버", value: "current" }
        )
    ),
  new SlashCommandBuilder()
    .setName("범프통계")
    .setDescription("DISBOARD /bump 사용 횟수와 순위를 확인합니다.")
    .setDMPermission(false)
    .addUserOption((option) =>
      option.setName("사용자").setDescription("지정한 사용자의 범프 통계만 확인합니다.")
    ),
  new SlashCommandBuilder()
    .setName("범프초기화")
    .setDescription("DISBOARD /bump 통계를 초기화합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((option) =>
      option.setName("사용자").setDescription("지정하지 않으면 서버 전체 통계를 초기화합니다.")
    )
];

export const commandsJson = commandBuilders.map((command) => command.toJSON());
