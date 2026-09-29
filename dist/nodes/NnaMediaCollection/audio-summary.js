'use strict';
const contract=require('./audio-contract'),feedback=require('./processing-feedback'),context=require('./group-context');
const LABEL='🎙️ Audio Summary',CANCEL='❌ Audio Summary ரத்து';
const done=status=>({json:{next:0,audioHandled:true,status}});
function asset(m){
 const f=m?.voice||m?.audio;
 if(!f||m.video||m.video_note||typeof f.file_id!=='string')throw Error('NNA_AUDIO_REQUIRED');
 contract.limits(Number(f.file_size),Number(f.duration));
 return {fileId:f.file_id,size:Number(f.file_size),duration:Number(f.duration),mime:f.mime_type||(m.voice?'audio/ogg':'audio/mpeg'),sourceMessageId:m.message_id,sender:[m.from?.first_name,m.from?.last_name].filter(Boolean).join(' ')||m.sender_chat?.title||m.from?.username||'Unknown',senderId:String(m.from?.id||m.sender_chat?.id||''),sourceDate:m.date};
}
function errorText(e){return /_(SIZE|DURATION)$/.test(e.message)?'Audio அதிகபட்சம் 20 MB / 20 நிமிடங்கள் இருக்க வேண்டும். முழு பதிவையும் சுருக்க, நீளமான audio-வை பகுதிகளாக அனுப்புங்கள்.':e.message==='NNA_AUDIO_REQUIRED'?'Voice message அல்லது audio file அனுப்புங்கள். ஏற்கெனவே அனுப்பிய audio-க்கு Reply செய்து /audiosummary கொடுக்கலாம்.':'Audio-வை முழுமையாகப் புரிந்துகொள்ள முடியவில்லை. சிறிது நேரம் கழித்து அந்த audio-க்கு Reply செய்து /audiosummary மூலம் மீண்டும் முயற்சிக்கவும்.';}
function install(Service,authenticate){
 Service.prototype.configureAudioCommands=async function(){
  const add=[{command:'audiosummary',description:'Voice / audio-வின் தமிழ் சுருக்கம்'},{command:'cancelaudio',description:'Audio Summary-ஐ ரத்து செய்'}];
  for(const scope of [{type:'all_private_chats'},...(this.scope.adminCommandGroupIds||[]).map(chat_id=>({type:'chat_administrators',chat_id}))]){
   const old=await this.bot('getMyCommands',{scope});const commands=[...old.filter(c=>!add.some(n=>n.command===c.command)),...add];
   if(commands.length>100)throw Error('MEDIA_TOO_MANY_COMMANDS');await this.bot('setMyCommands',{scope,commands});
   if(JSON.stringify(await this.bot('getMyCommands',{scope}))!==JSON.stringify(commands))throw Error('MEDIA_COMMANDS_UNCONFIRMED');
  }return {status:'audio_commands_configured'};
 };
 Service.prototype.handleAudio=async function(u){
  context.reset(this);const m=u?.message,pass=()=>({json:{next:0,audioHandled:false,event:u}});
  if(!m||!this.scope.operatorIds.includes(String(m.from?.id))||m.from?.is_bot||u.edited_message)return pass();
  const text=(m.text||'').trim(),match=/^\/(audiosummary|cancelaudio)(?:@([a-z0-9_]+))?$/i.exec(text);
  if(match?.[2]&&match[2].toLowerCase()!==this.scope.botUsername.toLowerCase())return pass();
  let cmd=match?.[1]?.toLowerCase();if(m.chat?.type==='private'){if(text===LABEL)cmd='audiosummary';if(text===CANCEL)cmd='cancelaudio';}
  if(m.chat?.type==='supergroup'){
   if(!cmd)return pass();const r=await context.authorize(this,u,this.scope.adminCommandGroupIds||[],this.me.id);if(!r)return pass();context.attach(this,r,{media:true});
   if(cmd==='audiosummary'&&!m.reply_to_message){await this.tell(String(m.from.id),'Voice / audio பதிவுக்கு Reply செய்து /audiosummary@'+this.scope.botUsername+' அனுப்புங்கள்.');return done('audio_reply_required');}
  }else if(m.chat?.type!=='private')return pass();
  const owner=String(m.from.id),modeKey='audio_mode_'+owner,mode=this.store.read(modeKey),hasAudio=!!(m.voice||m.audio);
  if(!cmd&&!hasAudio){if(mode?.armed&&(text.startsWith('/')||text==='🏠 Main Menu'||text==='🔎 Image / Video Report')){authenticate(u,this.scope,this.me.id);this.store.change(modeKey,x=>({...x,armed:false}));}return pass();}
  // With plainAudioSummary:false, plain audio is summarised only after the Audio Summary button/command; otherwise it continues to posting.
  if(!cmd&&this.scope.plainAudioSummary===false&&!(mode?.armed&&(!mode.expiresAt||mode.expiresAt>Date.now())))return pass();
  authenticate(u,this.scope,this.me.id);
  if(cmd==='cancelaudio'){
   this.store.change(modeKey,x=>({...x,armed:false}));const active=this.store.read('audio_active_'+owner),d=active&&this.store.read(active.key);
   if(d?.audioOnly&&d.owner===owner&&d.status==='analysing'){this.store.change(d.key,x=>x.rev===d.rev?{...x,status:'cancelled',rev:x.rev+1}:undefined);await feedback.complete(this,d.key,d.rev,'cancelled').catch(()=>{});}
   await this.tell(owner,'Audio Summary ரத்து செய்யப்பட்டது. /menu மூலம் முக்கிய menu-க்கு திரும்பலாம்.');return done('audio_cancelled');
  }
  if(cmd==='audiosummary'&&!m.reply_to_message){
   let fresh=false;this.store.change(modeKey,x=>{if(x?.updateId>=u.update_id)return undefined;fresh=true;return {armed:true,updateId:u.update_id,expiresAt:Date.now()+15*60000};});if(!fresh)return done('duplicate_audio');
   this.store.change('report_mode_'+owner,x=>({...x,armed:false}));
   await this.tell(owner,'🎙️ Audio Summary\n\nVoice message அல்லது audio file அனுப்புங்கள். யார் அனுப்பியது, முக்கிய கருத்துகள், சுருக்கம் தமிழில் கிடைக்கும்.\n\nவரம்பு: 20 MB / 20 நிமிடங்கள். ஏற்கெனவே அனுப்பிய audio-க்கு Reply செய்து /audiosummary பயன்படுத்தலாம்.',{reply_markup:{keyboard:[[{text:CANCEL}],[{text:'🏠 Main Menu'}]],resize_keyboard:true,is_persistent:false,one_time_keyboard:false}});return done('audio_armed');
  }
  const ref=cmd?m.reply_to_message:m;let a;try{a=asset(ref);}catch(e){await this.tell(owner,errorText(e));return done('audio_invalid');}
  const key=this.jobKey(owner,'audio:'+ref.message_id+':'+m.message_id);let created=false;
  const d=this.store.change(key,x=>{if(x)return undefined;created=true;return {key,owner,rev:1,status:'analysing',audioOnly:true,createdAt:Date.now(),...a,analysisConsent:{commandMessageId:m.message_id,owner,revision:1}};});
  if(!created)return done('duplicate_audio');this.store.change(modeKey,x=>({...x,armed:false}));this.store.change('audio_active_'+owner,()=>({key}));
  try{
   await feedback.start(this,d).catch(()=>{});
   const file=await this.bot('getFile',{file_id:a.fileId});
   if(!file.file_path||!/^[a-zA-Z0-9_./-]+$/.test(file.file_path)||file.file_path.includes('..'))throw Error('NNA_AUDIO_DOWNLOAD');
   contract.limits(Number(file.file_size||a.size),a.duration);
   const bytes=await this.ctx.helpers.httpRequest({method:'GET',url:'https://api.telegram.org/file/bot'+this.b.accessToken+'/'+file.file_path,encoding:'arraybuffer',timeout:60000,json:false});
   const mime=contract.audioMime(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),a.mime);
   const current=this.store.read(key);if(current?.status!=='analysing'||current.rev!==d.rev)return done('audio_cancelled');
   const binary=await this.ctx.helpers.prepareBinaryData(Buffer.from(bytes),'audio.'+({'audio/mp3':'mp3','audio/ogg':'ogg','audio/mp4':'m4a','audio/wav':'wav','audio/flac':'flac','audio/aac':'aac','audio/webm':'webm'}[mime]),mime);
   return {json:{next:1,audioHandled:true,jobKey:key,revision:d.rev,prompt:contract.prompt},binary:{data:binary}};
  }catch(e){this.store.change(key,x=>x?.rev===d.rev&&x.status==='analysing'?{...x,status:'failed'}:undefined);await feedback.complete(this,key,d.rev,'failure').catch(()=>{});await this.tell(owner,errorText(e));return done('audio_failed');}
 };
 Service.prototype.finishAudio=async function(key,rev,raw){
  context.reset(this);const d=this.store.read(key);if(!d?.audioOnly||d.status!=='analysing'||d.rev!==rev)return {status:'stale_audio'};
  if(d.replyContext){const r=d.replyContext;if(!this.scope.operatorIds.includes(r.owner)||!(this.scope.adminCommandGroupIds||[]).includes(r.chatId))throw Error('MEDIA_GROUP_SCOPE');const member=await this.bot('getChatMember',{chat_id:r.chatId,user_id:Number(r.owner)});if(!['creator','administrator'].includes(member.status)){this.store.change(key,x=>({...x,status:'cancelled'}));await feedback.complete(this,key,rev,'cancelled').catch(()=>{});return {status:'group_admin_revoked'};}context.attach(this,r,{media:true});}
  let parsed;try{parsed=contract.parse(raw,d.duration);}catch(e){this.store.change(key,x=>x.rev===rev?{...x,status:'failed'}:undefined);await feedback.complete(this,key,rev,'failure').catch(()=>{});await this.tell(d.owner,errorText(e));return {status:'audio_failed'};}
  let claimed=false;this.store.change(key,x=>{if(x?.status!=='analysing'||x.rev!==rev)return undefined;claimed=true;return {...x,status:'sending'};});if(!claimed)return {status:'stale_audio'};
  try{
   const when=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(d.sourceDate*1000));
   const parts=['🎙️ Audio Summary','👤 அனுப்பியவர்: '+d.sender,'🕐 '+when+' IST','⏱️ '+Math.floor(d.duration/60)+':'+String(d.duration%60).padStart(2,'0'),'','📝 சுருக்கம்',parsed.summary_ta,'','📌 முக்கிய குறிப்புகள்',...parsed.key_points_ta.map(x=>'• '+x)];
   if(parsed.uncertainties_ta.length)parts.push('','🔎 தெளிவில்லாத பகுதிகள்',...parsed.uncertainties_ta.map(x=>'• '+x));
   if(d.replyContext)parts.push('','https://t.me/c/'+d.replyContext.chatId.slice(4)+'/'+(d.replyContext.topicId||1)+'/'+d.sourceMessageId);
   const text=parts.join('\n');for(let i=0;i<text.length;i+=3500)await this.tell(d.owner,text.slice(i,i+3500),{reply_parameters:{message_id:d.sourceMessageId,allow_sending_without_reply:false},link_preview_options:{is_disabled:true}});
   this.store.change(key,x=>({...x,status:'complete'}));return {status:'audio_ready'};
  }finally{await feedback.complete(this,key,rev,'complete').catch(()=>{});}
 };
}
module.exports={install,LABEL,CANCEL,asset,errorText};
