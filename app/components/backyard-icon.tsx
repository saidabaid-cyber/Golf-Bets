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
} as const;
export function BackyardIcon({ name, size = 24, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>;
}
