import type { ClubCategory } from "../../lib/golf-equipment";

/** Neutral product silhouettes: no manufacturer marks, model claims or photos. */
export function ClubCategoryVisual({ category, className }: { category: ClubCategory; className?: string }) {
  const wood = category === "DRIVER" || category === "MINI_DRIVER" || category === "FAIRWAY_WOOD" || category === "HYBRID";
  const putter = category === "PUTTER";
  const wedge = category === "WEDGE";
  return <svg className={className} viewBox="0 0 120 180" fill="none" aria-hidden="true">
    <path d="M80 14 45 143" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    <path d="m80 14 8 3" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity=".45" />
    {wood && <>
      <path d={category === "DRIVER" ? "M18 130c11-15 44-19 61-4 8 7 5 23-7 29-19 10-51 8-62-5-6-7 1-14 8-20Z" : category === "FAIRWAY_WOOD" ? "M24 134c12-12 39-15 54-4 8 6 5 19-6 24-18 8-44 6-53-4-5-6-1-11 5-16Z" : "M27 135c10-11 33-15 47-5 8 6 7 17-3 23-15 9-39 7-48-2-5-5-2-11 4-16Z"} fill="currentColor" opacity=".92" />
      <path d="M29 137c12-5 28-7 43-2" stroke="white" strokeWidth="3" strokeLinecap="round" opacity=".48" />
    </>}
    {!wood && !putter && <>
      <path d={wedge ? "m19 145 24-20 34 11-8 28-38-3Z" : category === "IRON_SET" ? "m18 143 25-23 36 13-8 31-41-3Z" : "m22 141 22-20 32 12-7 29-37-3Z"} fill="currentColor" />
      <path d="m31 147 35 7" stroke="white" strokeWidth="3" strokeLinecap="round" opacity=".48" />
    </>}
    {putter && <>
      <path d="m25 143 47-5 5 19-49 7Z" fill="currentColor" />
      <path d="m32 149 34-4" stroke="white" strokeWidth="3" strokeLinecap="round" opacity=".48" />
    </>}
    <path d="M88 17c0 8-4 15-11 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".25" />
  </svg>;
}

export function GolfBallVisual({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <circle cx="60" cy="60" r="50" fill="#eef3eb" stroke="currentColor" strokeWidth="2" />
    <circle cx="44" cy="41" r="31" fill="#fff" opacity=".62" />
    {[[39,31],[57,25],[74,31],[29,48],[48,47],[67,44],[84,49],[26,68],[45,65],[64,63],[83,68],[35,84],[55,82],[74,86]].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.2" fill="none" stroke="currentColor" strokeWidth="1" opacity=".28" />)}
  </svg>;
}
