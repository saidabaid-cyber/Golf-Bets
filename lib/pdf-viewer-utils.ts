/** Keep canvas allocation below iOS memory limits, even when zooming a tall page. */
export function pdfPixelRatio(width: number, height: number, deviceRatio: number) {
  return Math.min(Math.max(1, deviceRatio), 2, Math.sqrt(4_000_000 / Math.max(1, width * height)));
}

export async function withPdfDeadline<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PDF timeout")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
