import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeNotifications, notificationCounts, notificationCategory, notificationDestination, notificationTime, NOTIFICATION_FILTERS } from "../features/notifications/presentation";
import { defaultNotificationPreferences, NOTIFICATION_EVENT_TYPES } from "../features/notifications/domain";
import type { SocialNotification, SocialActivityPreferences } from "../lib/social-activity-contract";
import type { GroupInvitation } from "../lib/group-invitations";
import { screenHref, screenFromSearch, BOTTOM_NAV_TARGETS } from "../lib/app-navigation";
import { renderCareer } from "./helpers/render-career";

const now=Date.parse("2026-10-05T12:00:00Z"), resource="11111111-1111-4111-8111-111111111111";
const event=(patch:Partial<SocialNotification>={}):SocialNotification=>({id:"22222222-2222-4222-8222-222222222222",type:"friend_request",activityId:resource,createdAt:new Date(now-300_000).toISOString(),readAt:null,...patch});
const invite=(patch:Partial<GroupInvitation>={}):GroupInvitation=>({id:resource,group_id:"33333333-3333-4333-8333-333333333333",group_name:"Miércoles de golf",recipient_label:"QA",state:"PENDING",delivery_status:"NOT_SENT",expires_at:new Date(now+86_400_000).toISOString(),outgoing:false,...patch});
const social:SocialActivityPreferences={enabledForFriends:false,shareRounds:false,shareAchievements:false,shareCourses:false,shareEquipment:false,notifyLike:true,notifyComment:true,notifyAttest:true,notifyFriendAchievement:true,notifyEquipment:true,notifyFriendRequest:true,updatedAt:new Date(now).toISOString()};
const controls=(enabled=true)=>renderCareer("app/components/notification-preferences.tsx","NotificationPreferenceControls",{
  events:{enabled,data:defaultNotificationPreferences("owner",new Date(now).toISOString())},social,
  delivery:{delivery:{push:{configured:false,state:"not_configured"},email:{configured:false,state:"not_configured"}}},
  busy:false,onMaster:()=>{},onEvent:()=>{},onSocial:()=>{},
});

