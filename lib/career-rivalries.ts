import { ownCareerHistory } from "./career-statistics";
import { careerScorecardEvidence, type CareerCompetitionEvidence } from "./round-achievements";
import type { RoundSnapshot } from "./types";
export type CareerMatch = { roundId: string; date: string; courseName: string; format: "Stroke Play"; holes: 9 | 18; ownScore: number; rivalScore: number; result: "win" | "loss" | "tie" };
export type CareerRivalry = {
  playerA: string; playerB: string; name: string; matches: CareerMatch[]; matchesPlayed: number;
  wins: number; losses: number; ties: number; winRate: number;
  currentStreak: { result: CareerMatch["result"]; count: number }; bestWinStreak: number;
  firstMatch: string; lastMatch: string; formats: string[]; bestStreakAt?: string; bestStreakRoundId?: string;
};
/** Sports-only read model. Financial snapshot fields never enter this projection. */
export function deriveCareerRivalries(rounds: readonly RoundSnapshot[], userId: string): CareerRivalry[] {
  const rows = new Map<string,{name:string;matches:CareerMatch[]}>();
  for (const round of ownCareerHistory(rounds,userId)) {
    const card = careerScorecardEvidence(round,userId);
    if (!card) continue;
    for (const rival of round.players ?? []) {
      if (rival.id === card.player.id || rival.accountUserId === userId) continue;
      const groupMember = round.groupOrigin?.selectedMembers.find(m => m.roundPlayerId === rival.id);
      // An unlinked guest is scoped to its card; equal names/local IDs cannot join people.
      const key = rival.accountUserId ? `account:${rival.accountUserId}` : groupMember ? `group:${round.groupOrigin!.groupId}:${groupMember.memberId}` : `guest:${round.id}:${rival.id}`;
      if (rival.accountUserId && round.players!.filter(p => p.accountUserId === rival.accountUserId).length !== 1) continue;
      const definitions = round.courseSnapshot?.playerHoleCards?.[rival.id] ?? round.courseSnapshot?.holes;
      const values = card.holes.map(h => round.scores?.[h.number]?.[rival.id]);
      if (values.some(v => !Number.isInteger(v) || (v as number) < 1 || (v as number) > 100)
        || card.holes.some(h => definitions?.find(d => d.number === h.number)?.par !== h.par)) continue;
      const rivalScore = (values as number[]).reduce((a,b) => a+b,0);
      const item = rows.get(key) ?? {name:rival.name,matches:[]};
      item.name = rival.name;
      item.matches.push({roundId:round.id,date:round.date,courseName:round.courseName,format:"Stroke Play",holes:card.holes.length as 9 | 18,ownScore:card.gross,rivalScore,result:card.gross < rivalScore ? "win" : card.gross > rivalScore ? "loss" : "tie"});
      rows.set(key,item);
    }
  }
  return [...rows].map(([key,item]) => {
    const matches = item.matches.sort((a,b) => a.date.localeCompare(b.date) || a.roundId.localeCompare(b.roundId));
    let run = 0, best = 0, bestStreakAt: string | undefined, bestStreakRoundId: string | undefined;
    for (const match of matches) { run = match.result === "win" ? run+1 : 0; if (run > best) {best=run;bestStreakAt=match.date;bestStreakRoundId=match.roundId;} }
    const last = matches[matches.length-1];
    let current = 0; for(let i=matches.length-1;i>=0 && matches[i].result===last.result;i--) current++;
    const wins=matches.filter(m=>m.result==="win").length,losses=matches.filter(m=>m.result==="loss").length,ties=matches.length-wins-losses;
    return {playerA:userId,playerB:key,name:item.name,matches:[...matches].reverse(),matchesPlayed:matches.length,wins,losses,ties,winRate:wins/matches.length*100,currentStreak:{result:last.result,count:current},bestWinStreak:best,firstMatch:matches[0].date,lastMatch:last.date,formats:["Stroke Play"],bestStreakAt,bestStreakRoundId};
  }).sort((a,b) => b.matchesPlayed-a.matchesPlayed || b.lastMatch.localeCompare(a.lastMatch) || a.playerB.localeCompare(b.playerB));
}
export function rivalryCompetitionEvidence(rivalries: readonly CareerRivalry[]): CareerCompetitionEvidence {
  const best = [...rivalries].sort((a,b)=>b.bestWinStreak-a.bestWinStreak || (a.bestStreakAt??"").localeCompare(b.bestStreakAt??""))[0];
  return {bestWinStreak:best?.bestWinStreak ?? 0,streakAt:best?.bestStreakAt,streakRoundId:best?.bestStreakRoundId};
}
export function rivalryTotals(rows: readonly CareerRivalry[]) {
  const matches = rows.reduce((sum,r)=>sum+r.matchesPlayed,0),wins=rows.reduce((sum,r)=>sum+r.wins,0);
  return {matches,wins,winRate:matches ? wins/matches*100 : undefined,bestStreak:rows.length ? Math.max(...rows.map(r=>r.bestWinStreak)) : undefined};
}
