'use strict';
const {Api,utils}=require('teleproto');
const bigInt=require('big-integer');
const {createHash}=require('node:crypto');
const check=(ok,code)=>{if(!ok)throw Error('NNA_EXPORT_'+code);};
const positive=x=>/^[1-9]\d{0,15}$/.test(String(x))&&Number.isSafeInteger(Number(x));
const clean=x=>String(x||'').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function config(c,p){
 const s=p.scope;check(s&&s.sourceGroupId===c.allowedGroupId,'GROUP_NOT_ALLOWED');
 check(Array.isArray(s.topicIds)&&s.topicIds.length>0&&s.topicIds.length<=10&&s.topicIds.every(x=>Number.isSafeInteger(x)&&x>0)&&new Set(s.topicIds).size===s.topicIds.length,'TOPICS_INVALID');
 check(Array.isArray(s.operatorIds)&&s.operatorIds.length>0&&s.operatorIds.every(positive),'OPERATORS_INVALID');
 check(/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s.botUsername||''),'BOT_INVALID');return s;
}
function parseQuery(text,botUsername){
 if(typeof text!=='string')return null;
 const raw=text.trim(),command=/^\/userhistory(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(raw)||/^\/history(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(raw);
 if(command&&command[1]&&command[1].toLowerCase()!==botUsername.toLowerCase())return null;
 const value=command?(command[2]||'').trim():raw;
 const valid=positive(value)||/^@?[A-Za-z][A-Za-z0-9_]{2,31}$/.test(value);
 if(!command&&!(/^[1-9]\d{4,15}$/.test(value)||/^@[A-Za-z][A-Za-z0-9_]{2,31}$/.test(value)))return null;
 if(!valid)return {kind:'help',query:''};
 return {kind:'export',query:/^[1-9]\d*$/.test(value)?value:'@'+value.replace(/^@/,'')};
}
function request(c,p,now=Date.now()){
 const s=config(c,p),u=p.update,m=u?.message,a=m?.from;
 check(Number.isSafeInteger(u?.update_id)&&u.update_id>=0&&!u.edited_message&&!u.callback_query,'UPDATE_INVALID');
 check(a?.is_bot===false&&s.operatorIds.includes(String(a.id))&&m.chat?.type==='private'&&m.chat.id===a.id&&!m.sender_chat,'PRIVATE_OPERATOR_REQUIRED');
 check(!m.forward_origin&&!m.forward_date&&!m.edit_date,'FRESH_COMMAND_REQUIRED');
 check(Number.isSafeInteger(m.date)&&now-m.date*1000<=86400000&&m.date*1000<=now+30000,'STALE_COMMAND');
 const q=parseQuery(m.text,s.botUsername);check(q?.kind==='export','QUERY_INVALID');
 return {...q,operatorId:String(a.id),requestKey:'user-history:'+a.id+':'+u.update_id};
}
function mediaKind(m){
 const media=m.media;if(!media||media.className==='MessageMediaEmpty')return '';
 if(media.className==='MessageMediaPhoto')return 'Image';
 if(media.className==='MessageMediaDocument'){
  const d=media.document,attrs=d?.attributes||[],mime=String(d?.mimeType||'').toLowerCase();
  if(attrs.some(a=>a.className==='DocumentAttributeAudio'&&a.voice))return 'Voice message';
  if(attrs.some(a=>a.className==='DocumentAttributeAudio')||mime.startsWith('audio/'))return 'Audio';
  if(attrs.some(a=>a.className==='DocumentAttributeVideo')||mime.startsWith('video/'))return 'Video';
  if(mime==='application/pdf'||attrs.some(a=>a.className==='DocumentAttributeFilename'&&/\.pdf$/i.test(a.fileName)))return 'PDF';
  if(attrs.some(a=>a.className==='DocumentAttributeSticker'))return 'Sticker';
  if(mime.startsWith('image/'))return 'Image';return 'File';
 }
 return {MessageMediaWebPage:'Web link',MessageMediaPoll:'Poll',MessageMediaContact:'Contact',MessageMediaGeo:'Location',MessageMediaGeoLive:'Live location',MessageMediaVenue:'Location',MessageMediaDice:'Dice'}[media.className]||'Media';
}
function stamp(seconds){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(seconds*1000))+' IST';}
const valueText=x=>typeof x==='string'?x:typeof x?.text==='string'?x.text:'';
function formatRecord(m,topic,groupId){
 const url='https://t.me/c/'+groupId.slice(4)+'/'+topic.id+'/'+m.id;
 const kind=mediaKind(m),lines=['Date: '+stamp(Number(m.date)),'Topic: '+clean(topic.title),'Message ID: '+m.id];
 if(m.editDate)lines.push('Last edited: '+stamp(Number(m.editDate)));
 if(m.fwdFrom)lines.push('Forwarded message shared by this user');
 const replyId=Number(m.replyTo?.replyToMsgId||0);if(replyId>0&&replyId!==topic.id)lines.push('Reply to: https://t.me/c/'+groupId.slice(4)+'/'+topic.id+'/'+replyId);
 if(m.groupedId)lines.push('Album ID: '+String(m.groupedId));
 lines.push('');if(m.message)lines.push(m.message);
 if(kind==='Poll'){
  const poll=m.media.poll;lines.push('Poll: '+valueText(poll?.question));
  for(const a of poll?.answers||[])lines.push('- '+valueText(a.text));
 }
 const linked=[...new Set((m.entities||[]).filter(e=>e.className==='MessageEntityTextUrl'&&e.url).map(e=>e.url))];
 if(linked.length)lines.push('Embedded links:',...linked);
 if(kind)lines.push(kind+': '+url+(m.groupedId?'?single':''));
 else lines.push('Message: '+url);
 return lines.join('\n');
}
async function run(client,c,p,bounded,options={}){
 const started=options.now??Date.now(),s=config(c,p),req=request(c,p,started),pause=options.sleep||sleep;
 let waited=0,pages=0;
 const rpc=async make=>{
  for(;;){
   check(Date.now()-(options.clockStart??started)<2700000,'TIME_LIMIT');
   try{return await bounded(client.invoke(make()),30000);}catch(e){
    const flood=/^FLOOD(?:_PREMIUM)?_WAIT(?:_\d+)?$/.test(e.errorMessage||'');
    const seconds=Number(e.seconds);if(!flood||!Number.isSafeInteger(seconds)||seconds<1)throw e;
    check(seconds<=300&&waited+seconds<=900,'RATE_LIMIT');waited+=seconds;await pause((seconds+1)*1000);
   }
  }
 };
 const group=await bounded(client.getEntity(c.allowedGroupUsername));
 check(group?.className==='Channel'&&group.megagroup===true&&group.forum===true&&String(utils.getPeerId(group))===c.allowedGroupId,'GROUP_MISMATCH');
 const peer=await bounded(client.getInputEntity(group));
 const tr=await rpc(()=>new Api.messages.GetForumTopicsByID({peer,topics:s.topicIds}));
 const topics=s.topicIds.map(id=>tr.topics?.find(t=>t.id===id&&t.className==='ForumTopic'));check(topics.every(Boolean),'TOPIC_UNAVAILABLE');
 let targetId=req.query,targetName='',username='',searchPeer=null;
 if(req.query.startsWith('@')){
  let user;try{user=await bounded(client.getEntity(req.query));}catch{throw Error('NNA_EXPORT_USERNAME_UNRESOLVED');}
  check(user?.className==='User'&&positive(user.id),'USERNAME_NOT_USER');targetId=String(user.id);targetName=clean([user.firstName,user.lastName].filter(Boolean).join(' '));username=clean(user.username);
  searchPeer=await bounded(client.getInputEntity(user));
 }
 if(targetId===String(c.expectedUserId))searchPeer=new Api.InputPeerSelf();
 if(!searchPeer){
  try{
   const participant=await rpc(()=>new Api.channels.GetParticipant({channel:peer,participant:new Api.InputPeerUser({userId:bigInt(targetId),accessHash:bigInt.zero})}));
   const user=participant.users?.find(u=>String(u.id)===targetId&&u.className==='User'&&!u.min&&u.accessHash);
   if(user){searchPeer=await bounded(client.getInputEntity(user));targetName=clean([user.firstName,user.lastName].filter(Boolean).join(' '));username=clean(user.username);}
  }catch(e){if(/^NNA_EXPORT_(?:RATE_LIMIT|TIME_LIMIT)$/.test(e.message))throw e;}
 }
 if(searchPeer)check(searchPeer.className==='InputPeerSelf'&&targetId===String(c.expectedUserId)||searchPeer.className==='InputPeerUser'&&String(searchPeer.userId)===targetId&&Boolean(searchPeer.accessHash),'SENDER_UNRESOLVED');
 const latest=await rpc(()=>new Api.messages.GetHistory({peer,offsetId:0,offsetDate:0,addOffset:0,limit:1,maxId:0,minId:0,hash:bigInt.zero}));
 check(Array.isArray(latest.messages),'RESPONSE_INVALID');
 const snapshotMaxId=latest.messages.reduce((a,m)=>Math.max(a,Number(m.id)||0),0);check(Number.isSafeInteger(snapshotMaxId)&&snapshotMaxId>0&&snapshotMaxId<2147483647,'SNAPSHOT_INVALID');
 const records=[],seen=new Set(),counts=[],scanned=[];let size=0;
 for(const topic of topics){
  let cursor=0,total=0,topicCount=0;
  for(;;){
   const response=await rpc(()=>searchPeer?new Api.messages.Search({peer,q:'',fromId:searchPeer,topMsgId:topic.id,filter:new Api.InputMessagesFilterEmpty(),minDate:0,maxDate:0,offsetId:cursor,addOffset:0,limit:100,maxId:snapshotMaxId+1,minId:0,hash:bigInt.zero}):new Api.messages.GetReplies({peer,msgId:topic.id,offsetId:cursor,offsetDate:0,addOffset:0,limit:100,maxId:snapshotMaxId+1,minId:0,hash:bigInt.zero}));
   check(Array.isArray(response.messages),'RESPONSE_INVALID');pages++;
   const user=(response.users||[]).find(x=>String(x.id)===targetId);
   if(user){targetName=targetName||clean([user.firstName,user.lastName].filter(Boolean).join(' '));username=username||clean(user.username);}
   if(response.messages.length===0)break;
   let oldest=cursor||Infinity;
   for(const m of response.messages){
    check(Number.isSafeInteger(m.id)&&m.id>0,'MESSAGE_ID_INVALID');
    if(cursor&&m.id>=cursor)continue;
    oldest=Math.min(oldest,m.id);if(m.id>snapshotMaxId)continue;
    if(!['Message','MessageService'].includes(m.className))continue;
    check(String(utils.getPeerId(m.peerId))===s.sourceGroupId,'RESPONSE_GROUP_MISMATCH');
    if(m.className!=='Message')continue;
    const top=Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId||0);
    check(m.replyTo==null||(m.replyTo.forumTopic===true&&top===topic.id)||m.id===topic.id,'RESPONSE_TOPIC_MISMATCH');
    total++;
    if(searchPeer)check(m.fromId?.className==='PeerUser'&&String(m.fromId.userId)===targetId,'SENDER_FILTER_MISMATCH');
    if(m.fromId?.className!=='PeerUser'||String(m.fromId.userId)!==targetId||seen.has(m.id))continue;
    check(Number.isSafeInteger(Number(m.date))&&Number(m.date)>0,'DATE_INVALID');
    const text=formatRecord(m,topic,s.sourceGroupId);size+=Buffer.byteLength(text,'utf8')+80;check(size<44000000,'FILE_TOO_LARGE');
    records.push({id:m.id,date:Number(m.date),text});seen.add(m.id);topicCount++;
   }
   check(Number.isFinite(oldest)&&(!cursor||oldest<cursor),'CURSOR_STALLED');cursor=oldest;
   await pause(250);
  }
  counts.push({topicId:topic.id,title:clean(topic.title),count:topicCount});scanned.push({topicId:topic.id,count:total,complete:true});
 }
 records.sort((a,b)=>a.date-b.date||a.id-b.id);
 const completed=options.completedAt??Date.now();
 const header=['TELEGRAM USER CHAT HISTORY','Name: '+(targetName||'Unknown'),'User ID: '+targetId,'Username: '+(username?'@'+username:'-'),'Group: '+clean(group.title||c.allowedGroupUsername),'Exported: '+stamp(Math.floor(completed/1000)),'Snapshot taken: '+stamp(Math.floor(started/1000)),'Total messages: '+records.length,...counts.map(t=>t.title+': '+t.count),'','Coverage: All accessible current messages by this user in the listed topics, through message ID '+snapshotMaxId+'.','Each topic was read to its end. Deleted/hidden messages, previous edits, and anonymous/channel posts not attributed to this user cannot be recovered.','Images, videos, audio, voice messages, PDFs and other attachments are represented by their original Telegram message links. Media was not downloaded.',''].join('\n');
 const fileText='\uFEFF'+header+records.map((r,i)=>'\n'+ '='.repeat(64)+'\nRecord '+(i+1)+'\n'+r.text+'\n').join('');
 const bytes=Buffer.from(fileText,'utf8');check(bytes.length<45000000,'FILE_TOO_LARGE');
 const fileName='telegram_history_'+targetId+'_'+new Date(completed).toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z')+'.txt';
 return {status:'complete',complete:true,retrievalMethod:searchPeer?'sender_search':'topic_scan',requestKey:req.requestKey,recipientId:req.operatorId,targetUserId:targetId,name:targetName,username,totalMessages:records.length,topics:counts,scanned,pages,snapshotMaxId,fileName,fileBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),fileText};
}
module.exports={config,parseQuery,request,mediaKind,formatRecord,run};
