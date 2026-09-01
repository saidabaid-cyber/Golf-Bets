import type { RoundSnapshot } from "./types";
import { roundSnapshotToCsv } from "./round-utils";

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("es-MX")}`;

export function roundShareText(round: RoundSnapshot) {
  const categories = Object.entries(round.categoryResults).filter(([, value]) => value !== 0).map(([name, value]) => `${name}: ${signed(value)}`).join(" · ");
  return `Golf Bets\n${round.courseName} · ${round.date}\n${round.ownerName}: ${signed(round.betResult)} en apuestas\nGastos: $${round.expenseTotal.toLocaleString("es-MX")}\nNeto: ${signed(round.netResult)}${categories ? `\n${categories}` : ""}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadRoundCsv(round: RoundSnapshot) {
  download(new Blob(["\uFEFF", roundSnapshotToCsv(round)], { type: "text/csv;charset=utf-8" }), `golf-bets-${round.date}.csv`);
}

export async function roundCardBlob(round: RoundSnapshot) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas no disponible");
  const gradient = context.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#0b2b23");
  gradient.addColorStop(1, "#1f6a4f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, 1350);
  context.fillStyle = "#e8c66a";
  context.font = "700 38px system-ui";
  context.fillText("GOLF BETS", 80, 110);
  context.fillStyle = "#ffffff";
  context.font = "700 72px system-ui";
  context.fillText(round.courseName.slice(0, 24), 80, 220);
  context.font = "400 34px system-ui";
  context.fillText(round.date, 80, 280);
  context.font = "600 42px system-ui";
  context.fillText(round.ownerName, 80, 405);
  context.font = "800 110px system-ui";
  context.fillStyle = round.netResult >= 0 ? "#a8f0c5" : "#ffc0b8";
  context.fillText(signed(round.netResult), 80, 540);
  context.fillStyle = "#ffffff";
  context.font = "500 30px system-ui";
  context.fillText(`Apuestas ${signed(round.betResult)} · Gastos $${round.expenseTotal.toLocaleString("es-MX")}`, 80, 610);
  let y = 740;
  context.font = "600 30px system-ui";
  for (const [name, value] of Object.entries(round.categoryResults).filter(([, value]) => value !== 0).slice(0, 8)) {
    context.fillText(name, 80, y);
    context.textAlign = "right";
    context.fillText(signed(value), 1000, y);
    context.textAlign = "left";
    y += 62;
  }
  context.fillStyle = "rgba(255,255,255,.65)";
  context.font = "400 25px system-ui";
  context.fillText("Resultado registrado con Golf Bets", 80, 1280);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("No se generó la imagen")), "image/png"));
}

export async function shareRound(round: RoundSnapshot) {
  const text = roundShareText(round);
  const image = await roundCardBlob(round);
  const file = new File([image], `golf-bets-${round.date}.png`, { type: "image/png" });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title: `Golf Bets · ${round.courseName}`, text, files: [file] });
    return "shared";
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return "copied";
  }
  download(image, file.name);
  return "downloaded";
}

export async function downloadRoundImage(round: RoundSnapshot) {
  download(await roundCardBlob(round), `golf-bets-${round.date}.png`);
}

export async function downloadRoundPdf(round: RoundSnapshot) {
  const [{ jsPDF }, image] = await Promise.all([import("jspdf"), roundCardBlob(round)]);
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(image);
  });
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pdf.addImage(dataUrl, "PNG", 15, 15, 180, 225);
  pdf.save(`golf-bets-${round.date}.pdf`);
}
