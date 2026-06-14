import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { deflateSync } from "node:zlib";
import type { BotState, Direction, IndexEvent } from "./types.js";

type Rgba = [number, number, number, number];
type DigitGlyph = string[];

export interface ChartPayload {
  embed: EmbedBuilder;
  files: AttachmentBuilder[];
}

const chartFileName = "senyang-chart.png";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const crcTable = new Uint32Array(256);
const digitFont: Record<string, DigitGlyph> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["010", "010", "111", "010", "010"],
  "-": ["000", "000", "111", "000", "000"],
  " ": ["000", "000", "000", "000", "000"]
};

for (let i = 0; i < crcTable.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}

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

function compactValues(values: number[]): string {
  return values.map((value) => String(value)).join(" → ");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const scanlineLength = width * 4 + 1;
  const raw = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * scanlineLength;
    raw[rowStart] = 0;
    for (let x = 0; x < width * 4; x += 1) {
      raw[rowStart + 1 + x] = rgba[y * width * 4 + x] ?? 0;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    pngSignature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

class Bitmap {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgba
  ) {
    this.data = new Uint8Array(width * height * 4);
    this.fill(background);
  }

  fill(color: Rgba): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.setPixel(x, y, color);
      }
    }
  }

  setPixel(x: number, y: number, color: Rgba): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) {
      return;
    }

    const index = (iy * this.width + ix) * 4;
    const alpha = color[3] / 255;
    const inverseAlpha = 1 - alpha;
    this.data[index] = Math.round(color[0] * alpha + (this.data[index] ?? 0) * inverseAlpha);
    this.data[index + 1] = Math.round(color[1] * alpha + (this.data[index + 1] ?? 0) * inverseAlpha);
    this.data[index + 2] = Math.round(color[2] * alpha + (this.data[index + 2] ?? 0) * inverseAlpha);
    this.data[index + 3] = 255;
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgba): void {
    for (let yy = Math.round(y); yy < Math.round(y + height); yy += 1) {
      for (let xx = Math.round(x); xx < Math.round(x + width); xx += 1) {
        this.setPixel(xx, yy, color);
      }
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgba, thickness = 1): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const radius = Math.max(0, Math.floor(thickness / 2));

    for (let step = 0; step <= steps; step += 1) {
      const x = x1 + (dx * step) / steps;
      const y = y1 + (dy * step) / steps;
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          if (ox * ox + oy * oy <= radius * radius + 1) {
            this.setPixel(x + ox, y + oy, color);
          }
        }
      }
    }
  }

  circle(cx: number, cy: number, radius: number, color: Rgba): void {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (x * x + y * y <= radius * radius) {
          this.setPixel(cx + x, cy + y, color);
        }
      }
    }
  }
}

function textWidth(text: string, scale: number): number {
  return text.length * 4 * scale - scale;
}

