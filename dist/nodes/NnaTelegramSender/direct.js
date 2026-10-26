'use strict';
const { createHash } = require('node:crypto');
const bigInt = require('big-integer');
const { Api, utils } = require('teleproto');
function need(ok, code) { if (!ok) throw new Error(code); }
function operatorIds(value) {
 const ids=String(value??'').split(',').map(x=>x.trim()).filter(Boolean);
 need(ids.length>0&&ids.length<=20&&ids.every(x=>/^[1-9]\d{0,15}$/.test(x)&&Number.isSafeInteger(Number(x))), 'NNA_INVALID_OPERATORS');
 return [...new Set(ids.map(Number))];
}
function targetFromUrl(raw) {
 const match=/^https:\/\/(?:t\.me|telegram\.me)\/([A-Za-z0-9_\/]+)$/i.exec(raw);
 need(match&&!match[1].includes('//'),'NNA_INVALID_MESSAGE_URL');
 const p=match[1].split('/').filter(Boolean);let peer,parts;
 if(p[0]==='c'){need(/^[1-9]\d{0,12}$/.test(p[1]||''),'NNA_INVALID_MESSAGE_URL');peer='-100'+p[1];parts=p.slice(2);}
 else {need(/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(p[0]||''),'NNA_INVALID_MESSAGE_URL');peer=p[0];parts=p.slice(1);}
 need([1,2].includes(parts.length)&&parts.every(x=>/^[1-9]\d{0,9}$/.test(x)&&Number(x)<=2147483647),'NNA_MESSAGE_LINK_REQUIRED');
 return {peer,messageId:Number(parts.at(-1)),topicId:parts.length===2?Number(parts[0]):0,url:raw};
}
// A standalone line "ID:<number>" names a person to mention; a standalone "@" in the reply text is the place for the name.
// Without any ID line, every "@" names the author of the message being replied to.
const ID_LINE=/^ID\s*[:：]+\s*([1-9]\d{0,15})$/i;
// "@" alone, or "@ word": the one word after the space is a dummy (so Telegram does not treat "@word" as a username) and is replaced too.
const PLACEHOLDER=/(?<![A-Za-z0-9_@])@(?![A-Za-z0-9_@])(?:[ \t]+[\p{L}\p{M}\p{N}_]+)?/gu;
const slotsOf=text=>[...String(text).matchAll(PLACEHOLDER)];
function splitMentionIds(lines){
 const ids=[],rest=[];
 for(const l of lines){const m=ID_LINE.exec(l.trim());if(m)ids.push(m[1]);else rest.push(l);}
 return {ids,rest};
}
// Rich messages (Bot API message.rich_message.blocks) are re-sent as rich HTML, so bold, quotes, tables, lists and
// details stay as they were. Media blocks cannot be re-sent from a user account by URL, so they are refused before sending.
const escH=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function richPlain(t){
 if(t==null)return '';if(typeof t==='string')return t;if(Array.isArray(t))return t.map(richPlain).join('');
 if(t.type==='custom_emoji')return t.alternative_text||'';if(t.type==='mathematical_expression')return t.expression||'';
 if(t.type==='anchor')return '';if(t.type==='button')return richPlain(t.button?.text);
 return richPlain(t.text);
}
const RICH_INLINE={bold:'b',italic:'i',underline:'u',strikethrough:'s',spoiler:'tg-spoiler',subscript:'sub',superscript:'sup',marked:'mark',code:'code'};
function richInline(t){
 if(t==null)return '';if(typeof t==='string')return escH(t).replace(/\n/g,'<br>');if(Array.isArray(t))return t.map(richInline).join('');
 const inner=()=>richInline(t.text),tag=RICH_INLINE[t.type];
 if(tag)return `<${tag}>${inner()}</${tag}>`;
 switch(t.type){
  case 'url':return `<a href="${escH(t.url)}">${inner()}</a>`;
  case 'email_address':return `<a href="mailto:${escH(t.email_address)}">${inner()}</a>`;
  case 'phone_number':return `<a href="tel:${escH(t.phone_number)}">${inner()}</a>`;
  case 'text_mention':return Number.isSafeInteger(t.user?.id)?`<a href="tg://user?id=${t.user.id}">${inner()}</a>`:inner();
  case 'custom_emoji':return /^[1-9]\d{0,19}$/.test(t.custom_emoji_id||'')?`<tg-emoji emoji-id="${t.custom_emoji_id}">${escH(t.alternative_text||'🙂')}</tg-emoji>`:escH(t.alternative_text||'');
  case 'date_time':return Number.isSafeInteger(t.unix_time)?`<tg-time unix="${t.unix_time}"${t.date_time_format?` format="${escH(t.date_time_format)}"`:''}>${inner()}</tg-time>`:inner();
  case 'mathematical_expression':return `<tg-math>${escH(t.expression)}</tg-math>`;
  case 'anchor':return `<a name="${escH(t.name)}"></a>`;
  case 'anchor_link':return `<a href="#${escH(t.anchor_name)}">${inner()}</a>`;
  case 'reference':return `<tg-reference name="${escH(t.name)}">${inner()}</tg-reference>`;
  case 'reference_link':return `<a href="#${escH(t.reference_name)}">${inner()}</a>`;
  case 'button':return richInline(t.button?.text);
  default:return inner(); // mention, hashtag, cashtag, bot_command: Telegram detects these again from the text
 }
}
const RICH_MEDIA=['photo','video','animation','audio','voice_note','document','collage','slideshow'];
const richCite=c=>c==null||c===''?'':`<cite>${richInline(c)}</cite>`;
const richBlocks=bs=>(bs||[]).map(richBlock).join('');
// Paragraph-only content is joined with line breaks (quote boxes and list items look the same as in the original).
const richFlow=bs=>(bs||[]).every(b=>b?.type==='paragraph')?(bs||[]).map(b=>richInline(b.text)).join('<br>'):richBlocks(bs);
function richCell(c){
 const tag=c.is_header?'th':'td';
 const at=(c.colspan>1?` colspan="${c.colspan}"`:'')+(c.rowspan>1?` rowspan="${c.rowspan}"`:'')+(['left','center','right'].includes(c.align)?` align="${c.align}"`:'')+(['top','middle','bottom'].includes(c.valign)?` valign="${c.valign}"`:'');
 return `<${tag}${at}>${richInline(c.text)}</${tag}>`;
}
function richList(b){
 const items=b.items||[];
 const ordered=items.length>0&&items.every(i=>Number.isSafeInteger(i.value)||/^(?:\d{1,4}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,8})[.)]?$/.test(String(i.label||'').trim()));
 const li=items.map(i=>`<li${ordered&&Number.isSafeInteger(i.value)?` value="${i.value}"`:''}>${i.has_checkbox?`<input type="checkbox"${i.is_checked?' checked':''}>`:''}${richFlow(i.blocks)}</li>`).join('');
 return ordered?`<ol>${li}</ol>`:`<ul>${li}</ul>`;
}
function richBlock(b){
 need(b&&typeof b==='object'&&!RICH_MEDIA.includes(b.type),'NNA_RICH_MEDIA_NOT_SUPPORTED');
 switch(b.type){
  case 'paragraph':return `<p>${richInline(b.text)}</p>`;
  case 'heading':{const n=Math.min(6,Math.max(1,Number(b.size)||1));return `<h${n}>${richInline(b.text)}</h${n}>`;}
  case 'pre':return /^[\w+#-]{1,32}$/.test(b.language||'')?`<pre><code class="language-${b.language}">${escH(richPlain(b.text))}</code></pre>`:`<pre>${escH(richPlain(b.text))}</pre>`;
  case 'footer':return `<footer>${richInline(b.text)}</footer>`;
  case 'divider':return '<hr/>';
  case 'mathematical_expression':return `<tg-math-block>${escH(b.expression)}</tg-math-block>`;
  case 'anchor':return `<a name="${escH(b.name)}"></a>`;
  case 'list':return richList(b);
  case 'blockquote':return `<blockquote>${richFlow(b.blocks)}${richCite(b.credit)}</blockquote>`;
  case 'expandable_blockquote':return `<blockquote expandable>${richInline(b.text)}${richCite(b.credit)}</blockquote>`;
  case 'pullquote':return `<aside>${richInline(b.text)}${richCite(b.credit)}</aside>`;
  case 'table':{
   const cap=b.caption==null||b.caption===''?'':`<caption>${richInline(b.caption)}</caption>`;
   const rows=(b.cells||[]).map(r=>'<tr>'+(r||[]).filter(c=>c&&c.text!==undefined).map(richCell).join('')+'</tr>').join('');
   return `<table${b.is_bordered?' bordered':''}${b.is_striped?' striped':''}${b.is_compact?' compact':''}>${cap}${rows}</table>`;
  }
  case 'details':return `<details${b.is_open?' open':''}><summary>${richInline(b.summary)}</summary>${richBlocks(b.blocks)}</details>`;
  case 'map':{const l=b.location||{};need(Number.isFinite(l.latitude)&&Number.isFinite(l.longitude),'NNA_RICH_BLOCK_NOT_SUPPORTED');return `<tg-map lat="${l.latitude}" long="${l.longitude}" zoom="${Number(b.zoom)||14}"/>`;}
  case 'buttons':return ''; // buttons of another bot do not work in a personal message
  default:need(b.text!==undefined,'NNA_RICH_BLOCK_NOT_SUPPORTED');return `<p>${richInline(b.text)}</p>`;
 }
}
// Plain text of a block, for the delivery log and the claim check only.
function richBlockPlain(b){
 if(!b||typeof b!=='object')return '';
 if(b.type==='list')return (b.items||[]).map(i=>`${i.label||'•'} ${(i.blocks||[]).map(richBlockPlain).join('\n')}`).join('\n');
 if(b.type==='table')return (b.cells||[]).map(r=>(r||[]).map(c=>richPlain(c?.text)).join(' | ')).join('\n');
 if(b.type==='details')return [richPlain(b.summary),...(b.blocks||[]).map(richBlockPlain)].join('\n');
 if(b.type==='blockquote')return (b.blocks||[]).map(richBlockPlain).join('\n');
 if(b.type==='divider')return '──────────';
 if(b.type==='mathematical_expression')return b.expression||'';
 return richPlain(b.text);
}
const richText=rm=>(rm?.blocks||[]).map(richBlockPlain).join('\n');
// Part of a rich text: plain characters a..b, formatting kept (used to cut the link line out of a paragraph).
function richSub(t,a,b){
 let pos=0;
 const walk=x=>{
  if(x==null)return null;
  if(typeof x==='string'){const s=pos;pos+=x.length;const part=x.slice(Math.max(0,a-s),Math.max(0,Math.min(x.length,b-s)));return part||null;}
  if(Array.isArray(x)){const r=x.map(walk).filter(y=>y!=null);return r.length?r:null;}
  if(x.text===undefined||['custom_emoji','mathematical_expression','button'].includes(x.type)){const s=pos,n=richPlain(x).length;pos+=n;return s>=a&&s+n<=b&&s<b?x:null;}
  const inner=walk(x.text);return inner==null?null:{...x,text:inner};
 };
 return walk(t);
}
// Telegram often puts the link and the next line in one paragraph ("link\ntext"): give the link line its own paragraph.
function splitLinkLine(blocks,isLink){
 const out=[...blocks];
 const at=(i,first)=>{
  const b=out[i];if(b?.type!=='paragraph')return;
  const p=richPlain(b.text),cut=first?p.indexOf('\n'):p.lastIndexOf('\n');
  if(cut<0)return;
  const line=first?p.slice(0,cut):p.slice(cut+1);if(!isLink(line.trim()))return;
  const rest=first?richSub(b.text,cut+1,p.length):richSub(b.text,0,cut);
  const link={type:'paragraph',text:line.trim()},keep=rest==null||!richPlain(rest).trim()?[]:[{...b,text:rest}];
  out.splice(i,1,...(first?[link,...keep]:[...keep,link]));
 };
 at(0,true);if(out.length)at(out.length-1,false);
 return out;
}
// The target link is a line of its own at the very start or end, as in plain requests.
function richRequest(rm){
 const linkLine=s=>/^https:\/\/(?:t\.me|telegram\.me)\/\S+$/i.test(s);
 const plain=b=>b?.type==='paragraph'?richPlain(b.text).trim():null;
 let blocks=[...rm.blocks];
 while(blocks.length&&plain(blocks[0])==='')blocks.shift();while(blocks.length&&plain(blocks.at(-1))==='')blocks.pop();
 blocks=splitLinkLine(blocks,linkLine);
 while(blocks.length&&plain(blocks[0])==='')blocks.shift();while(blocks.length&&plain(blocks.at(-1))==='')blocks.pop();
 const isLink=s=>s!=null&&/^https:\/\/(?:t\.me|telegram\.me)\/\S+$/i.test(s);
 const first=isLink(plain(blocks[0])),last=blocks.length>1&&isLink(plain(blocks.at(-1)));
 need(first!==last,'NNA_PUT_ONE_TARGET_LINK_ON_FIRST_OR_LAST_LINE');
 const target=targetFromUrl(plain(first?blocks.shift():blocks.pop()));
 const body=blocks.map(richBlockPlain).join('\n').trim();
 const html=richBlocks(blocks);
 need(body.length>0&&html.length<=100000,'NNA_REPLY_TEXT_1_TO_4096_REQUIRED');
 return {target,body,html};
}
function parseDirectRequest(update, config, now=Date.now()) {
 const operators=operatorIds(config.allowedOperatorIds),m=update?.message;
 if(!m||update.edited_message||update.callback_query||!Number.isSafeInteger(update.update_id)||!operators.includes(m.from?.id)||m.from?.is_bot!==false||m.sender_chat)return null;
 const privateChat=m.chat?.type==='private'&&m.chat.id===m.from.id;
 const groupChat=m.chat?.type==='supergroup'&&String(m.chat.id)===String(config.reviewChatId)&&[2,3].includes(m.message_thread_id);
 if(!privateChat&&!groupChat)return null;
 const rich=typeof m.text!=='string'&&Array.isArray(m.rich_message?.blocks);
 if(!/(?:https:\/\/)?(?:t\.me|telegram\.me)\//i.test(rich?richText(m.rich_message):typeof m.text==='string'?m.text:''))return null;
 const base={operatorId:String(m.from.id),requestKey:`direct:${config.botId}:${m.chat.id}:${m.message_id}`,chatId:String(m.chat.id),topicId:groupChat?m.message_thread_id:0,incomingMessageId:m.message_id};
 try {
  need(!m.forward_origin&&!m.forward_date&&!m.forward_from&&!m.via_bot_id,'NNA_FORWARD_NOT_DIRECT_INSTRUCTION');
  need(Number.isSafeInteger(m.message_id)&&m.message_id>0&&Number.isSafeInteger(m.date)&&m.date*1000<=now+30000&&now-m.date*1000<=86400000,'NNA_STALE_DIRECT_REQUEST');
  if(rich){const r=richRequest(m.rich_message);return {...base,kind:'direct',rich:true,targetUrl:r.target.url,body:r.body,html:r.html,target:r.target,mentionIds:[],update};}
  // The target is a standalone first or last line. All remaining text stays literal.
  const split=splitMentionIds(m.text.replace(/\r\n/g,'\n').split('\n'));
  const lines=split.rest,mentionIds=split.ids;
  while(lines.length&&!lines[0].trim())lines.shift();while(lines.length&&!lines.at(-1).trim())lines.pop();
  const isLink=s=>/^https:\/\/(?:t\.me|telegram\.me)\/\S+$/i.test(s.trim());
  const first=isLink(lines[0]||''),last=lines.length>1&&isLink(lines.at(-1)||'');
  need(first!==last,'NNA_PUT_ONE_TARGET_LINK_ON_FIRST_OR_LAST_LINE');
  const target=targetFromUrl((first?lines.shift():lines.pop()).trim());
  const body=lines.join('\n').trim();
  const slots=slotsOf(body).length;
  // ID lines without any "@" place: the people are mentioned at the start of the reply.
  need(mentionIds.length===0||slots===0||mentionIds.length===slots,'NNA_MENTION_COUNT_MISMATCH');
  need(Math.max(slots,mentionIds.length)<=10,'NNA_MENTION_TOO_MANY');
  need(body.length>0&&body.length<=4096&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body),'NNA_REPLY_TEXT_1_TO_4096_REQUIRED');
  const singleEmoji=/^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0F\uFE0E]?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}[\uFE0F\uFE0E]?\p{Emoji_Modifier}?)*)$/u.test(body);
  const custom=(m.entities||[]).filter(x=>x.type==='custom_emoji'&&x.offset===m.text.indexOf(body)&&x.length===body.length);
  if(singleEmoji||custom.length){
   need(custom.length<=1&&(!custom.length||/^[1-9]\d{0,19}$/.test(custom[0].custom_emoji_id||'')),'NNA_INVALID_CUSTOM_REACTION');
   const reaction=custom.length?{type:'custom_emoji',customEmojiId:custom[0].custom_emoji_id}:{type:'emoji',emoji:body};
   return {...base,kind:'reaction',targetUrl:target.url,body,target,reaction,update};
  }
  need(!/^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\uFE0E\u200D0-9#*\u20E3\s]+$/u.test(body)||!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3]/u.test(body),'NNA_ONE_REACTION_REQUIRED');
  return {...base,kind:'direct',targetUrl:target.url,body,target,mentionIds,update};
 } catch(e){return {...base,kind:'invalid',error:/^NNA_/.test(e.message)?e.message:'NNA_INVALID_MESSAGE_URL'};}
}
function randomId(senderId,requestKey){const b=createHash('sha256').update(`nna-direct-v1\0${senderId}\0${requestKey}`).digest();return bigInt((b.readBigInt64BE()||1n).toString());}
async function sendDirect(client,c,p,bounded,now=Date.now()) {
 const event=parseDirectRequest(p.update,p,now);
 need(event?.kind==='direct','NNA_INVALID_DIRECT_REQUEST');
 need(p.claimValidated===true&&p.claimRequestKey===event.requestKey&&p.claimOperatorId===event.operatorId&&p.claimBody===event.body&&p.claimUrl===event.targetUrl,'NNA_DIRECT_CLAIM_REQUIRED');
 const target=event.target;const {group,peer,source,topic}=await resolveTarget(client,target,bounded);
 const final=event.rich?{text:'',entities:[],mentioned:[]}:await buildMentions(client,event,source,peer,bounded);
 const rid=randomId(c.expectedUserId,event.requestKey);
 const content=event.rich?{message:'',richMessage:new Api.InputRichMessageHTML({html:event.html})}:{message:final.text,entities:final.entities};
 let result;
 try {
  result=await bounded(client.invoke(new Api.messages.SendMessage({peer,...content,randomId:rid,noWebpage:true,sendAs:new Api.InputPeerSelf(),replyTo:new Api.InputReplyToMessage({replyToMsgId:target.messageId,...(topic?{topMsgId:topic}:{})})})));
  const updates=result.updates||[];const sentId=updates.find(x=>x.className==='UpdateMessageID'&&String(x.randomId)===String(rid))?.id||(result.className==='UpdateShortSentMessage'?result.id:0);
  need(Number.isSafeInteger(sentId)&&sentId>0,'NNA_DELIVERY_UNCONFIRMED');
  const sent=updates.map(x=>x.message).find(x=>x?.id===sentId)||(await bounded(client.getMessages(peer,{ids:[sentId]})))[0];
  need(sent?.out===true&&(event.rich?Boolean(sent.richMessage):sent.message===final.text&&mentionsKept(sent,final))&&String(sent.fromId?.userId)===String(c.expectedUserId)&&String(utils.getPeerId(sent.peerId))===String(utils.getPeerId(group))&&sent.replyTo?.replyToMsgId===target.messageId,'NNA_DELIVERY_UNCONFIRMED');
  return {status:'sent',requestKey:event.requestKey,operatorId:event.operatorId,senderId:String(c.expectedUserId),targetChatId:String(utils.getPeerId(group)),replyToMessageId:target.messageId,topicId:topic,sentId,targetUrl:event.targetUrl,mentioned:final.mentioned};
 }catch{throw new Error('NNA_DELIVERY_UNCONFIRMED');}
}
const cleanName=v=>String(v??'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,64);
const displayName=u=>cleanName([u.firstName,u.lastName].filter(Boolean).join(' '))||cleanName(u.username)||String(u.id);
async function explicitUser(client,peer,want,bounded){
 let u;
 try{const e=await bounded(client.getEntity(bigInt(want)));if(e?.className==='User')u=e;}catch{}
 // A fresh session knows nobody: page through the target group's members, newest first, until the ID is met.
 for(let offset=0;!u&&offset<3000;offset+=200){
  let r;try{r=await bounded(client.invoke(new Api.channels.GetParticipants({channel:peer,filter:new Api.ChannelParticipantsRecent(),offset,limit:200,hash:bigInt.zero})));}catch{break;}
  u=(r?.users||[]).find(x=>x.className==='User'&&String(x.id)===want);
  if(!(r?.participants||[]).length||r.participants.length<200)break;
 }
 need(u&&!u.deleted&&!u.min&&u.accessHash,'NNA_MENTION_USER_NOT_FOUND');
 return {name:displayName(u),input:new Api.InputUser({userId:u.id,accessHash:u.accessHash}),id:String(u.id)};
}
async function authorOf(client,source,peer,bounded){
 need(source.fromId?.className==='PeerUser','NNA_MENTION_TARGET_HAS_NO_USER');
 let u;try{u=await bounded(source.getSender?source.getSender():Promise.resolve(null));}catch{u=null;}
 need(u?.className==='User'&&!u.deleted,'NNA_MENTION_TARGET_HAS_NO_USER');
 return {name:displayName(u),input:new Api.InputUserFromMessage({peer,msgId:source.id,userId:u.id}),id:String(u.id)};
}
// Builds the final reply text: every standalone "@" becomes the person's name with a real, clickable mention.
async function buildMentions(client,event,source,peer,bounded){
 const slots=slotsOf(event.body);
 const ids=event.mentionIds||[];
 if(!slots.length&&!ids.length)return {text:event.body,entities:[],mentioned:[]};
 const users=[];
 if(!slots.length){
  // No "@" place: the named people come first, then the reply text.
  let text='';const entities=[];
  for(const want of ids){const u=await explicitUser(client,peer,want,bounded);entities.push(new Api.InputMessageEntityMentionName({offset:text.length,length:u.name.length,userId:u.input}));text+=u.name+' ';users.push(u);}
  text+=event.body;
  need(text.length<=4096,'NNA_REPLY_TEXT_1_TO_4096_REQUIRED');
  return {text,entities,mentioned:users.map(u=>u.id)};
 }
 if(ids.length){for(const want of ids)users.push(await explicitUser(client,peer,want,bounded));}
 else{const a=await authorOf(client,source,peer,bounded);for(let i=0;i<slots.length;i++)users.push(a);}
 let text='',last=0;const entities=[];
 slots.forEach((m,i)=>{text+=event.body.slice(last,m.index);entities.push(new Api.InputMessageEntityMentionName({offset:text.length,length:users[i].name.length,userId:users[i].input}));text+=users[i].name;last=m.index+m[0].length;});
 text+=event.body.slice(last);
 need(text.length<=4096,'NNA_REPLY_TEXT_1_TO_4096_REQUIRED');
 return {text,entities,mentioned:users.map(u=>u.id)};
}
function mentionsKept(sent,final){
 if(!final.entities.length)return true;
 const got=(sent.entities||[]).filter(e=>e.className==='MessageEntityMentionName').map(e=>String(e.userId));
 return got.length===final.mentioned.length&&got.every((x,i)=>x===final.mentioned[i]);
}
async function resolveTarget(client,target,bounded){
 let group;
 if(target.peer.startsWith('-100')) {
  try {group=await bounded(client.getEntity(bigInt(target.peer)));}catch {
   // A StringSession does not retain peer access hashes. Resolve only existing dialogs; never join.
   const dialogs=await bounded(client.getDialogs({limit:500}));
   group=dialogs.map(d=>d.entity).find(e=>e?.className==='Channel'&&String(utils.getPeerId(e))===target.peer);
  }
 }else group=await bounded(client.getEntity(target.peer));
 need(group?.className==='Channel'&&group.megagroup===true&&!group.left&&!group.kicked,'NNA_TARGET_GROUP_NOT_ACCESSIBLE');
 if(target.peer.startsWith('-100'))need(String(utils.getPeerId(group))===target.peer,'NNA_WRONG_TARGET_GROUP');
 else need([group.username,...(group.usernames||[]).filter(x=>x.active).map(x=>x.username)].some(x=>String(x||'').toLowerCase()===target.peer.toLowerCase()),'NNA_WRONG_TARGET_GROUP');
 const peer=await bounded(client.getInputEntity(group));
 const source=(await bounded(client.getMessages(peer,{ids:[target.messageId]})))[0];
 need(source?.className==='Message'&&source.id===target.messageId&&String(utils.getPeerId(source.peerId))===String(utils.getPeerId(group)),'NNA_SOURCE_MISSING');
 const topic=source.replyTo?.forumTopic?Number(source.replyTo.replyToTopId||source.replyTo.replyToMsgId):0;
 need(!target.topicId||(group.forum===true&&topic===target.topicId),'NNA_SOURCE_WRONG_TOPIC');
 return {group,peer,source,topic};
}
module.exports={operatorIds,targetFromUrl,parseDirectRequest,randomId,sendDirect,resolveTarget,buildMentions,splitMentionIds,slotsOf,richText,richRequest};
