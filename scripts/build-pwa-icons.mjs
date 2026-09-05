import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const source = await loadImage(new URL("../app/apple-icon.png", import.meta.url));
const output = new URL("../public/icons/", import.meta.url);
await mkdir(output, { recursive: true });

async function render(size, name, inset = 0) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = "#f2f5f1";
  context.fillRect(0, 0, size, size);
  const margin = Math.round(size * inset);
  context.drawImage(source, margin, margin, size - margin * 2, size - margin * 2);
  await writeFile(new URL(name, output), canvas.toBuffer("image/png"));
}

await Promise.all([
  render(192, "icon-192.png"),
  render(512, "icon-512.png"),
  render(192, "maskable-192.png", 0.1),
  render(512, "maskable-512.png", 0.1),
]);
