import type { CSSProperties } from "react";

/** Decorative line art, not product photography. Labels belong to the control. */
const paths = {
  search: "M21 21l-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  comment: "M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.4-5a9 9 0 1 1 16.6-4.5Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  chevron: "m9 5 7 7-7 7",
  back: "m15 5-7 7 7 7",
  info: "M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6",
  trophy: "M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8",
  qr: "M3 3h6v6H3V3Zm12 0h6v6h-6V3ZM3 15h6v6H3v-6Zm12 0h2v2h-2v-2Zm6 0v4h-4v2m-5-9h4m5 0h-2M12 3v2m0 4v3M3 12h6m3 4v5",
  scan: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h10v10H7V7Zm-2 5h14",
  personAdd: "M15 21v-3a5 5 0 0 0-10 0v3m5-13a3 3 0 1 0 0-6 3 3 0 0 0 0 6m9 1v6m-3-3h6",
  clock: "M12 7v5l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  bars: "M5 20v-6m7 6V8m7 12V3",
  flag: "M5 21V3m0 0c5-4 9 5 15 1v10c-6 4-10-5-15-1",
  score: "M5 3h14v18H5zM8 7h8M8 11h3m3 0h2m-8 4h3m3 0h2",
  players: "M16 21v-3a5 5 0 0 0-10 0v3m5-13a3 3 0 1 0 0-6 3 3 0 0 0 0 6m7 3a4 4 0 0 1 4 4v4M18 2a3 3 0 0 1 0 6",
  club: "M16 2 8 18m0 0-4 1c-2 1-2 3 0 3h5c2 0 3-3-1-4",
  ball: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M7 8h.01M11 6h.01M6 12h.01M10 10h.01M15 8h.01M9 15h.01M14 13h.01M14 17h.01M18 12h.01",
  shaft: "M5 21 18 3m-2-1 4 3M4 18l3 3M13 8l3 2",
  spark: "m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  driver: "M16.5 2.5 9 16m0 0c-3-1-6 .3-6 2.3 0 2.5 4.7 3.4 8.7 2.2 3.1-.9 2.4-3.4-1.7-5M16 3l3 1",
  irons: "M7 3l7 14m-7-1-3 2 1.5 3H11l1-3-5-2Zm7-13 5 11m-2-1-2 1 1 2h4l.5-2-3.5-1Z",
  approach: "M12 21c5 0 9-1.8 9-4s-4-4-9-4-9 1.8-9 4 4 4 9 4Zm0-4h.01M12 13V3m0 0 5 2-5 2M3 8a1.25 1.25 0 1 0 2.5 0A1.25 1.25 0 0 0 3 8Zm2.5 1c2 .5 3.5 1.5 5 3",
  shortGame: "M4 19h7l2-4-6-2-3 6Zm8-14 5 9m2 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  bunker: "M3 17c3-4 6-4 9 0s6 4 9 0M4 20h16M16 4l-6 10m4-7 4 2m-9 4 4 2M6 10h.01",
  putting: "M5 4v11m0 0 5-1v3l-5 1v-3Zm10 5v10m-3 0h6m2-7a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  consistency: "M4 5h16v14H4zM7 9a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm4-1a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm4 3a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm-6 4a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm5 1a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z",
  strategy: "M4 20V5l5-2 6 2 5-2v15l-5 2-6-2-5 2Zm5-17v15m6-13v15M6.5 9c2 1 3 2 4.5 4s3 2 6 1",
  mental: "M15 21H9v-4H6l2-3a7 7 0 1 1 7 7M12 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 2v2m-1-1h2",
  handicap: "M4 4h16v16H4zM7 8h3m-3 4h2m-2 4h2m3-7 3 3 4 4m0 0v-4m0 4h-4",
  driverDistance: "M16 3 9 15m0 0c-3-1-6 .2-6 2.2 0 2.3 4.2 3.1 7.8 2.1 3-.9 2.4-3.2-1.8-4.3M14 6c3-1 5 0 7 2m0 0-3-.3M21 8l-1.4-2.5",
  lessDriverSpin: "M13 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 7c3-4 9-4 12 0m0 0-3-1m3 1-.5-3M19 5v14m0 0-3-3m3 3 3-3",
  stabilityControl: "M21 12c0 4-4 7-9 7s-9-3-9-7 4-7 9-7 9 3 9 7ZM8 11a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm4-2a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm2 5a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm-5 2a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z",
  trajectoryHeight: "M3 20h18M4 17C8 3 16 3 20 17M18.5 16.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z",
  ironControl: "M5 3l6 13m0 0-5-2-3 4 2 3h6l2-3-2-2M18 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 3h.01",
  stopOnGreen: "M3 19h18M4 6c5 0 8 4 10 10m-1.5 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM18 13v5m3-4v4",
  wedgeSpin: "M3 19h8l2-4-6-2-4 6Zm8-14 5 9m6 3a3 3 0 1 1-2-2.8m2 2.8-2.5-.5M22 17l-.5-2.5",
  greensideFeel: "M3 19h7l2-4-6-2-3 6Zm8-14 5 9m1 5c2-3 3-4 5-4M18 18a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM21 15V6m0 0-3 1.5L21 9",
  putterFeel: "M5 3v14m0 0 6-1v3l-6 1v-3m10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm5 3h-6M20 7v9m-2 0h4",
} as const;
export type BackyardIconName = keyof typeof paths;

export function BackyardIcon({ name, size = 24, style }: { name: BackyardIconName; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>;
}
