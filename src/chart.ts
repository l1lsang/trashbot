import { EmbedBuilder } from "discord.js";
import type { BotState, Direction, IndexEvent } from "./types.js";

const sparkChars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function deltaText(delta: number): string {
  return delta >= 0 ? `+${delta}` : String(delta);
}

function directionIcon(direction: Direction): string {
  if (direction === "상승") {
    return "📈";
  }
  if (direction === "하락") {
    return "📉";
  }
  return "➖";
}

function embedColor(delta: number): number {
  if (delta > 0) {
    return 0x2ecc71;
  }
  if (delta < 0) {
    return 0xe74c3c;
  }
  return 0x95a5a6;
}

function chartPoints(state: BotState): number[] {
  const events = (state.indexHistory ?? []).slice(0, 14).reverse();
  if (events.length === 0) {
    return [state.index];
  }

  return [events[0].previousIndex, ...events.map((event) => event.finalIndex)];
}

function sparkline(values: number[]): string {
  if (values.length === 0) {
    return "▁";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return "▁".repeat(values.length);
  }

  return values
    .map((value) => {
      const index = Math.round(((value - min) / (max - min)) * (sparkChars.length - 1));
      return sparkChars[index] ?? sparkChars[0];
    })
    .join("");
}

function compactValues(values: number[]): string {
  return values.map((value) => String(value)).join(" → ");
}

export function createIndexChartEmbed(state: BotState, latestEvent: IndexEvent): EmbedBuilder {
  const values = chartPoints(state);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const current = values[values.length - 1] ?? state.index;

  return new EmbedBuilder()
    .setColor(embedColor(latestEvent.delta))
    .setTitle(`${directionIcon(latestEvent.direction)} 세냥 지수 차트`)
    .setDescription(["```text", sparkline(values), compactValues(values), "```"].join("\n"))
    .addFields(
      { name: "현재 지수", value: `${current}`, inline: true },
      { name: "이번 변동", value: deltaText(latestEvent.delta), inline: true },
      { name: "구간", value: `${min} ~ ${max}`, inline: true },
      { name: "이벤트", value: latestEvent.label, inline: false }
    )
    .setFooter({ text: "세냥 지수는 순수 오락용입니다." })
    .setTimestamp(new Date(latestEvent.createdAt));
}
