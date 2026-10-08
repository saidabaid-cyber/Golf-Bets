export const SOCIAL_PLAYER_TABS=['activity','rounds','achievements','courses','equipment','friends'] as const;
export type SocialPlayerTab=typeof SOCIAL_PLAYER_TABS[number];
export function socialPlayerFromSearch(search:string){const params=new URLSearchParams(search),id=params.get('player');return id&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)&&(!params.get('screen')||params.get('screen')==='welcome')?id:null;}
export function socialPlayerTabFromSearch(search:string):SocialPlayerTab {const value=new URLSearchParams(search).get('playerTab');return SOCIAL_PLAYER_TABS.find(tab=>tab===value)??'activity';}
export function socialPlayerHref(search:string,id:string|null,tab:SocialPlayerTab='activity') {
  const params=new URLSearchParams(search);for(const key of ['player','playerTab','card','cardHole','cardPlayer','feedActivity','feedView'])params.delete(key);
  if(id){params.set('player',id);if(tab!=='activity')params.set('playerTab',tab);}return `/${params.size?`?${params}`:''}`;
}
