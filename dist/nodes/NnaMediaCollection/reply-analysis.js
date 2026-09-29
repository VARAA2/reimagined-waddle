'use strict';
const {jobKey}=require('./store');
const LABEL='🔎 Image / Video Report',CANCEL='❌ Media Report ரத்து';
function install(Service,authenticate,parseMedia){
 const tell=Service.prototype.tell;
 Service.prototype.tell=function(owner,text,extra){return tell.call(this,owner,this.scope.analysisCommand==='mediareport'?text.replace(/\/analyze\b/g,'/mediareport'):text,extra);};
 Service.prototype.configureAnalysisCommands=async function(){
  const commands=[{command:'mediareport',description:'Image / Video சுருக்கம் + Hashtags'},{command:'cancelmedia',description:'Media Report-ஐ ரத்து செய்'}];
  for(const scope of [{type:'all_private_chats'},...(this.scope.adminCommandGroupIds||[]).map(chat_id=>({type:'chat_administrators',chat_id}))]){
   const old=await this.bot('getMyCommands',{scope}),next=[...old.filter(c=>!commands.some(n=>n.command===c.command)),...commands];
   if(next.length>100)throw Error('MEDIA_TOO_MANY_COMMANDS');
   await this.bot('setMyCommands',{scope,commands:next});
   if(JSON.stringify(await this.bot('getMyCommands',{scope}))!==JSON.stringify(next))throw Error('MEDIA_COMMANDS_UNCONFIRMED');
  }
  return {status:'analysis_commands_configured',commands,adminCommandGroupIds:this.scope.adminCommandGroupIds||[]};
 };
 Service.prototype.handleAnalysis=async function(u){
  const pass=()=>({json:{next:0,analysisHandled:false,event:u}}),done=status=>({json:{next:0,analysisHandled:true,status}});
  const m=u?.message,cb=u?.callback_query,chat=m?.chat||cb?.message?.chat;
  let text=(m?.text||'').trim();
  const match=/^\/(mediareport|cancelmedia)(?:@([a-z0-9_]+))?$/i.exec(text);
  let cmd=match&&(!match[2]||match[2].toLowerCase()===this.scope.botUsername.toLowerCase())?match[1].toLowerCase():null;
  if((chat?.type==='private'||this.replyContext)){
   if(text===LABEL||new RegExp('^/start(?:@'+this.scope.botUsername+')? mediareport$','i').test(text))cmd='mediareport';
   if(text===CANCEL||new RegExp('^/start(?:@'+this.scope.botUsername+')? cancelmedia$','i').test(text))cmd='cancelmedia';
  }
  if(chat?.type!=='private'&&!this.replyContext){
   if(!cmd)return pass();
   const result=await this.launchGroupCommand(u,cmd);
   return {...result,json:{...result.json,analysisHandled:true}};
  }
  // Only our analysis callbacks are intercepted; poll/template callbacks continue unchanged.
  if(cb){
   const key=/^mc:([a-f0-9]{20}):\d+:off$/.exec(cb.data||'')?.[1];
   if(!key||!this.store.read(key)?.analysisOnly)return pass();
   const result=await this.handle(u);return {...result,json:{...result.json,analysisHandled:true}};
  }
  if(!m||!this.scope.operatorIds.includes(String(m.from?.id)))return pass();
  const modeKey='report_mode_'+m.from.id,mode=this.store.read(modeKey);
  const media=!!(m.photo||m.video||m.document);
  if(!cmd&&media&&mode?.consumedBy===this.jobKey(m.from.id,'report:'+m.message_id+':'+m.message_id))return done('duplicate_report');
  if(!cmd&&!(mode?.armed&&mode.expiresAt>Date.now()&&media)){
   if(mode?.armed&&(text.startsWith('/')||text==='🏠 Main Menu')){authenticate(u,this.scope,this.me.id);this.store.change(modeKey,x=>({...x,armed:false}));}
   return pass();
  }
  const {owner}=authenticate(u,this.scope,this.me.id);
  if(m.forward_origin||m.forward_date){await this.tell(owner,'புதிய command அல்லது நீங்கள் அனுப்பிய media-க்கு Reply செய்து /mediareport பயன்படுத்துங்கள்.');return done('fresh_report_required');}
  if(cmd==='cancelmedia'){
   this.store.change(modeKey,x=>({...x,armed:false}));
   const current=this.store.read('report_active_'+owner),d=current&&this.store.read(current.key);
   if(d?.owner===owner&&d.analysisOnly&&d.status==='analysing'){this.store.change(d.key,x=>({...x,status:'cancelled',rev:x.rev+1,analysisConsent:null}));this.releaseAnalysis(d.key,d.rev);await require('./processing-feedback').complete(this,d.key,d.rev,'cancelled').catch(()=>{});}
   await this.tell(owner,'❌ Media Report ரத்து செய்யப்பட்டது. /menu மூலம் முக்கிய menu-க்கு திரும்பலாம்.');return done('report_cancelled');
  }
  if(cmd==='mediareport'&&!m.reply_to_message){
   let fresh=false;this.store.change(modeKey,x=>{if(x?.updateId>=u.update_id)return undefined;fresh=true;return {armed:true,updateId:u.update_id,expiresAt:Date.now()+15*60000};});
   if(!fresh)return done('duplicate_report');
   await this.tell(owner,'🔎 Image / Video Report\n\nஅடுத்து ஒரு image அல்லது video அனுப்புங்கள். English summary + hashtags தனித்தனியாக copy செய்யும் format-ல் கிடைக்கும்.\n\nஏற்கெனவே அனுப்பிய media-க்கு Reply செய்து /mediareport கொடுக்கலாம்.\nரத்து செய்ய: /cancelmedia',{reply_markup:{keyboard:[[{text:CANCEL}],[{text:'🏠 Main Menu'}]],resize_keyboard:true,is_persistent:false,one_time_keyboard:false}});
   return done('report_armed');
  }
  const ref=cmd?m.reply_to_message:m;
  let asset;try{
   if(!this.replyContext&&(String(ref.from?.id)!==owner||ref.from?.is_bot))throw Error('MEDIA_REPLY_MEDIA_OWNER');
   asset=parseMedia({...ref,media_group_id:undefined});
  }catch{await this.tell(owner,'நீங்கள் இந்த bot-க்கு அனுப்பிய image அல்லது video-க்கு Reply செய்து /mediareport கொடுங்கள்.');return done('report_media_required');}
  const key=this.jobKey(owner,'report:'+ref.message_id+':'+m.message_id);let created=false,claim=false;
  if(!cmd){
   const active=this.store.change(modeKey,x=>{if(!x?.armed||x.expiresAt<=Date.now())return undefined;claim=true;return {...x,armed:false,consumedBy:key};});
   if(!claim)return active?.consumedBy===key?done('duplicate_report'):pass();
  }
  const draft=this.store.change(key,x=>{if(x)return undefined;created=true;return {key,owner,rev:1,status:'pending',analysisOnly:true,createdAt:Date.now(),...asset,analysisApproved:false,analysisConsent:null,tags:[],summaryLines:[]};});
  if(!created)return done('duplicate_report');
  this.store.change('report_active_'+owner,()=>({key}));
  const result=await this.startAnalysis(draft,{owner,updateId:u.update_id,commandMessageId:m.message_id});
  return {...result,json:{...result.json,analysisHandled:true}};
 };
}
module.exports={install,LABEL,CANCEL};
