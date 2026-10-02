export type AdminRequestSeed={id:string;title:string;description:string;contextual_category:string};
export function requestTargetModule(category:string):"courses"|"equipment"|"balls"|null{
 if(/course|campo/i.test(category))return "courses";
 if(/ball|bola/i.test(category))return "balls";
 if(/equipment|club|shaft|baston|bastón|varilla/i.test(category))return "equipment";
 return null;
}
export function requestPrefill(seed:AdminRequestSeed,module:string):Record<string,unknown>{
 return {sourceName:"Solicitud de la comunidad",requestId:seed.id,...(module==="courses"?{name:seed.title,clubName:seed.title}:{model:seed.title})};
}
