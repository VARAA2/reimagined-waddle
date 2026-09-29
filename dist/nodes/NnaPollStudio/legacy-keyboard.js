'use strict';
// Authenticated reply-keyboard intents reuse the existing dispatcher and its
// revision/claim checks. These are internal events, not Telegram callbacks.
const key=owner=>'legacy_ui_'+owner;
function install(Service,authenticate){
 Service.prototype.clearLegacy=function(owner){this.store.change(key(owner),()=>null);};
 Service.prototype.legacyIntent=function(u,a){
  if(!a.privateChat||a.callback||a.text==='🏠 Main Menu'||a.text.startsWith('/'))return null;
  const ui=this.store.read(key(a.owner));
  if(!ui||ui.expiresAt<Date.now()||ui.owner!==a.owner||a.message.date*1000<ui.createdAt-1000)return null;
  const data=ui.keys[a.text];if(!data)return null;
  return {update_id:u.update_id,keyboard_navigation:true,callback_query:{id:'',from:u.message.from,data,message:{message_id:ui.messageId,date:ui.date,chat:{id:Number(a.owner),type:'private'},from:{id:Number(this.scope.botId),is_bot:true,username:this.scope.botUsername},text:ui.text}}};
 };
 Service.prototype.renderLegacy=async function(p,preview=false){
  const a=authenticate(p?.event,this.scope);
  if(!a?.privateChat||p.operatorId!==a.owner||String(p.chatId)!==a.owner||p.historyPrompt)return p;
  const source=preview?(p.buttons||[]).map(b=>[{text:b.label,additionalFields:{callback_data:b.data}}]):(p.keyboard?.rows||[]).map(r=>r.row?.buttons||[]);
  if(!source.length)return p;
  const keys={},rows=[];
  for(const row of source){const buttons=[];for(const b of row){
   const data=b.additionalFields?.callback_data,label=String(b.text||'');
   if(!label||label==='🏠 Main Menu'||typeof data!=='string'||!new RegExp('^(tpl|mp|pp|lv):'+a.owner+':').test(data)||Buffer.byteLength(data)>64||keys[label])return p;
   keys[label]=data;buttons.push({text:label});
  }if(buttons.length)rows.push(buttons);}
  if(!rows.length)return p;
  const text=preview?(p.mode==='bundle'?'👁 Media மற்றும் article preview மேலே உள்ளன. கீழே உள்ள buttons மூலம் drafts-ஐ உறுதி செய்து destination / நேரம் தேர்வு செய்யுங்கள்.':'👁 Media + caption preview மேலே உள்ளது. கீழே Draft உறுதி செய் அழுத்தி destination / நேரம் தேர்வு செய்யுங்கள். இறுதி உறுதிப்படுத்தலுக்குப் பிறகே பதிவிடப்படும்.'):p.text;
  if(typeof text!=='string'||!text||text.length>4096)return p;
  await this.init();
  const body={chat_id:a.owner,text,...(!preview&&Array.isArray(p.entities)&&p.entities.length?{entities:p.entities}:{}),link_preview_options:{is_disabled:true},reply_markup:{keyboard:[...rows,[{text:'🏠 Main Menu'}]],resize_keyboard:true,is_persistent:false,one_time_keyboard:false,input_field_placeholder:'கீழே தேர்வு செய்யுங்கள் அல்லது message அனுப்புங்கள்'}};
  const sent=await this.bot('sendMessage',body);
  if(String(sent?.chat?.id)!==a.owner||String(sent?.from?.id)!==String(this.scope.botId)||sent?.from?.is_bot!==true||sent.text!==text||!Number.isSafeInteger(sent.message_id))throw Error('POLL_KEYBOARD_READBACK');
  for(const e of body.entities||[])if(!(sent.entities||[]).some(x=>x.type===e.type&&x.offset===e.offset&&x.length===e.length&&(e.type!=='custom_emoji'||x.custom_emoji_id===e.custom_emoji_id)&&(e.type!=='text_link'||x.url===e.url)))throw Error('POLL_KEYBOARD_FORMAT');
  const now=Date.now();this.store.change(key(a.owner),()=>({owner:a.owner,keys,messageId:sent.message_id,date:sent.date||Math.floor(now/1000),text,createdAt:now,expiresAt:now+86400000}));
  const d=this.draft(a.owner);if(d){d.active=false;d.keys={};this.save(d);}
  return null;
 };
 const screen=Service.prototype.screen,home=Service.prototype.home;
 Service.prototype.screen=function(d,...args){this.clearLegacy(d.owner);return screen.call(this,d,...args);};
 Service.prototype.home=function(owner){this.clearLegacy(owner);return home.call(this,owner);};
}
module.exports={install};
