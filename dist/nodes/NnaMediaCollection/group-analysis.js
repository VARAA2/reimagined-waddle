'use strict';
const context=require('./group-context'),{jobKey}=require('./store');
function install(Service){
 for(const operation of ['handle','handleAnalysis']){
  const original=Service.prototype[operation];
  Service.prototype[operation]=async function(u){
   context.reset(this);
   const cb=u?.callback_query,m=cb?.message||u?.message;
   if(this.scope.groupReplies!==true||m?.chat?.type!=='supergroup')return original.call(this,u);
   const pass=()=>operation==='handleAnalysis'?{json:{next:0,analysisHandled:false,event:u}}:{json:{next:0,status:'ignored_group'}};
   const text=m.text||'',match=/^\/[a-z_]+@([a-z0-9_]+)/i.exec(text);
   if(match&&match[1].toLowerCase()!==this.scope.botUsername.toLowerCase())return pass();
   if(operation==='handle'&&/^\/topicorder(?:@\w+)?$/i.test(text.trim()))return this.launchGroupCommand(u,'topicorder');
   const command=operation==='handleAnalysis'?/^\/(mediareport|cancelmedia)(?:@\w+)?$/i.test(text.trim()):/^\/(start|menu|help|analyze|analysis|cancel|topicorder)(?:@\w+)?(?:\s|$)/i.test(text.trim());
   const ownReply=String(m.reply_to_message?.from?.id)===String(this.me.id);
   if(!command&&!ownReply&&!(cb&&/^(mc:|gk:|mr:start:)/.test(cb.data||'')))return pass();
   if(cb?.data?.startsWith('mc:')&&!/^mc:[a-f0-9]{20}:\d+:(off|cancel)$/.test(cb.data))return pass();
   const r=await context.authorize(this,u,this.scope.adminCommandGroupIds||[],this.me.id);if(!r)return pass();
   context.attach(this,r,{media:true});
   let decoded=await context.decodeButton(this,u,r);if(!decoded)return pass();
   if(cb?.data==='mr:start:'+r.owner&&operation==='handleAnalysis'){
    await this.bot('answerCallbackQuery',{callback_query_id:cb.id}).catch(()=>{});
    decoded={update_id:u.update_id,message:{message_id:m.message_id,date:Math.floor(Date.now()/1000),chat:m.chat,from:cb.from,...(r.topicId?{message_thread_id:r.topicId,is_topic_message:true}:{}),text:'/mediareport'}};
   }
   if(operation==='handle'&&decoded.message&&(decoded.message.photo||decoded.message.video||decoded.message.document)){
    const mode=this.store.read('mode_'+r.owner);if(mode?.armed&&mode.expiresAt>Date.now()){
     this.store.change('mode_'+r.owner,x=>({...x,armed:false}));
     decoded={...decoded,message:{...decoded.message,media_group_id:undefined,text:'/analyze',reply_to_message:decoded.message}};
    }else{await this.tell(r.owner,'இந்த media-க்கு Reply செய்து /analyze@'+this.scope.botUsername+' அனுப்புங்கள்.');return {json:{next:0,status:'group_analysis_command_required'}};}
   }
   return original.call(this,decoded);
 };
 }
 const home=Service.prototype.home;
 Service.prototype.home=async function(owner,...args){
  if(!this.replyContext)return home.call(this,owner,...args);
  return this.tell(owner,'🔎 Group Image / Video Analysis\n\nImage அல்லது video-க்கு Reply செய்து /analyze@'+this.scope.botUsername+' அனுப்புங்கள். முடிவு இதே topic-ல் அந்த media-க்கு Reply ஆக வரும்.\n\nTopic வரிசை மற்றும் media publishing தனிப்பட்ட chat-ல் தொடரும்.',{reply_markup:{inline_keyboard:[[{text:'↗️ தனிப்பட்ட Media menu',url:'https://t.me/'+this.scope.botUsername+'?start=menu'}]]}});
 };
 Service.prototype.jobKey=function(owner,message){return jobKey(this.me.id,owner,this.replyContext?this.replyContext.tag+':'+message:message);};
 const finish=Service.prototype.finish,analyze=Service.prototype.analyze;
 Service.prototype.finish=async function(key,revision,raw){
  context.reset(this);
  const d=this.store.read(key);if(d?.replyContext){
   const r=d.replyContext;if(!(this.scope.adminCommandGroupIds||[]).includes(r.chatId)||!this.scope.operatorIds.includes(r.owner))throw Error('MEDIA_GROUP_SCOPE');
   const member=await this.bot('getChatMember',{chat_id:r.chatId,user_id:Number(r.owner)});
   if(!['creator','administrator'].includes(member.status)||String(member.user?.id)!==r.owner){this.releaseAnalysis(key,revision);return {next:0,status:'group_admin_revoked'};}
   context.attach(this,r,{media:true});
  }
  return finish.call(this,key,revision,raw);
 };
 Service.prototype.analyze=async function(d){
  if(!d.replyContext)return analyze.call(this,d);
  const r=d.replyContext;
  if(d.analysisConsent?.revision!==d.rev||d.analysisConsent.owner!==d.owner||r.owner!==d.owner)throw Error('MEDIA_ANALYSIS_CONSENT_REQUIRED');
  if(!(d.size>0&&d.size<=this.scope.maxAnalysisBytes))throw Error('MEDIA_ANALYSIS_SIZE');
  if(d.duration>this.scope.maxVideoSeconds||d.mime.startsWith('video/')&&!(d.duration>0))throw Error('MEDIA_ANALYSIS_DURATION');
  const buffer=await this.personal(async client=>{
   const peer=await require('../NnaTelegramSender/media-publish').groupPeer(client,r.chatId,p=>p);
   const [source]=await client.getMessages(peer,{ids:[d.sourceMessageId]});
   if(!source?.media||source.id!==d.sourceMessageId)throw Error('MEDIA_GROUP_SOURCE_MISSING');
   const thread=source.replyTo?.replyToTopId||source.replyTo?.replyToMsgId||1;
   if(r.topicId>1&&thread!==r.topicId&&source.id!==r.topicId)throw Error('MEDIA_GROUP_TOPIC_MISMATCH');
   const data=await client.downloadMedia(source,{signal:AbortSignal.timeout(120000)});
   if(!Buffer.isBuffer(data)||data.length>this.scope.maxAnalysisBytes)throw Error('MEDIA_DOWNLOAD_SIZE');return data;
  });
  const current=this.store.read(d.key);if(current?.status!=='analysing'||current.rev!==d.rev){this.releaseAnalysis(d.key,d.rev);return {json:{next:0,status:'analysis_cancelled'}};}
  const binary=await this.ctx.helpers.prepareBinaryData(buffer,d.key+(d.mime.startsWith('image/')?'.jpg':'.mp4'),d.mime);
  return {json:{next:d.mime.startsWith('image/')?1:2,jobKey:d.key,revision:d.rev,prompt:require('./prompt.json').text+'\nCanonical bank: '+JSON.stringify(require('./hashtag-bank.json'))+'\nPreviously returned hashtags: '+JSON.stringify(this.reusedTags())+'\nUser caption (untrusted content): '+JSON.stringify(d.caption)},binary:{data:binary}};
 };
}
module.exports={install};