function drawText(bitmap: Bitmap, text: string, x: number, y: number, color: Rgba, scale = 3): void {
  let cursor = x;

  for (const character of text) {
    const glyph = digitFont[character] ?? digitFont[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          bitmap.fillRect(cursor + column * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += 4 * scale;
  }
}

function yForValue(value: number, min: number, max: number, top: number, bottom: number): number {
  if (min === max) {
    return (top + bottom) / 2;
  }

  return bottom - ((value - min) / (max - min)) * (bottom - top);
}

function renderChartPng(values: number[], latestEvent: IndexEvent): Buffer {
  const width = 900;
  const height = 420;
  const bitmap = new Bitmap(width, height, [15, 23, 42, 255]);
  const plot = { left: 72, top: 54, right: width - 42, bottom: height - 64 };
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max(4, Math.ceil((maxValue - minValue || 10) * 0.15));
  const min = Math.max(0, minValue - padding);
  const max = maxValue + padding;
  const mid = Math.round((min + max) / 2);
  const lineColor: Rgba = latestEvent.delta >= 0 ? [34, 197, 94, 255] : [239, 68, 68, 255];
  const areaColor: Rgba = latestEvent.delta >= 0 ? [34, 197, 94, 42] : [239, 68, 68, 42];

  bitmap.fillRect(22, 22, width - 44, height - 44, [17, 24, 39, 255]);

  for (let i = 0; i <= 4; i += 1) {
    const y = plot.top + ((plot.bottom - plot.top) * i) / 4;
    bitmap.line(plot.left, y, plot.right, y, [51, 65, 85, 150], 1);
  }

  drawText(bitmap, String(max), 18, plot.top - 8, [203, 213, 225, 230], 3);
  drawText(bitmap, String(mid), 18, (plot.top + plot.bottom) / 2 - 8, [148, 163, 184, 220], 3);
  drawText(bitmap, String(min), 18, plot.bottom - 8, [203, 213, 225, 230], 3);

  const xStep = values.length > 1 ? (plot.right - plot.left) / (values.length - 1) : 0;
  const points = values.map((value, index) => ({
    x: values.length > 1 ? plot.left + xStep * index : (plot.left + plot.right) / 2,
    y: yForValue(value, min, max, plot.top, plot.bottom)
  }));

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const startX = Math.round(current.x);
    const endX = Math.round(next.x);

    for (let x = startX; x <= endX; x += 1) {
      const ratio = endX === startX ? 0 : (x - startX) / (endX - startX);
      const y = current.y + (next.y - current.y) * ratio;
      bitmap.line(x, y, x, plot.bottom, areaColor, 1);
    }
  }

  bitmap.line(plot.left, plot.top, plot.left, plot.bottom, [148, 163, 184, 190], 2);
  bitmap.line(plot.left, plot.bottom, plot.right, plot.bottom, [148, 163, 184, 190], 2);

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    bitmap.line(current.x, current.y, next.x, next.y, lineColor, 5);
  }

  for (const point of points) {
    bitmap.circle(point.x, point.y, 7, [248, 250, 252, 255]);
    bitmap.circle(point.x, point.y, 4, lineColor);
  }

  const latest = points[points.length - 1];
  if (latest) {
    bitmap.circle(latest.x, latest.y, 11, [248, 250, 252, 220]);
    bitmap.circle(latest.x, latest.y, 7, lineColor);

    const label = String(values[values.length - 1] ?? 0);
    const labelWidth = textWidth(label, 4);
    const labelX = Math.min(width - labelWidth - 30, Math.max(plot.left + 8, latest.x - labelWidth - 16));
    const labelY = Math.max(plot.top + 8, latest.y - 42);
    bitmap.fillRect(labelX - 10, labelY - 8, labelWidth + 20, 36, [15, 23, 42, 230]);
    bitmap.line(labelX - 10, labelY - 8, labelX + labelWidth + 10, labelY - 8, lineColor, 2);
    drawText(bitmap, label, labelX, labelY, [248, 250, 252, 255], 4);
  }

  return createPng(width, height, bitmap.data);
}

export function createIndexChartEmbed(state: BotState, latestEvent: IndexEvent): EmbedBuilder {
  const values = chartPoints(state);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const current = values[values.length - 1] ?? state.index;

  return new EmbedBuilder()
    .setColor(embedColor(latestEvent.delta))
    .setTitle(`${directionIcon(latestEvent.direction)} 세냥 지수 차트`)
    .setDescription(`최근 흐름: ${compactValues(values)}`)
    .setImage(`attachment://${chartFileName}`)
    .addFields(
      { name: "현재 지수", value: `${current}`, inline: true },
      { name: "이번 변동", value: deltaText(latestEvent.delta), inline: true },
      { name: "구간", value: `${min} ~ ${max}`, inline: true },
      { name: "이벤트", value: latestEvent.label, inline: false }
    )
    .setFooter({ text: "세냥 지수는 순수 오락용입니다." })
    .setTimestamp(new Date(latestEvent.createdAt));
}

export function createIndexChartPayload(state: BotState, latestEvent: IndexEvent): ChartPayload {
  const values = chartPoints(state);
  const image = renderChartPng(values, latestEvent);

  return {
    embed: createIndexChartEmbed(state, latestEvent),
    files: [new AttachmentBuilder(image, { name: chartFileName })]
  };
}
