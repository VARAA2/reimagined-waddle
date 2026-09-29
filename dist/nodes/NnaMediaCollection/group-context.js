'use strict';
const crypto=require('node:crypto');
const CONTEXT=Symbol('verifiedGroupConversation');
const sid=x=>String(x??'');
const tag=r=>crypto.createHash('sha256').update([r.chatId,r.topicId,r.owner].join(':')).digest('hex').slice(0,16);
function matches(u,r,botId){const cb=u?.callback_query,m=cb?.message||u?.message,a=cb?.from||m?.from;return !!(r&&m?.chat?.type==='supergroup'&&sid(m.chat.id)===r.chatId&&sid(a?.id)===r.owner&&(m.message_thread_id||0)===r.topicId&&(!cb||m.from?.is_bot&&sid(m.from.id)===sid(botId)));}
async function authorize(service,u,groups,botId){
 const cb=u?.callback_query,m=cb?.message||u?.message,a=cb?.from||m?.from,now=Date.now()/1000;
 if(!Number.isSafeInteger(u?.update_id)||u.update_id<0||u.edited_message||m?.chat?.type!=='supergroup'||!groups.includes(sid(m.chat.id))||!service.scope.operatorIds.includes(sid(a?.id))||a.is_bot!==false||m.sender_chat||!Number.isSafeInteger(m.message_id)||m.message_id<=0)return null;
 if(cb){if(!m.from?.is_bot||sid(m.from.id)!==sid(botId))return null;}
 else if(m.edit_date||m.forward_origin||m.forward_date||!Number.isFinite(m.date)||now-m.date>86400||m.date>now+30)return null;
 if(m.message_thread_id!==undefined&&(!Number.isSafeInteger(m.message_thread_id)||m.message_thread_id<1))return null;
 const member=await service.bot('getChatMember',{chat_id:m.chat.id,user_id:a.id});
 if(!['creator','administrator'].includes(member.status)||sid(member.user?.id)!==sid(a.id))return null;
 const r={chatId:sid(m.chat.id),topicId:m.message_thread_id||0,owner:sid(a.id),replyId:m.photo||m.video||m.document?m.message_id:m.reply_to_message?.message_id||m.message_id};
 r.tag=tag(r);return r;
}
function scopedStore(base,r,media=false){
 const key=k=>/^(?:ui_|mode_|report_mode_|report_active_|audio_mode_|audio_active_|pending_|last_sent_|reply_|draft_|lease_|legacy_ui_)/.test(k)?'g'+r.tag+'_'+k:k;
 return {read:k=>base.read(key(k)),change:(k,fn)=>base.change(key(k),old=>{const next=fn(old);if(media&&next?.key&&next.owner===r.owner)return {...next,replyContext:next.replyContext||r};return next;}),root:base.root};
}
function attach(service,r,{media=false}={}){
 const base=service.baseStore||service.store;service.baseStore=base;service.replyContext=r;service.scope[CONTEXT]=r;
 service.store=scopedStore(base,r,media);
 if(service.transportBot)return;
 const raw=service.bot.bind(service);service.transportBot=raw;
 service.bot=async(method,body={})=>{
  const route=service.replyContext;
  if(!route||sid(body.chat_id)!==route.owner)return raw(method,body);
  let payload={...body,chat_id:route.chatId};
  if(typeof payload.text==='string'){
   payload.text=payload.text.replace('அடுத்து ஒரு image அல்லது video அனுப்புங்கள்.','இந்த bot message-க்கு Reply செய்து ஒரு image அல்லது video அனுப்புங்கள்.');
   payload.text=payload.text.replace('நீங்கள் இந்த bot-க்கு அனுப்பிய image அல்லது video-க்கு Reply','இந்த topic-ல் உள்ள image அல்லது video-க்கு Reply');
   payload.text=payload.text.replace('இனி நேரடியாக media அனுப்பினால் topic மட்டும் கேட்கப்படும்.','Media-க்கு Reply செய்து /analyze மூலம் மீண்டும் தொடங்கலாம்.');
  }
  if(/^send/.test(method)||method==='copyMessage'){
   if(route.topicId&&route.topicId!==1)payload.message_thread_id=route.topicId;
   const reply=Number(body.reply_parameters?.message_id||body.reply_to_message_id||route.replyId);
   delete payload.reply_to_message_id;delete payload.allow_sending_without_reply;
   payload.reply_parameters={message_id:reply,allow_sending_without_reply:false};
  }
  if(body.reply_markup?.keyboard){
   const token=crypto.randomBytes(8).toString('hex'),labels=[];
   payload.reply_markup={inline_keyboard:body.reply_markup.keyboard.map(row=>row.map(b=>{const text=typeof b==='string'?b:b.text,index=labels.push(text)-1;if(b.url)return {text,url:b.url};return {...(typeof b==='object'?b:{}),text,callback_data:text==='🔎 Image / Video Report'?'mr:start:'+route.owner:'gk:'+token+':'+index};}))};
   const sent=await raw(method,payload);
   base.change('gk_'+token,()=>({route,labels,messageId:sent.message_id,draftRevision:service.draft?.(route.owner)?.rev,expiresAt:Date.now()+86400000}));
   return sent;
  }
  if(body.reply_markup?.force_reply)payload.reply_markup={...body.reply_markup,selective:true};
  return raw(method,payload);
 };
}
async function decodeButton(service,u,r){
 const cb=u.callback_query,m=/^gk:([a-f0-9]{16}):(\d+)$/.exec(cb?.data||'');if(!m)return u;
 const state=service.baseStore.read('gk_'+m[1]);
 if(!state||state.route.tag!==r.tag||state.messageId!==cb.message.message_id||state.expiresAt<Date.now()||state.draftRevision&&state.draftRevision!==service.draft?.(r.owner)?.rev||typeof state.labels[Number(m[2])]!=='string')return null;
 await service.bot('answerCallbackQuery',{callback_query_id:cb.id}).catch(()=>{});
 return {update_id:u.update_id,message:{message_id:cb.message.message_id,date:Math.floor(Date.now()/1000),chat:cb.message.chat,...(r.topicId?{message_thread_id:r.topicId,is_topic_message:true}:{}),from:cb.from,text:state.labels[Number(m[2])]}};
}
function reset(service){delete service.scope[CONTEXT];service.replyContext=null;if(service.baseStore)service.store=service.baseStore;}
module.exports={CONTEXT,matches,authorize,attach,decodeButton,tag,reset};
