/** Email delivery never determines whether a durable support request succeeded. */
export async function notifyFeedbackSafely(send:()=>Promise<{messageId?:string;error?:string}>,record:(result:{messageId?:string;error?:string})=>Promise<void>) {
  let result:{messageId?:string;error?:string};
  try {result=await send();} catch {result={error:'PROVIDER_UNAVAILABLE'};}
  try {await record(result);} catch {console.warn('feedback_notification_record_failed');}
}
export async function receiveFeedback<T extends {id:string;status:string}>(operations:{persist:()=>Promise<T>;attach:(saved:T)=>Promise<void>;scheduleNotification:()=>void}) {
  const saved=await operations.persist();
  try {await operations.attach(saved);} catch {return {...saved,received:true,attachmentPending:true};}
  try {operations.scheduleNotification();} catch {console.warn('feedback_notification_schedule_failed');}
  return {...saved,received:true,attachmentPending:false};
}
