'use strict';
const {utils}=require('teleproto');
const {attendancePeer}=require('./live-attendance');
// Read-only: returns the text and formatting of specific messages in the exact template format used for
// welcome / departure messages (including Premium custom emoji ids), so a template can be copied from a message
// the owner wrote instead of being retyped. Nothing is written to Telegram.
const need=(ok,code)=>{if(!ok)throw Error('NNA_TEMPLATE_'+code);};
const id=v=>String(v??'');
const KEEP=new Set(['MessageEntityBold','MessageEntityItalic','MessageEntityUnderline','MessageEntityStrike','MessageEntitySpoiler','MessageEntityCode','MessageEntityPre','MessageEntityBlockquote','MessageEntityHashtag','MessageEntityMention','MessageEntityUrl','MessageEntityTextUrl','MessageEntityEmail','MessageEntityCustomEmoji']);
function templateConfig(c,p){
 need(/^-100[1-9]\d{0,12}$/.test(p.templateGroupId||''),'CONFIG_INVALID');
 const extra=p.membershipExtraChannelId||'';
 need(extra===''||/^-100[1-9]\d{0,12}$/.test(extra),'CONFIG_INVALID');
 need(p.templateGroupId===c.allowedGroupId||(extra!==''&&p.templateGroupId===extra),'GROUP_NOT_ALLOWED');
 let ids;try{ids=typeof p.templateMessageIds==='string'?JSON.parse(p.templateMessageIds):p.templateMessageIds;}catch{ids=null;}
 need(Array.isArray(ids)&&ids.length>=1&&ids.length<=8&&ids.every(x=>Number.isSafeInteger(x)&&x>0),'IDS_INVALID');
 return {groupId:p.templateGroupId,ids};
}
function convert(e){
 const type=e.className,o={type,offset:e.offset,length:e.length};
 if(type==='MessageEntityCustomEmoji')o.documentId=id(e.documentId);
 if(type==='MessageEntityTextUrl')o.url=e.url;
 if(type==='MessageEntityPre')o.language=e.language||'';
 if(type==='MessageEntityBlockquote'&&e.collapsed)o.collapsed=true;
 return o;
}
function mediaKind(m){
 const t=m.media?.className;if(!t||t==='MessageMediaEmpty'||t==='MessageMediaWebPage')return 'text';
 if(t==='MessageMediaPhoto')return 'photo';
 if(t==='MessageMediaDocument'){
  const a=m.media.document?.attributes||[];
  if(a.some(x=>x.className==='DocumentAttributeCustomEmoji'))return 'custom_emoji_sticker';
  if(a.some(x=>x.className==='DocumentAttributeSticker'))return 'sticker';
  return 'document';
 }
 return 'other';
}
async function readTemplates(client,c,p,bounded){
 const cfg=templateConfig(c,p),{peer}=await attendancePeer(client,cfg.groupId,bounded);
 const list=await bounded(client.getMessages(peer,{ids:cfg.ids}));
 const messages=[];
 for(const [i,messageId] of cfg.ids.entries()){
  const m=list[i];
  if(!m||m.className!=='Message'||id(utils.getPeerId(m.peerId))!==cfg.groupId){messages.push({messageId,found:false});continue;}
  const all=m.entities||[],kept=all.filter(e=>KEEP.has(e.className)).map(convert);
  const dropped=[...new Set(all.filter(e=>!KEEP.has(e.className)).map(e=>e.className))];
  const text=m.message||'';
  const topicId=Number(m.replyTo?.replyToTopId||(m.replyTo?.forumTopic?m.replyTo.replyToMsgId:0))||0;
  messages.push({messageId,found:true,topicId,kind:mediaKind(m),text,length:text.length,entities:kept,customEmojiIds:[...new Set(kept.filter(e=>e.type==='MessageEntityCustomEmoji').map(e=>e.documentId))],droppedEntityTypes:dropped,edited:Boolean(m.editDate)});
 }
 return {status:'ok',groupId:cfg.groupId,count:messages.length,messages};
}
async function runTemplates(operation,client,c,p,bounded){
 need(operation==='readMessageTemplate','OPERATION');
 return readTemplates(client,c,p,bounded);
}
module.exports={templateConfig,convert,readTemplates,runTemplates};
