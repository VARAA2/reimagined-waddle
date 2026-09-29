'use strict';
const {jobKey}=require('./store');
const check=(ok,code)=>{if(!ok)throw Error('MEDIA_'+code);};
const names=['start','menu','topicorder','analyze','cancel','help'];
function validate(scope){
 const ids=scope.adminCommandGroupIds;
 check(ids===undefined||(Array.isArray(ids)&&ids.length<=20&&ids.every(id=>typeof id==='string'&&/^-100[1-9]\d+$/.test(id)&&Number.isSafeInteger(Number(id)))&&new Set(ids).size===ids.length),'ADMIN_COMMAND_GROUPS');
}
function command(text,username){
 const m=/^\/(start|menu|topicorder|analyze|analysis|cancel|help)(?:@([a-z0-9_]+))?(?:\s+(.*))?$/i.exec((text||'').trim());
 if(!m||(m[2]&&m[2].toLowerCase()!==username.toLowerCase()))return null;
 return {name:m[1].toLowerCase()==='analysis'?'analyze':m[1].toLowerCase(),argument:m[3]||''};
}
function install(Service){
 const handle=Service.prototype.handle,configure=Service.prototype.configureCommands;
 Service.prototype.configureCommands=async function(){
  const result=await configure.call(this),commands=result.commands;
  const desired=this.scope.adminCommandGroupIds||[],previous=this.store.read('admin_command_scopes')?.groups||[];
  for(const id of desired){
   const scope={type:'chat_administrators',chat_id:id};
   const before=await this.bot('getMyCommands',{scope});
   const next=[...before.filter(c=>!names.includes(c.command)),...commands];
   check(next.length<=100,'TOO_MANY_COMMANDS');
   await this.bot('setMyCommands',{scope,commands:next});
   const actual=await this.bot('getMyCommands',{scope});
   check(JSON.stringify(actual)===JSON.stringify(next),'COMMANDS_UNCONFIRMED');
   this.store.change('admin_command_scopes',old=>({groups:[...new Set([...(old?.groups||[]),id])]}));
  }
  for(const id of previous.filter(id=>!desired.includes(id))){
   const scope={type:'chat_administrators',chat_id:id};
   const before=await this.bot('getMyCommands',{scope}),next=before.filter(c=>!names.includes(c.command));
   if(next.length)await this.bot('setMyCommands',{scope,commands:next});else await this.bot('deleteMyCommands',{scope});
  }
  this.store.change('admin_command_scopes',()=>({groups:desired}));
  return {...result,adminCommandGroupIds:desired};
 };
 Service.prototype.launchGroupCommand=async function(u,name){
  const m=u?.message,chat=m?.chat,ignored=status=>({json:{next:0,status}});
  if(!m||chat?.type!=='supergroup'||!(this.scope.adminCommandGroupIds||[]).includes(String(chat.id)))return ignored('ignored_group');
   const actor=m.from,now=Date.now()/1000;
   if(!Number.isSafeInteger(u.update_id)||u.update_id<0||!Number.isSafeInteger(m.message_id)||m.message_id<=0||!actor||actor.is_bot||m.sender_chat||m.forward_origin||m.forward_date||m.edit_date||!Number.isFinite(m.date)||now-m.date>86400||m.date>now+30)return ignored('invalid_group_command');
   if(!this.scope.operatorIds.includes(String(actor.id)))return ignored('operator_required');
   const member=await this.bot('getChatMember',{chat_id:chat.id,user_id:actor.id});
   if(!['creator','administrator'].includes(member.status)||String(member.user?.id)!==String(actor.id))return ignored('admin_required');
   const key='groupcmd_'+jobKey(this.me.id,chat.id,m.message_id);let claimed=false;
   this.store.change(key,old=>{if(old)return undefined;claimed=true;return {status:'sending',createdAt:Date.now()};});
   if(!claimed)return ignored('duplicate_group_command');
   try{
    const sent=await this.bot('sendMessage',{chat_id:chat.id,...(m.is_topic_message&&Number.isSafeInteger(m.message_thread_id)&&m.message_thread_id>0?{message_thread_id:m.message_thread_id}:{}),reply_parameters:{message_id:m.message_id},text:'இந்த வசதியை @'+this.scope.botUsername+' தனிப்பட்ட chat-ல் திறக்க கீழே அழுத்துங்கள்.',reply_markup:{inline_keyboard:[[{text:'↗️ /'+name,url:'https://t.me/'+this.scope.botUsername+'?start='+name}]]}});
    this.store.change(key,x=>({...x,status:'sent',messageId:sent.message_id}));
    return ignored('group_menu');
   }catch(e){this.store.change(key,x=>({...x,status:'uncertain'}));throw e;}
 };
 Service.prototype.handle=async function(u){
  const m=u?.message,chat=m?.chat||u?.callback_query?.message?.chat;
  if(chat?.type!=='private'&&!this.replyContext){
   const ignored=status=>({json:{next:0,status}});
   if(!m||chat?.type!=='supergroup'||!(this.scope.adminCommandGroupIds||[]).includes(String(chat.id)))return ignored('ignored_group');
   const c=command(m.text,this.scope.botUsername);if(!c||c.argument)return ignored('ignored_group');
   return this.launchGroupCommand(u,c.name);
  }
  if(m){
   const c=command(m.text,this.scope.botUsername);
   if(/^\/[a-z]+@/i.test(m.text||'')&&!c)return {json:{next:0,status:'other_bot_command'}};
   if(c){
    let target=c.name;
    if(target==='start'&&names.includes(c.argument))target=c.argument;
    if(!c.argument||c.name==='start')u={...u,message:{...m,text:'/'+target,entities:[]}};
   }
  }
  return handle.call(this,u);
 };
}
module.exports={validate,command,install};
