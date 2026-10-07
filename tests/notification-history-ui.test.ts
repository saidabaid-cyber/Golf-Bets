import assert from "node:assert/strict";
import test from "node:test";
import * as presentation from "../features/notifications/presentation";
import type { SocialNotification } from "../lib/social-activity-contract";
import { socialUI,settleUI,uiNodes,uiFind,uiText } from "./helpers/social-ui";
const target="11111111-1111-4111-8111-111111111111";
async function flush(){for(let i=0;i<8;i++)await settleUI();}
test("tap persists read before navigating; paused delivery and returning keep paginated received history",async()=>{
  const events:SocialNotification[]=Array.from({length:51},(_,i)=>({id:"event-"+i,type:"like",activityId:target,createdAt:new Date(Date.UTC(2026,9,6,12,0,0)-i*60000).toISOString(),readAt:null}));
  const actions:string[]=[];let opened="";
  const request=async(path:string,_token:string,options?:{method:string;body:{id?:string;all?:boolean;read:boolean}})=>{
    if(path.includes("notification-preferences"))return {enabled:false,data:[]};
    if(options?.method==="PATCH"){for(const event of events)if(options.body.all||event.id===options.body.id)event.readAt=options.body.read?"2026-10-07T12:00:00Z":null;actions.push("read");}
    const offset=Number(new URL(path,"https://qa.invalid").searchParams.get("cursor")||0);return {data:events.slice(offset,offset+50).map(e=>({...e})),nextCursor:offset+50<events.length?String(offset+50):null};
  };
  const groupInbox={invitations:[],loadedAt:1,reload:async()=>{},message:"",busy:false};
  const h=socialUI("app/components/notification-center.tsx",{"presentation":presentation,"client":{notificationsChanged:()=>{},NOTIFICATIONS_CHANGED:"notices"},"social-activity-client":{socialRequest:request,socialErrorMessage:()=>"Error"},"group-invitations":{useGroupInvitationInbox:()=>groupInbox},"golf-object-navigation":{useGolfNavigation:()=>({open:(object:{id:string})=>{assert.equal(actions.at(-1),"read");opened=object.id;}})}},{setInterval:()=>1,clearInterval:()=>{}});
  const props={viewerId:"viewer",accessToken:"token",onBack:()=>{},onPreferences:()=>{},onFriend:()=>{}};
  h.render("NotificationCenter",props);await flush();let tree=h.render("NotificationCenter",props);
  const rows=()=>uiNodes(tree).filter(n=>n.type?.name==="NotificationRow");assert.equal(rows().length,50);assert.match(uiText(tree),/Tu historial se conserva/);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="Ver más notificaciones").props.onClick();await flush();tree=h.render("NotificationCenter",props);assert.equal(rows().length,51);
  rows().at(-1)!.props.onOpen();await flush();tree=h.render("NotificationCenter",props);assert.equal(opened,target);assert.equal(events[50].readAt,"2026-10-07T12:00:00Z");assert.equal(rows().length,51);assert.equal(rows().at(-1)!.props.item.unread,false);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="Marcar todas como leídas").props.onClick();await flush();tree=h.render("NotificationCenter",props);assert.equal(rows().length,51);assert.equal(rows().some(n=>n.props.item.unread),false);assert.equal(presentation.notificationCounts(rows().map(n=>n.props.item)).Todas,0);h.unmount();
});
test("chronology ignores pending priority; resolved friendship history has no accept/reject actions",()=>{
  const events:SocialNotification[]=[{id:"old",type:"friend_request",activityId:target,createdAt:"2026-09-01T12:00:00Z",readAt:null},{id:"new",type:"friend_request",activityId:target+"other",createdAt:"2026-10-06T12:00:00Z",readAt:"2026-10-06T12:01:00Z",requestState:"ACCEPTED"}];
  const items=presentation.normalizeNotifications(events,[]);assert.equal(items[0].readIds[0],"new");assert.equal(items[0].pending,false);
  const h=socialUI("app/components/notification-center.tsx",{"presentation":presentation});const row=h.render("NotificationRow",{item:items[0],busy:false});assert.doesNotMatch(uiText(row),/Aceptar|Rechazar/);assert.equal(uiNodes(row).some(n=>n.props["aria-label"]==="Sin leer"),false);
});
