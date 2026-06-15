import { SlashCommandBuilder } from "discord.js";

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
    )
];

export const commandsJson = commandBuilders.map((command) => command.toJSON());
