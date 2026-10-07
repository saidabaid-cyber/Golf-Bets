import assert from "node:assert/strict";
import test from "node:test";
import * as presentation from "../features/notifications/presentation";
import { socialUI,uiNodes,settleUI } from "./helpers/social-ui";
const id="11111111-1111-4111-8111-111111111111",person="22222222-2222-4222-8222-222222222222";
for(const [type,expected]of [["friend_request",{kind:"player",id:person}],["scorecard_ready",{kind:"round",id,source:"shared"}],["like",{kind:"activity",id}]] as const)test(`notification ${type} opens its authorized object without an inline expansion`,async()=>{
  const opened:any[]=[],reload=async()=>{},props={viewerId:"viewer",accessToken:"qa",onBack(){},onPreferences(){},onFriend(){throw Error("Unexpected legacy destination");}};
  const h=socialUI("app/components/notification-center.tsx",{"golf-object-navigation":{useGolfNavigation:()=>({open:(o:any)=>opened.push(o)})},"presentation":presentation,"client":{NOTIFICATIONS_CHANGED:"backyard:notifications-changed",notificationsChanged(){}},"group-invitations":{useGroupInvitationInbox:()=>({reload,loadedAt:1,invitations:[],message:"",busy:false})},"social-activity-client":{socialErrorMessage:String,socialRequest:async(path:string)=>path.includes("notification-preferences")?{enabled:true,data:[]}:{data:[{id:"33333333-3333-4333-8333-333333333333",type,activityId:id,createdAt:"2026-10-05T12:00:00Z",readAt:"2026-10-05T12:01:00Z",person:{userId:person,displayName:"QA",username:"qa",avatarUrl:null}}],nextCursor:null}}},{setInterval:()=>1,clearInterval(){}});
  h.render("NotificationCenter",props);await settleUI();const tree=h.render("NotificationCenter",props);const row=uiNodes(tree).find(n=>typeof n.type==="function"&&n.type.name==="NotificationRow");assert.ok(row);row.props.onOpen();await settleUI();assert.deepEqual(JSON.parse(JSON.stringify(opened)),[expected]);h.unmount();
});
