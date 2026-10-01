import { BET_REGISTRY } from "./bets/registry";
import { initialBets } from "./new-round-bets";
import { personalNassauComponentsForRoundHoles } from "./personal-nassau";
import type { BetConfig, PersonalBet, Player } from "./types";
import type { AdminField } from "./admin-simple-catalog";
export type BetVariant = { id:string;version:number;engine:string;title:string;description:string;active:boolean;order:number;minPlayers:number;maxPlayers:number;config:Record<string,unknown> };
const number=(key:string,label:string,min=0,max=1000000):AdminField=>({key,label,type:"number",min,max});
export function betVariantCapability(engine:string) {
 const definition=BET_REGISTRY.find(item=>item.id===engine);
 if(!definition || definition.templateEditor.kind!=="core"&&engine!=="individual_nassau")return null;
 const defaults=initialBets([]);let config:Record<string,unknown>;
 if(engine==="individual_nassau")config={baseValue:100,carryEnabled:false,pressureMultiplier:1};
 else {const path=definition.configPath.split(".").slice(1);let value:unknown=defaults;for(const key of path)value=(value as Record<string,unknown>)[key];config=value as Record<string,unknown>;}
 const fields:AdminField[]=[];
 for(const key of ["value","baseValue","fixedValue","pointValue","unitValue","copaValue"])if(key in config)fields.push(number(key,key==="baseValue"?"Monto por componente":key==="fixedValue"?"Monto fijo":key==="pointValue"?"Monto por punto":"Monto predeterminado",0.01));
 if("hcpPct" in config)fields.push(number("hcpPct","Handicap · porcentaje",0,100));
 if(engine==="skins")fields.push({key:"mode",label:"Carry",type:"select",options:["carry","no_carry"]});
 if(engine==="rabbits")fields.push({key:"mode",label:"Modalidad",type:"select",options:["continuous","three_hole_blocks"]},{key:"accumulate",label:"Acumular",type:"checkbox"});
 for(const key of ["carryEnabled","secondNinePressed"])if(key in config)fields.push({key,label:key==="carryEnabled"?"Carry":"Presión segunda vuelta",type:"checkbox"});
 for(const key of ["pressureMultiplier","secondNineMultiplier"])if(key in config)fields.push(number(key,"Multiplicador de presión",1,5));
 const minimum=engine==="monkey"?3:["foursome","ball_friend","loba"].includes(engine)?4:2;
 return {engine,label:definition.label,fields,defaults:Object.fromEntries(fields.map(field=>[field.key,config[field.key]])),minimum,maximum:minimum>2?minimum:5,definition};
}
export function validatedBetVariant(raw:Record<string,unknown>):Omit<BetVariant,"id"|"version"> {
 const capability=betVariantCapability(String(raw.engine));if(!capability)throw new Error("Este motor requiere desarrollo para crear variantes.");
 const allowed=["engine","title","description","active","order","minPlayers","maxPlayers","config"];
 if(Object.keys(raw).some(key=>!allowed.includes(key)))throw new Error("Esta configuración contiene opciones no permitidas.");
 const title=String(raw.title||"").trim();if(!title||title.length>160||typeof raw.active!=="boolean")throw new Error("Revisa el nombre y la visibilidad.");
 const minPlayers=Number(raw.minPlayers),maxPlayers=Number(raw.maxPlayers),order=Number(raw.order);
 if(!Number.isInteger(minPlayers)||!Number.isInteger(maxPlayers)||minPlayers<capability.minimum||maxPlayers>capability.maximum||minPlayers>maxPlayers||!Number.isInteger(order)||order<0||order>1000)throw new Error("Revisa los jugadores y el orden.");
 if(!raw.config||typeof raw.config!=="object"||Array.isArray(raw.config))throw new Error("Configuración no válida.");
 const input=raw.config as Record<string,unknown>;if(Object.keys(input).some(key=>!capability.fields.some(field=>field.key===key)))throw new Error("El motor no soporta esta opción.");
 const config:Record<string,unknown>={};for(const field of capability.fields){const value=input[field.key]??capability.defaults[field.key];if(field.type==="checkbox"){if(typeof value!=="boolean")throw new Error("Revisa "+field.label);config[field.key]=value;}else if(field.type==="number"){const n=Number(value);if(!Number.isFinite(n)||field.min!==undefined&&n<field.min||field.max!==undefined&&n>field.max||(field.key.includes("Multiplier")&&!Number.isInteger(n)))throw new Error("Revisa "+field.label);config[field.key]=n;}else{if(!field.options?.includes(String(value)))throw new Error("Revisa "+field.label);config[field.key]=String(value);}}
 const description=String(raw.description||"").trim();if(description.length>2000)throw new Error("Acorta la descripción.");
 return {engine:capability.engine,title,description,active:raw.active,order,minPlayers,maxPlayers,config};
}
/** Explicit setup operation only. Saved rounds/history never read mutable defaults. */
export function applyBetVariant(bets:BetConfig,players:Player[],ownerId:string,variant:BetVariant,roundHoles:9|18,startHole:number,rivalId?:string) {
 const validated=validatedBetVariant({engine:variant.engine,title:variant.title,description:variant.description,active:variant.active,order:variant.order,minPlayers:variant.minPlayers,maxPlayers:variant.maxPlayers,config:variant.config});
 if(!validated.active||players.length<validated.minPlayers||players.length>validated.maxPlayers)throw new Error("Esta variante requiere "+validated.minPlayers+"–"+validated.maxPlayers+" jugadores.");
 const capability=betVariantCapability(validated.engine)!;
 if(validated.engine==="individual_nassau") {
  const rival=players.find(player=>player.id===rivalId&&player.id!==ownerId);if(!rival||!players.some(player=>player.id===ownerId))throw new Error("Selecciona un rival distinto del jugador principal.");
  const personal:PersonalBet={id:crypto.randomUUID(),enabled:true,rivalMode:"group",rivalPlayerId:rival.id,rivalName:rival.name,externalScores:{},baseValue:Number(validated.config.baseValue),advantageMode:"current_index",advantageReceiver:"rival",advantageStrokes:0,back9Multiplier:1,nassauVersion:2,carryEnabled:validated.config.carryEnabled===true,pressureMultiplier:Number(validated.config.pressureMultiplier) as 1|2|3|4|5,pressureNine:startHole===10?"holes_1_9":"holes_10_18",components:personalNassauComponentsForRoundHoles({match1:true,medal1:true,match2:true,medal2:true,match18:true,medal18:true},roundHoles)};
  return {bets:structuredClone(bets),personal};
 }
 if(roundHoles===9&&["polla_second","polla_total"].includes(validated.engine))throw new Error("Esta variante requiere una ronda de 18 hoyos.");
 const next=structuredClone(bets);const path=capability.definition.configPath.split(".").slice(1);let target=next as unknown as Record<string,unknown>;for(const key of path.slice(0,-1))target=target[key] as Record<string,unknown>;
 const key=path.at(-1)!;target[key]={...(target[key] as Record<string,unknown>),...validated.config,enabled:true,participantIds:players.map(player=>player.id)};
 return {bets:next,personal:undefined};
}
