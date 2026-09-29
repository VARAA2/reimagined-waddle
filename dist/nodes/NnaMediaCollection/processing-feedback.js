'use strict';
// Cosmetic feedback is optional, separate from the report and always uses the bot identity.
// Persist identifiers only; never persist transport credentials, message contents or AI input.
const active=new Map();
const INDEX='processing_feedback';
const id=x=>typeof x==='string'&&/^[1-9]\d{0,19}$/.test(x);
function validate(scope){
 const f=scope.processingFeedback;if(f===undefined)return;
 const emoji=e=>e&&id(e.customEmojiId)&&typeof e.emoji==='string'&&e.emoji.length>0&&e.emoji.length<=16;
 if(!f||typeof f.enabled!=='boolean'||!emoji(f.indicator)||f.indicatorFallback!==undefined&&!emoji(f.indicatorFallback)||!emoji(f.reaction)||f.reaction.fallbackEmoji!==undefined&&f.reaction.fallbackEmoji!=='👀'||!Number.isInteger(f.delayMs)||f.delayMs<1000||f.delayMs>10000||!Number.isInteger(f.timeoutMs)||f.timeoutMs<60000||f.timeoutMs>900000)throw Error('MEDIA_FEEDBACK_CONFIG');
}
function environment(s){
 const store=s.baseStore||s.store;
 return {store,bot:(s.transportBot||s.bot.bind(s)),config:s.scope.processingFeedback,now:s.deps.feedbackClock?.now||Date.now,setTimeout:s.deps.feedbackClock?.setTimeout||setTimeout,clearTimeout:s.deps.feedbackClock?.clearTimeout||clearTimeout};
}
const token=(key,rev)=>key+'_'+rev;
const registryKey=(e,k)=>e.store.root+':'+k;
const read=(e,k)=>e.store.read(INDEX)?.jobs?.[k];
function save(e,k,change){e.store.change(INDEX,x=>{const jobs={...(x?.jobs||{})},next=change(jobs[k]);if(next===undefined)return undefined;if(next===null)delete jobs[k];else jobs[k]=next;return {jobs};});return read(e,k);}
function runner(e,k){
 const rk=registryKey(e,k);let r=active.get(rk);
 if(!r){r={e,k,rk,queue:Promise.resolve(),timer:null,paused:false};active.set(rk,r);}return r;
}
function serial(r,fn){const result=r.queue.then(fn);r.queue=result.catch(()=>{});return result;}
function schedule(r,delay){
 if(r.paused)return;if(r.timer)r.e.clearTimeout(r.timer);
 r.timer=r.e.setTimeout(()=>{r.timer=null;return serial(r,()=>tick(r)).catch(()=>{if(!r.paused)schedule(r,5000);});},Math.max(1,delay));r.timer?.unref?.();
}
async function request(r,method,payload){try{return await r.e.bot(method,payload,4000);}catch{return null;}}
function threadBody(j){return {chat_id:j.chatId,...(j.topicId>1?{message_thread_id:j.topicId}:{}),reply_parameters:{message_id:j.sourceMessageId,allow_sending_without_reply:false},disable_notification:true};}
async function reaction(r,j,emoji){
 if(!j.commandMessageId)return false;
 // Custom reactions can be unavailable in private chats or restricted groups. No personal-account fallback.
 const payload={chat_id:j.chatId,message_id:j.commandMessageId,reaction:[{type:'custom_emoji',custom_emoji_id:emoji.customEmojiId}],is_big:true};
 try{return !!await r.e.bot('setMessageReaction',payload,4000);}catch(error){
  if(emoji?.fallbackEmoji&&(error.customEmojiRejected||error.reactionRejected))return !!await request(r,'setMessageReaction',{...payload,reaction:[{type:'emoji',emoji:emoji.fallbackEmoji}]});
  return false;
 }
}
async function removeIndicator(r,j){
 if(!j.indicatorMessageId)return j;
 const removed=await request(r,'deleteMessage',{chat_id:j.chatId,message_id:j.indicatorMessageId});
 return removed?save(r.e,r.k,x=>x?{...x,indicatorMessageId:null}:undefined):read(r.e,r.k);
}
async function showIndicator(r,j){
 const primary=j.config.indicator,fallback=j.config.indicatorFallback;
 const body=emoji=>({...threadBody(j),text:emoji.emoji,entities:[{type:'custom_emoji',offset:0,length:emoji.emoji.length,custom_emoji_id:emoji.customEmojiId}]});
 let sent;
 try{sent=await r.e.bot('sendMessage',body(primary),4000);}catch(error){
  // Retry only an explicit unsupported-emoji response; network ambiguity must not duplicate messages.
  if(error.customEmojiRejected&&fallback)sent=await request(r,'sendMessage',body(fallback));
 }
 if(!sent?.message_id)return read(r.e,r.k);
 j=save(r.e,r.k,x=>x?{...x,indicatorMessageId:sent.message_id}:undefined);
 if(fallback&&!sent.entities?.some(e=>e.type==='custom_emoji')){
  // Some Telegram deployments strip unsupported entities instead of rejecting them. Reuse the same message.
  const b=body(fallback);await request(r,'editMessageText',{chat_id:j.chatId,message_id:sent.message_id,text:b.text,entities:b.entities});
 }
 return j;
}
async function terminate(r,outcome){
 r.paused=true;if(r.timer)r.e.clearTimeout(r.timer);r.timer=null;
 let j=read(r.e,r.k);if(!j)return;
 if(j.state==='terminal'&&j.outcome===outcome){r.paused=false;await tick(r);return;}
 j=save(r.e,r.k,x=>x?{...x,state:'terminal',outcome,completedAt:r.e.now()}:undefined);
 j=await removeIndicator(r,j);
 // Leave the single eyes reaction untouched. Completion only removes the temporary indicator.
 if(j.indicatorMessageId){r.paused=false;schedule(r,5000);}
 else{save(r.e,r.k,()=>null);active.delete(r.rk);}
}
async function tick(r){
 if(r.paused)return;
 let j=read(r.e,r.k);if(!j){active.delete(r.rk);return;}
 if(j.state==='terminal'){
  j=await removeIndicator(r,j);
  if(!j.indicatorMessageId){save(r.e,r.k,()=>null);active.delete(r.rk);return;}
  if(r.e.now()-j.completedAt>60000){active.delete(r.rk);return;}
  schedule(r,5000);return;
 }
 const draft=r.e.store.read(j.key);
 if(!draft||draft.status!=='analysing'||draft.rev!==j.revision){await terminate(r,draft?.status==='cancelled'?'cancelled':'failure');return;}
 if(r.e.now()>=j.expiresAt){await terminate(r,'failure');return;}
 if(r.e.now()<j.showAt){schedule(r,j.showAt-r.e.now());return;}
 if(!j.indicatorAttempted){
  j=save(r.e,r.k,x=>({...x,indicatorAttempted:true}));
  j=await showIndicator(r,j);
 }
 if(r.paused)return;
 if(!j.reactionAttempted){
  j=save(r.e,r.k,x=>x?{...x,reactionAttempted:true}:undefined);
  await reaction(r,j,j.config.reaction);
 }
 if(j)schedule(r,Math.min(30000,j.expiresAt-r.e.now()));
}
async function start(s,d){
 const e=environment(s),f=e.config;if(!f?.enabled)return;
 const k=token(d.key,d.rev);if(read(e,k))return;
 const chatId=d.replyContext?.chatId||String(d.owner),topicId=d.replyContext?.topicId||0;
 save(e,k,()=>({key:d.key,revision:d.rev,chatId,topicId,sourceMessageId:d.sourceMessageId,commandMessageId:d.analysisConsent.commandMessageId,showAt:e.now()+f.delayMs,expiresAt:e.now()+f.timeoutMs,config:f,state:'running'}));
 schedule(runner(e,k),f.delayMs);
}
async function pause(s,key,rev){
 const e=environment(s),k=token(key,rev);if(!read(e,k))return;
 const r=runner(e,k);r.paused=true;if(r.timer)e.clearTimeout(r.timer);r.timer=null;await r.queue;
}
async function complete(s,key,rev,outcome){
 const e=environment(s),k=token(key,rev);if(!read(e,k))return;
 const r=runner(e,k);r.paused=true;if(r.timer)e.clearTimeout(r.timer);r.timer=null;
 await serial(r,()=>terminate(r,outcome));
}
function recover(s){
 const e=environment(s);for(const [k,j] of Object.entries(e.store.read(INDEX)?.jobs||{})){
  if(active.has(registryKey(e,k)))continue;
  if(!/^[a-f0-9]{20}_\d+$/.test(k)||!j?.config||!s.scope.operatorIds.includes(j.chatId)&&!(s.scope.adminCommandGroupIds||[]).includes(j.chatId))continue;
  schedule(runner(e,k),Math.max(1,Math.min(1000,j.showAt-e.now())));
 }
}
function install(Service){
 const original=Service.prototype.finish;
 Service.prototype.finish=async function(key,revision,raw){
  await pause(this,key,revision).catch(()=>{});
  try{
   const result=await original.call(this,key,revision,raw);
   await complete(this,key,revision,result.status==='analysis_ready'?'success':['stale_analysis','group_admin_revoked'].includes(result.status)?'cancelled':'failure').catch(()=>{});
   return result;
  }catch(error){await complete(this,key,revision,'failure').catch(()=>{});throw error;}
 };
}
module.exports={validate,start,pause,complete,recover,install};
