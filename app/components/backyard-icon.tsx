import type { CSSProperties } from "react";

/** Decorative line art, not product photography. Labels belong to the control. */
const paths = {
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
  approach: "M12 21a8 3 0 1 0 0-6 8 3 0 0 0 0 6Zm0-3h.01M12 15V3m0 0 6 2.5L12 8",
  shortGame: "M4 19h7l2-4-6-2-3 6Zm8-14 5 9m2 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  bunker: "M3 17c3-4 6-4 9 0s6 4 9 0M4 20h16M16 4l-6 10m4-7 4 2m-9 4 4 2M6 10h.01",
  putting: "M5 4v11m0 0 5-1v3l-5 1v-3Zm10 5v10m-3 0h6m2-7a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  consistency: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-4 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4 0h.01",
  strategy: "M4 20V5l5-2 6 2 5-2v15l-5 2-6-2-5 2Zm5-17v15m6-13v15M6.5 9c2 1 3 2 4.5 4s3 2 6 1",
  mental: "M9 20c-3 0-5-2-5-5 0-1 .4-2 1.2-2.8A4.5 4.5 0 0 1 8 4c1.5 0 2.8.8 4 2 1.2-1.2 2.5-2 4-2a4.5 4.5 0 0 1 2.8 8.2c.8.8 1.2 1.8 1.2 2.8 0 3-2 5-5 5h-2v-6h3m-7 6v-6H6",
  handicap: "M4 6h5v5m0-5-5 5m16 7h-5v-5m0 5 5-5M4 18l6-6 4 3 6-8",
} as const;
export function BackyardIcon({ name, size = 24, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>;
}
