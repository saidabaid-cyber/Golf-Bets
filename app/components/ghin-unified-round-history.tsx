"use client";
import { useMemo, type ReactNode } from "react";
import type { RoundSnapshot } from "../../lib/types";
import { buildGolfInsights } from "../../lib/golf-insights";
import { careerScoreSamples } from "../../lib/career-statistics";
import type { GhinImportedScoresController } from "./use-ghin-imported-scores";
import { GhinImportHistory } from "./ghin-import-history";

/** Retain every existing Backyard action; only provider-owned cards are read-only. */
export function GhinUnifiedRoundHistory({history,userId,control,year,month,renderRound}:{
  history:RoundSnapshot[];userId:string;control:GhinImportedScoresController;
  year:string;month:string;renderRound:(round:RoundSnapshot)=>ReactNode;
}) {
  const backyard=useMemo(()=>{
    const scores=new Map(careerScoreSamples(history,buildGolfInsights(history),userId).map(r=>[r.id,r.gross]));
    return history.map(r=>({id:r.id,date:r.date,courseName:r.courseName,teeName:r.teeName,
      holes:r.roundHoles??r.order?.length??null,gross:scores.get(r.id)??null}));
  },[history,userId]);
  const byId=useMemo(()=>new Map(history.map(r=>[r.id,r])),[history]);
  return <GhinImportHistory control={control} backyard={backyard} year={year||"all"} month={month||"all"}
    renderBackyard={entry=>{const round=byId.get(entry.backyardId!);return round?renderRound(round):null;}}/>;
}
