export function auditFilters(params:URLSearchParams){
 const actor=params.get("actor")||"",entity=params.get("entity")||"",action=params.get("action")||"",from=params.get("from")||"",until=params.get("until")||"";
 const offset=Number(params.get("offset")||0);
 if(!Number.isInteger(offset)||offset<0||offset>100000||actor&&!/^[\da-f-]{36}$/i.test(actor)||entity&&!/^[A-Z_]{1,50}$/.test(entity)||action&&!/^[A-Z_]{1,70}$/.test(action))throw new Error("Filtros no válidos.");
 for(const date of [from,until])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error("Revisa las fechas.");
 if(from&&until&&from>until)throw new Error("Revisa el rango de fechas.");
 return {actor,entity,action,from:from?from+"T00:00:00Z":"",until:until?new Date(Date.parse(until)+86400000).toISOString():"",offset};
}
