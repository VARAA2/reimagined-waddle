'use strict';
const {Api,utils}=require('teleproto'),bigInt=require('big-integer');
// Read-only snapshot of who is currently inside the group's Live (video chat). The personal
// account never joins the call and nothing is written to Telegram. One snapshot per poll;
// the workflow accumulates snapshots into attendance rows.
const need=(ok,code)=>{if(!ok)throw Error('NNA_ATTENDANCE_'+code);};
const PAGE=100,MAX_PAGES=50;
function attendanceConfig(c,p){
 need(/^-100[1-9]\d{0,12}$/.test(p.liveAttendanceGroupId||''),'CONFIG_INVALID');
 const extra=p.liveAttendanceReviewGroupId||'';
 need(extra===''||/^-100[1-9]\d{0,12}$/.test(extra),'CONFIG_INVALID');
 need(p.liveAttendanceGroupId===c.allowedGroupId||(extra!==''&&p.liveAttendanceGroupId===extra),'GROUP_NOT_ALLOWED');
 return {groupId:p.liveAttendanceGroupId};
}

// Accepts forum groups, ordinary groups and broadcast channels the account belongs to.
async function attendancePeer(client,groupId,bounded){
 let g;
 try{g=await bounded(client.getEntity(bigInt(groupId)));}
 catch{g=(await bounded(client.getDialogs({limit:500}))).map(x=>x.entity).find(x=>x?.className==='Channel'&&String(utils.getPeerId(x))===groupId);}
 need(g?.className==='Channel'&&!g.left&&!g.kicked&&String(utils.getPeerId(g))===groupId,'GROUP_UNAVAILABLE');
 return {peer:await bounded(client.getInputEntity(g)),channel:g.broadcast===true};
}
const iso=s=>Number.isSafeInteger(s)&&s>0?new Date(s*1000).toISOString():null;
function username(u){return u.username||u.usernames?.find(x=>x.active)?.username||'';}
async function readParticipants(client,call,bounded){
 const rows=[];let offset='',count=0,pages=0,users=new Map();
 for(;pages<MAX_PAGES;pages++){
  const r=await bounded(client.invoke(new Api.phone.GetGroupParticipants({call,ids:[],sources:[],offset,limit:PAGE})));
  for(const u of r.users||[])users.set(String(u.id),u);
  rows.push(...(r.participants||[]));count=r.count;
  if(!r.nextOffset||!(r.participants||[]).length)break;offset=r.nextOffset;
 }
 return {rows,users,count,truncated:pages>=MAX_PAGES};
}
async function pollLiveAttendance(client,c,p,bounded,now=Date.now()){
 const cfg=attendanceConfig(c,p),{peer,channel}=await attendancePeer(client,cfg.groupId,bounded);
 const full=await bounded(client.invoke(new Api.channels.GetFullChannel({channel:peer})));
 const base={groupId:cfg.groupId,channel,polledAt:new Date(now).toISOString(),senderId:String(c.expectedUserId)};
 const inputCall=full.fullChat?.call;
 if(!inputCall)return {...base,status:'no_call',participants:[],anonymousCount:0};
 let info;
 try{info=(await bounded(client.invoke(new Api.phone.GetGroupCall({call:inputCall,limit:1})))).call;}
 catch(e){if(e.errorMessage==='GROUPCALL_INVALID'||e.errorMessage==='GROUPCALL_FORBIDDEN')return {...base,status:'no_call',participants:[],anonymousCount:0};throw Error('NNA_ATTENDANCE_READ_FAILED');}
 if(info?.className!=='GroupCall')return {...base,status:'no_call',participants:[],anonymousCount:0};
 const meta={callId:String(info.id),title:info.title||'',rtmpStream:info.rtmpStream===true,listenersHidden:info.listenersHidden===true,participantsCount:info.participantsCount??0};
 if(info.scheduleDate&&info.scheduleDate*1000>now)return {...base,...meta,status:'scheduled',scheduleDate:info.scheduleDate,participants:[],anonymousCount:0};
 if(info.rtmpStream===true)return {...base,...meta,status:'rtmp_unsupported',participants:[],anonymousCount:0};
 let read;
 try{read=await readParticipants(client,inputCall,bounded);}
 catch(e){
  // When Telegram hides the listeners the list request may be refused; the counters still work, so keep the count.
  if(meta.listenersHidden)read={rows:[],users:new Map(),count:meta.participantsCount,truncated:false};
  else throw Error('NNA_ATTENDANCE_READ_FAILED');
 }
 const seen=new Set(),participants=[];let anonymousCount=0;
 for(const row of read.rows){
  if(row.left===true)continue;
  if(row.peer?.className!=='PeerUser'){anonymousCount++;continue;}
  const userId=String(row.peer.userId);if(seen.has(userId))continue;seen.add(userId);
  const u=read.users.get(userId);
  participants.push({userId,username:u?username(u):'',firstName:u?.firstName||'',lastName:u?.lastName||'',deleted:u?.deleted===true,accessHash:u&&!u.min&&u.accessHash?String(u.accessHash):'',bot:u?.bot===true,self:row.self===true,muted:row.muted===true,canSelfUnmute:row.canSelfUnmute===true,joinedAt:iso(row.date),activeAt:iso(row.activeDate)});
 }
 return {...base,...meta,status:'active',participants,anonymousCount,listedCount:read.rows.length,truncated:read.truncated};
}
async function runAttendance(operation,client,c,p,bounded,now=Date.now()){
 need(operation==='pollLiveAttendance','OPERATION');
 return pollLiveAttendance(client,c,p,bounded,now);
}
module.exports={attendanceConfig,attendancePeer,pollLiveAttendance,runAttendance};
