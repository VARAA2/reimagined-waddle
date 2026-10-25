'use strict';
const {Api,utils}=require('teleproto'),{createHash}=require('node:crypto');
// Keep one weekly Live scheduled in the configured group without a human approval step.
// The time is always the NEXT configured weekday + India time; the title is built from that date.
// Idempotent: the same Live already scheduled is reported, any other Live is left untouched.
const IST=19800000,need=(ok,code)=>{if(!ok)throw Error('NNA_WEEKLY_LIVE_'+code);};
function weeklyConfig(p){
 need(/^-100[1-9]\d{0,12}$/.test(p.weeklyLiveGroupId||''),'GROUP_INVALID');
 need(Number.isInteger(p.weeklyLiveWeekday)&&p.weeklyLiveWeekday>=0&&p.weeklyLiveWeekday<=6,'WEEKDAY_INVALID');
 const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(p.weeklyLiveTimeIst||'');need(m,'TIME_INVALID');
 const t=String(p.weeklyLiveTitleTemplate||'');need(t===t.trim()&&t.length>0&&!/[\u0000-\u001f\u007f]/.test(t),'TITLE_INVALID');
 return {groupId:p.weeklyLiveGroupId,weekday:p.weeklyLiveWeekday,minute:Number(m[1])*60+Number(m[2]),template:t};
}
// Next weekday/time in India strictly more than 10 minutes from now (so it is always schedulable).
function nextLive(cfg,now){
 const ist=new Date(now+IST),day=Date.UTC(ist.getUTCFullYear(),ist.getUTCMonth(),ist.getUTCDate());
 for(let k=0;k<=7;k++){
  const at=day+k*86400000+cfg.minute*60000-IST;
  if(new Date(day+k*86400000).getUTCDay()===cfg.weekday&&at>now+600000){
   const d=new Date(at+IST),pad=n=>String(n).padStart(2,'0');
   const title=cfg.template.replace(/\{DD\}/g,pad(d.getUTCDate())).replace(/\{MM\}/g,pad(d.getUTCMonth()+1)).replace(/\{YY\}/g,pad(d.getUTCFullYear()%100)).replace(/\{YYYY\}/g,String(d.getUTCFullYear()));
   need(title.length<=128,'TITLE_INVALID');return {liveAt:at/1000,title,istDate:d.toISOString().slice(0,16).replace('T',' ')};
  }
 }
 throw Error('NNA_WEEKLY_LIVE_TIME_INVALID');
}
async function scheduleWeeklyLive(client,c,p,bounded,now=Date.now()){
 const cfg=weeklyConfig(p);need(cfg.groupId===c.allowedGroupId,'GROUP_NOT_ALLOWED');
 const want=nextLive(cfg,now);
 const g=await bounded(client.getEntity(c.allowedGroupUsername));
 need(g?.className==='Channel'&&g.megagroup&&!g.left&&!g.kicked&&String(utils.getPeerId(g))===cfg.groupId,'GROUP_UNAVAILABLE');
 const peer=await bounded(client.getInputEntity(g));
 need(g.creator===true||g.adminRights?.manageCall===true,'ADMIN_REQUIRED');
 const info={senderId:String(c.expectedUserId),groupId:cfg.groupId,title:want.title,liveAt:want.liveAt,istDate:want.istDate,autoStart:false};
 const full=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));
 if(full.fullChat?.call){
  const call=(await bounded(client.invoke(new Api.phone.GetGroupCall({call:full.fullChat.call,limit:1})))).call;
  if(call?.className==='GroupCall'&&call.scheduleDate===want.liveAt&&call.title===want.title)return {status:'already_scheduled',...info,callId:String(call.id)};
  // Another Live (running now, or scheduled by hand) is never changed; a later run tries again.
  return {status:call?.scheduleDate?'other_live_scheduled':'live_running',...info,existingTitle:call?.title||'',existingLiveAt:call?.scheduleDate||0};
 }
 const randomId=createHash('sha256').update(`nna-weekly-live-v1\0${c.expectedUserId}\0${cfg.groupId}\0${want.liveAt}`).digest().readInt32BE(0)||1;
 let result;
 try{result=await bounded(client.invoke(new Api.phone.CreateGroupCall({peer,title:want.title,scheduleDate:want.liveAt,randomId,rtmpStream:false})));}
 catch(err){if(['CHAT_ADMIN_REQUIRED','RIGHT_FORBIDDEN'].includes(err.errorMessage))throw Error('NNA_WEEKLY_LIVE_ADMIN_REQUIRED');throw Error('NNA_WEEKLY_LIVE_UNCONFIRMED');}
 try{
  const created=result.updates?.map(x=>x.call).find(x=>x?.className==='GroupCall');
  const after=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));
  const call=(await bounded(client.invoke(new Api.phone.GetGroupCall({call:after.fullChat.call,limit:1})))).call;
  need(call?.className==='GroupCall'&&(!created||String(call.id)===String(created.id))&&call.title===want.title&&call.scheduleDate===want.liveAt&&!call.rtmpStream,'UNCONFIRMED');
  return {status:'live_scheduled',...info,callId:String(call.id)};
 }catch{throw Error('NNA_WEEKLY_LIVE_UNCONFIRMED');}
}
module.exports={weeklyConfig,nextLive,scheduleWeeklyLive};