test("bell counts unique unread social plus valid incoming operational invitations",()=>{
  const list=normalizeNotifications([event(),event({id:"second",type:"group_invite"})],[invite()],now);
  assert.deepEqual(notificationCounts(list),{Todas:2,Social:0,Atest:0,Amigos:1,Grupos:1,Rondas:0});
  assert.equal(list.length,2);
});
for(const [name,patch] of [
  ["outgoing",{outgoing:true}], ["expired",{expires_at:new Date(now-1).toISOString()}],
  ["accepted",{state:"ACCEPTED"}], ["declined",{state:"DECLINED"}], ["revoked",{state:"REVOKED"}],
] as Array<[string,Partial<GroupInvitation>]>) test(`bell excludes ${name} group invitation`,()=>{
  assert.equal(notificationCounts(normalizeNotifications([], [invite(patch)],now)).Todas,0);
});
test("marking an invitation event read never resolves its operational pending state",()=>{
  const item=normalizeNotifications([event({type:"group_invite",readAt:new Date(now).toISOString()})],[invite()],now)[0];
  assert.equal(item.unread,false);assert.equal(item.pending,true);assert.equal(item.invitation?.state,"PENDING");
  assert.equal(notificationCounts([item]).Grupos,1);
});
test("read friend requests remain actionable but are excluded from unread badge",()=>{
  const item=normalizeNotifications([event({readAt:new Date(now).toISOString()})],[],now)[0];
  assert.equal(item.pending,true);assert.equal(notificationCounts([item]).Amigos,0);
});
test("duplicate logical events merge read ids while separate comments stay separate",()=>{
  const list=normalizeNotifications([event(),event({id:"retry"}),event({id:"comment1",type:"comment"}),event({id:"comment2",type:"comment"})],[],now);
  assert.equal(list.length,3);assert.deepEqual(list[0].readIds,[event().id,"retry"]);
});
test("group event referencing group id deduplicates against invitation id",()=>{
  const list=normalizeNotifications([event({type:"group_invite",activityId:invite().group_id})],[invite()],now);
  assert.equal(list.length,1);assert.equal(list[0].resourceId,invite().group_id);
});
test("filters classify every supported event and do not create empty-category events",()=>{
  assert.deepEqual(NOTIFICATION_FILTERS,["Todas","Social","Atest","Amigos","Grupos","Rondas"]);
  for(const type of NOTIFICATION_EVENT_TYPES){assert.equal(notificationCategory(type),type==="group_invite"?"Grupos":type.startsWith("round_")||type==="scorecard_ready"?"Rondas":"Amigos");}
  assert.equal(notificationCategory('like'),'Social');assert.equal(notificationCategory('comment'),'Social');assert.equal(notificationCategory('attest'),'Atest');assert.equal(notificationCategory('attest_request'),'Atest');
  const list=normalizeNotifications([event(),event({type:"round_started",id:"round"})],[],now);
  assert.equal(list.filter(item=>item.category==="Amigos").length,1);assert.equal(list.filter(item=>item.category==="Rondas").length,1);assert.equal(list.filter(item=>item.category==="Grupos").length,0);
});
test("canonical resource destinations distinguish profile, group, round and social card",()=>{
  for(const [type,kind] of [["friend_request","friend"],["friend_accepted","friend"],["group_invite","group"],["round_started","round"],["round_finished","round"],["scorecard_ready","round"],["like","activity"],["equipment","activity"]] as const){
    const item=normalizeNotifications([event({type})],[],now)[0];assert.equal(notificationDestination(item),kind);assert.equal(item.resourceId,resource);
  }
});
test("dates come from real createdAt; missing operational dates are not guessed",()=>{
  assert.equal(notificationTime(new Date(now).toISOString(),now),"Ahora");assert.equal(notificationTime(event().createdAt,now),"Hace 5 min");
  assert.equal(notificationTime(new Date(now-7_200_000).toISOString(),now),"Hace 2 h");assert.equal(notificationTime(new Date(now-86_400_000).toISOString(),now),"Ayer");
  const group=normalizeNotifications([], [invite()],now)[0];assert.equal(group.createdAt,null);assert.equal(notificationTime(group.createdAt,now),"Invitación pendiente");
});
test("friend request row renders Accept, Reject, profile and accessible read controls",()=>{
  const item=normalizeNotifications([event({person:{userId:resource,displayName:"Nombre muy largo de QA Carlos Fairway",username:"qa_carlos",avatarUrl:null}})],[],now)[0];
  const html=renderCareer("app/components/notification-center.tsx","NotificationRow",{item,busy:false,onOpen:()=>{},onFriend:()=>{},onRead:()=>{},onGroupAccept:()=>{}});
  for(const copy of ["Aceptar","Rechazar","Ver perfil","Marcar como leído","Sin leer"])assert.match(html,new RegExp(copy));
  assert.doesNotMatch(html,/Comunidad|type="checkbox"|Eliminar/);
});
test("read row offers mark unread without inventing a DELETE action",()=>{
  const item=normalizeNotifications([event({readAt:new Date(now).toISOString()})],[],now)[0];
  const html=renderCareer("app/components/notification-center.tsx","NotificationRow",{item,busy:false,onOpen:()=>{},onFriend:()=>{},onRead:()=>{},onGroupAccept:()=>{}});
  assert.match(html,/Marcar como no leído/);assert.doesNotMatch(html,/aria-label="Sin leer"|Eliminar/);
});
test("round row actions use review and results contracts without exposing money or made-up score",()=>{
  for(const [type,copy] of [["round_started","Ver ronda"],["scorecard_ready","Revisar tarjeta"],["round_finished","Ver resultados"]] as const){
    const item=normalizeNotifications([event({type,...{moneyWon:5000,balance:4000,score:82}})],[],now)[0];
    const html=renderCareer("app/components/notification-center.tsx","NotificationRow",{item,busy:false,onOpen:()=>{},onFriend:()=>{},onRead:()=>{},onGroupAccept:()=>{}});
    assert.match(html,new RegExp(copy));assert.doesNotMatch(html,/5000|4000|Tu score: 82|Ganaste|\$/);
  }
});
test("group row reuses accept and never fabricates unsupported reject",()=>{
  const item=normalizeNotifications([], [invite()],now)[0];
  const html=renderCareer("app/components/notification-center.tsx","NotificationRow",{item,busy:false,onOpen:()=>{},onFriend:()=>{},onRead:()=>{},onGroupAccept:()=>{}});
  assert.match(html,/Unirme/);assert.match(html,/Ver invitación/);assert.doesNotMatch(html,/Rechazar|12 jugadores|apuestas habituales/);
});
test("all notification booleans are iOS switches, never visible checkboxes or QR category",()=>{
  const html=controls();assert.equal((html.match(/role="switch"/g)||[]).length,16);
  assert.doesNotMatch(html,/<input|checkbox|Invitaciones por QR|notifyAttest/);
  for(const label of ["Solicitudes de amistad","Solicitud aceptada","Invitaciones a grupos","Invitaciones a rondas","Rondas iniciadas","Resultados de ronda","Tarjetas para confirmar","Likes","Comentarios","Confirmaciones de tarjeta","Logros de amigos","Actualizaciones de equipo"]){assert.ok(html.includes(label),label);}
});
test("master OFF disables configurable switches without destroying their individual checked values",()=>{
  const off=controls(false),on=controls(true);
  assert.equal((off.match(/aria-checked="true"/g)||[]).length,12);assert.equal((on.match(/aria-checked="true"/g)||[]).length,13);
  assert.equal((off.match(/disabled=""/g)||[]).length,15);assert.equal((on.match(/disabled=""/g)||[]).length,2);
});
test("unconfigured push and email are disabled and never claimed to deliver",()=>{
  const html=controls();assert.match(html,/Push todavía no está disponible en este entorno/);assert.match(html,/entrega por email todavía no está disponible/);
  assert.match(html,/aria-label="Notificaciones push" aria-checked="false" disabled/);
  assert.match(html,/aria-label="Email" aria-checked="false" disabled/);assert.doesNotMatch(html,/Push activado|Email activado|requestPermission/);
});
test("dedicated notification URLs survive direct reload and keep bottom navigation targets unchanged",()=>{
  assert.equal(screenFromSearch(screenHref("notifications").slice(1)),"notifications");assert.equal(screenFromSearch(screenHref("notificationPreferences").slice(1)),"notificationPreferences");
  assert.deepEqual(Object.keys(BOTTOM_NAV_TARGETS),["Inicio","Carrera","Play","My Coach","Reglas"]);
  const page=readFileSync("app/page.tsx","utf8");assert.match(page,/onNotifications=\{\(\) => setTab\("notifications"\)\}/);
  assert.match(page,/<RoundParticipationCard|<NotificationCenter/);assert.match(readFileSync("app/components/notification-center.tsx","utf8"),/RoundParticipationCard key=\{detail.id\} roundId=\{detail.id\}/);
});
