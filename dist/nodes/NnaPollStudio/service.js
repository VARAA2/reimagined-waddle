'use strict';
const {createClient,validateCredentials}=require('../NnaTelegramSender/sender');
const {groupPeer}=require('../NnaTelegramSender/media-publish');
const {parsePollText}=require('../NnaTelegramSender/poll-content');
const {Store}=require('../NnaMediaCollection/store');
const model=require('./model'),{check}=model,{Api}=require('teleproto');
const crypto=require('node:crypto'),path=require('node:path'),os=require('node:os');
const sid=x=>String(x??''),clone=x=>JSON.parse(JSON.stringify(x));
const homeRows=[['📤 Image / Video பகிர்','📁 Media + Article'],['🗳️ Poll / Quiz / Checklist'],['🔎 Image / Video Report'],['🎙️ Audio Summary'],['📡 Live Schedule','📄 User Chat History'],['📚 Templates'],['💾 புதிதாகச் சேமி','✏️ மாற்று']];
const groupLaunch=/^\/(menu|poll|quiz|checklist|polltemplates|polltopics|share|bundle|live|history|templates|save|edit)$/i;
const homeCommands={'📚 Poll Templates':'/polltemplates','📤 Image / Video பகிர்':'/share','📁 Media + Article':'/bundle','🗳️ Poll / Quiz / Checklist':'/poll','📡 Live Schedule':'/live','📄 User Chat History':'/history','📚 Templates':'/templates','💾 புதிதாகச் சேமி':'/save','✏️ மாற்று':'/edit','🏠 Main Menu':'/menu'};
const bounded=async(p,ms=25000)=>{let timer;try{return await Promise.race([p,new Promise((_,r)=>timer=setTimeout(()=>r(Error('POLL_TIMEOUT')),ms))]);}finally{clearTimeout(timer);}};
const errorText={
 POLL_PREMIUM_REQUIRED:'Checklist வெளியிட @nna_enthiran கணக்கில் Telegram Premium வேண்டும்.',
 POLL_CHECKLIST_COUNT:'Checklist-ல் 1 முதல் 30 items வேண்டும்.',
 POLL_CHECKLIST_TITLE:'Checklist தலைப்பு 255 characters-க்குள் வேண்டும்.',
 POLL_CHECKLIST_ITEM:'ஒவ்வொரு item-க்கும் 1–100 characters வேண்டும்.',
 POLL_CHECKLIST_LABELS:'Checklist items-ஐ 1. முதல் பணி, 2. இரண்டாவது பணி என்ற வரிசையில் அனுப்புங்கள்.',
 POLL_CORRECT:'சரியான விடைக்கு A அல்லது 1 அனுப்புங்கள். பல சரியான விடைகள் என்றால் A,C என்று அனுப்பலாம்.',
 POLL_CORRECT_SINGLE:'பல சரியான விடைகள் உள்ளன. Multiple answers ON வையுங்கள் அல்லது ஒரு சரியான விடையைத் தேர்வு செய்யுங்கள்.',
 POLL_TIMER:'Timer: 0 (OFF) அல்லது 5 முதல் 2628000 வரை seconds அனுப்புங்கள்.',
 POLL_HIDE_NEEDS_TIMER:'Results மறைக்க முதலில் Timer அமைக்க வேண்டும்.',
 POLL_QUIZ_ADDING:'Quiz-ல் புதிய answer options சேர்க்க அனுமதிக்க முடியாது.',
 POLL_EXPLANATION:'விடை விளக்கம்: 200 characters, அதிகபட்சம் 3 வரிகள்.',
 POLL_DESCRIPTION:'Poll விளக்கம் 1024 characters-க்குள் வேண்டும்.',
 POLL_COUNTRIES:'Country codes: IN,LK போன்ற 2-letter codes. அனைவருக்கும் அனுமதிக்க - அனுப்புங்கள்.',
 POLL_TOPIC_CLOSED:'அந்த topic மூடப்பட்டுள்ளது அல்லது கிடைக்கவில்லை. வேறு topic தேர்வு செய்யுங்கள்.',
 POLL_BUSY:'முந்தைய poll செயல் முடியும்வரை காத்திருங்கள்.',
 POLL_STALE:'இந்த button பழையது. /poll அல்லது /polltemplates மூலம் மீண்டும் திறக்கவும்.',
 POLL_CODE:'Code: ஆங்கில எழுத்தில் தொடங்கி letters, numbers, underscore மட்டும்; 3–32 characters.',
 POLL_DELIVERY_UNCONFIRMED:'Poll அனுப்பப்பட்டதா என்பதை உறுதி செய்ய முடியவில்லை. Topic-ஐப் பாருங்கள்; தானாக மீண்டும் அனுப்பப்படாது.',
 POLL_QUIZ_UNCONFIRMED:'Quiz அனுப்பப்பட்டிருக்கலாம்; சரியான விடையின் readback உறுதியாகவில்லை. Topic-ஐப் பாருங்கள்; தானாக மீண்டும் அனுப்பப்படாது.'
};
function config(c,s){
 validateCredentials(c);check(s&&/^[1-9]\d+$/.test(sid(s.botId))&&/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s.botUsername||''),'SCOPE');
 check(Array.isArray(s.operatorIds)&&s.operatorIds.includes(sid(c.expectedUserId))&&s.operatorIds.every(x=>/^[1-9]\d+$/.test(x)),'OPERATORS');
 check(Array.isArray(s.groups)&&s.groups.length>0&&s.groups.length<=10&&s.groups.every(g=>/^-100[1-9]\d+$/.test(g.id)&&typeof g.title==='string'),'GROUPS');
 check(Array.isArray(s.defaultTargets)&&s.defaultTargets.every(t=>s.groups.some(g=>g.id===t.groupId)&&Number.isSafeInteger(t.topicId)&&t.topicId>0),'TOPICS');
 check(s.groupReplies===undefined||typeof s.groupReplies==='boolean','SCOPE');
 check(s.pollPublishConfirmation===undefined||typeof s.pollPublishConfirmation==='boolean','SCOPE');
 return {...s};
}
function authenticate(u,s,now=Date.now()){
 if(!Number.isSafeInteger(u?.update_id)||u.update_id<0||u.edited_message)return null;
 const cb=u.callback_query,m=cb?.message||u.message,a=cb?.from||m?.from;
 if(!m||!s.operatorIds.includes(sid(a?.id))||a.is_bot!==false||m.sender_chat)return null;
 const privateChat=m.chat?.type==='private'&&m.chat.id===a.id;
 const group=m.chat?.type==='supergroup'&&s.groups.some(g=>g.id===sid(m.chat.id));
 if(!privateChat&&!group)return null;
 if(cb){if(m.from?.is_bot!==true||sid(m.from.id)!==sid(s.botId))return null;}
 else if(m.edit_date||m.forward_origin||m.forward_date||!Number.isSafeInteger(m.date)||m.date*1000>now+30000||now-m.date*1000>86400000)return null;
 return {owner:sid(a.id),privateChat,message:m,callback:cb,text:String(m.text||'').trim(),groupId:sid(m.chat.id),topicId:m.message_thread_id||0};
}
class Service{
 constructor(ctx,c,b,scope,deps={}){
  this.ctx=ctx;this.c={...c,expectedUsername:scope.senderUsername||'nna_enthiran'};this.b=b;this.scope=config(c,scope);this.deps=deps;
  check(process.env.EXECUTIONS_MODE!=='queue','SINGLE_INSTANCE_REQUIRED');
  check(sid(b.accessToken).split(':')[0]===sid(scope.botId),'BOT_CREDENTIAL');
  this.store=new Store(scope.botId,deps.root||path.join(process.env.N8N_USER_FOLDER||os.homedir(),'.n8n','nna-poll-studio',sid(scope.botId)));
  this.store.change('topics',x=>x||{targets:clone(scope.defaultTargets)});
 }
 async bot(method,body={}){try{const r=await this.ctx.helpers.httpRequest({method:'POST',url:'https://api.telegram.org/bot'+this.b.accessToken+'/'+method,body,json:true,timeout:25000});check(r?.ok,'BOT_RESPONSE');return r.result;}catch{throw Error('POLL_BOT_'+method.toUpperCase()+'_FAILED');}}
 async init(){const me=await this.bot('getMe');check(sid(me.id)===sid(this.scope.botId)&&me.username?.toLowerCase()===this.scope.botUsername.toLowerCase(),'BOT_IDENTITY');return this;}
 async personal(fn){let client;try{client=await(this.deps.createClient||createClient)(this.c);await bounded(client.connect());const me=await bounded(client.getMe());check(!me.bot&&sid(me.id)===sid(this.c.expectedUserId)&&me.username?.toLowerCase()===this.c.expectedUsername.toLowerCase(),'SENDER_IDENTITY');return await fn(client);}finally{if(client)await bounded(client.destroy(),10000).catch(()=>{});}}
 targets(){return(this.store.read('topics')?.targets||[]).filter(t=>this.scope.groups.some(g=>g.id===t.groupId));}
 templates(){return this.store.read('templates')?.items||{};}
 draft(owner){const d=this.store.read('draft_'+owner);return d&&d.expiresAt>Date.now()?d:null;}
 save(d){d.rev=crypto.randomBytes(4).toString('hex');d.expiresAt=Date.now()+86400000;this.store.change('draft_'+d.owner,()=>d);return d;}
 button(d,text,action){return {text,callback_data:'ps:'+d.owner+':'+d.rev+':'+action};}
 async tell(owner,text,buttons){return this.bot('sendMessage',{chat_id:owner,text,...(buttons?{reply_markup:{inline_keyboard:buttons.map(row=>row)}}:{})});}
 async screen(d,text,rows){if(this.replyContext&&/^(content|input_)/.test(d.stage))text+='\n\n↩️ இந்த bot message-க்கு Reply செய்து பதிலை அனுப்புங்கள்.';d.keys=Object.fromEntries((rows||[]).flat().map(([label,action])=>[label,action]));d=this.save(d);return this.bot('sendMessage',{chat_id:d.owner,text,reply_markup:{keyboard:[...(rows||[]).map(row=>row.map(([label])=>({text:label}))),[{text:'🏠 Main Menu'}]],resize_keyboard:true,is_persistent:false,one_time_keyboard:false,input_field_placeholder:'Button தேர்வு செய்யுங்கள் அல்லது message அனுப்புங்கள்'}});}
 async home(owner){
  if(this.replyContext){
   const d=this.draft(owner);if(d){d.active=false;d.keys={};this.save(d);}
   return this.bot('sendMessage',{chat_id:owner,text:'#NNA — இந்த topic-ல் பயன்படுத்தலாம்\n\nImage / Video Report, Poll / Quiz / Checklist.\nHistory, template நிர்வாகம், media publishing மற்றும் scheduling தனிப்பட்ட chat-ல் தொடரும்.',reply_markup:{keyboard:[[{text:'🔎 Image / Video Report'}],[{text:'🗳️ Poll / Quiz / Checklist'}],[{text:'📚 Poll Templates'}],[{text:'↗️ தனிப்பட்ட menu',url:'https://t.me/'+this.scope.botUsername+'?start=menu'}]]}});
  }
  const d=this.draft(owner);if(d){d.active=false;d.keys={};this.save(d);}return this.bot('sendMessage',{chat_id:owner,text:'#NNA — முக்கிய menu\nகீழே உள்ள buttons மூலம் தேர்வு செய்யுங்கள்.',reply_markup:{keyboard:homeRows.map(row=>row.map(text=>({text}))),resize_keyboard:true,is_persistent:false,one_time_keyboard:false}});}
 async groupMenu(a){
  const member=await this.bot('getChatMember',{chat_id:a.groupId,user_id:Number(a.owner)});if(!['creator','administrator'].includes(member.status))return {status:'admin_required'};
  const text=a.text.replace(new RegExp('@'+this.scope.botUsername+'\\b','ig'),'').trim(),command=homeCommands[a.text]||text;
  return this.bot('sendMessage',{chat_id:a.groupId,...(a.topicId?{message_thread_id:a.topicId}:{}),reply_parameters:{message_id:a.message.message_id},text:'இந்த வசதியை @'+this.scope.botUsername+' private chat-ல் திறக்க கீழே அழுத்துங்கள்.',reply_markup:{inline_keyboard:[[{text:'↗️ '+command,url:'https://t.me/'+this.scope.botUsername+'?start='+command.slice(1)}]]}});
 }

 async start(owner,kind){
  const d={owner,active:true,stage:'type',settings:model.defaults(),sourceText:'',sourceEntities:[],poll:null};
  if(kind){d.settings.type=kind===true?'quiz':kind;return this.input(d);}
  return this.screen(d,'🗳️ Poll / Quiz / Checklist\n\nஎதை உருவாக்கப் போகிறீர்கள்?',[[['🗳️ Vote Poll','type_poll'],['❓ Quiz — சரியான விடையுடன்','type_quiz']],[['☑️ Checklist','type_checklist']],[['📚 Templates','templates'],['📍 Topics','topics']],[['❌ ரத்து','cancel']]]);
 }
 async input(d){d.stage='content';d.active=true;if(d.settings.type==='checklist')return this.screen(d,'☑️ Checklist — ஒரே message-ல் அனுப்புங்கள்:\n\nஇன்றைய பணிகள்\n1. முதல் பணி\n2. இரண்டாவது பணி\n\nதலைப்பு: 255 characters. 1–30 items; ஒவ்வொன்றும் 100 characters வரை.',[[['❌ ரத்து','cancel']]]);return this.screen(d,(d.settings.type==='quiz'?'❓ Quiz':'🗳️ Poll')+' — கேள்வி மற்றும் options\n\nஒரே message-ல் இப்படி அனுப்புங்கள்:\n\nஉங்கள் கேள்வி?\nA) முதல் விடை\nB) இரண்டாவது விடை\nC) மூன்றாவது விடை\n\n2–12 options. கேள்வி 300 characters; ஒவ்வொரு option 100 characters.\n'+(d.settings.type==='quiz'?'அடுத்ததாக சரியான விடையைக் கேட்பேன்.':'அடுத்து settings மற்றும் preview வரும்.'),[[['❌ ரத்து','cancel']]]);}
 async ask(d,field,text){d.stage='input_'+field;return this.screen(d,text,[[['↩️ Settings','settings'],['❌ ரத்து','cancel']]]);}
 async preview(d){
  d.stage='settings';d.active=true;const s=d.settings,on=x=>x?'ON':'OFF';
  if(s.type==='checklist')return this.screen(d,'☑️ CHECKLIST — Preview\n\n'+d.poll.question.text+'\n\n'+d.poll.answers.map((a,i)=>(i+1)+'. ☐ '+a.text).join('\n')+'\n\n➕ மற்றவர்கள் items சேர்க்கலாம்: '+on(s.othersAppend)+'\n✅ மற்றவர்கள் complete / undo செய்யலாம்: '+on(s.othersComplete)+'\n👤 @'+this.c.expectedUsername,[[['➕ Add items '+on(s.othersAppend),'toggle_othersAppend']],[['✅ Complete / Undo '+on(s.othersComplete),'toggle_othersComplete']],[['✏️ பட்டியல் மாற்று','edit'],['💾 Template சேமி','save']],[['✅ Topic தேர்வு','destinations'],['📚 Templates','templates']],[['❌ ரத்து','cancel']]]);
  const body=(s.type==='quiz'?'❓ QUIZ':'🗳️ POLL')+' — Preview\n\n'+d.poll.question.text+'\n\n'+d.poll.answers.map((a,i)=>String.fromCharCode(65+i)+') '+a.text).join('\n')+'\n\n'+
   (s.type==='quiz'?'✅ சரியான விடை: '+s.correct.map(i=>String.fromCharCode(65+i)).join(', ')+'\n':'')+
   '👤 '+(s.anonymous?'Anonymous':'வாக்களிப்பவரின் பெயர் தெரியும்')+'\n☑️ பல விடைகள்: '+on(s.multiple)+'\n🔁 Vote மாற்றலாம்: '+on(s.revote)+'\n🔀 Shuffle: '+on(s.shuffle)+'\n➕ புதிய options சேர்க்கலாம்: '+on(s.adding)+'\n⏱ Timer: '+(s.seconds?s.seconds+' seconds':'OFF')+'\n🙈 முடியும் வரை results மறை: '+on(s.hide)+'\n👥 24 மணி நேர group members மட்டும்: '+on(s.members)+'\n🌍 Countries: '+(s.countries.join(', ')||'அனைத்தும்')+
   (s.description?'\n📝 விளக்கம்: '+s.description:'')+(s.explanation?'\n💡 Quiz விளக்கம்: '+s.explanation:'')+'\n\n👤 வெளியிடுபவர்: @'+this.c.expectedUsername;
  const rows=[
   [['👤 Anonymous / பெயர்','toggle_anonymous'],['☑️ Single / Multiple','toggle_multiple']],
   [['🔁 Revoting '+on(s.revote),'toggle_revote'],['🔀 Shuffle '+on(s.shuffle),'toggle_shuffle']],
   [['➕ Add options '+on(s.adding),'toggle_adding'],['⏱ Timer','timer']],
   [['🙈 Hide results '+on(s.hide),'toggle_hide'],['👥 Members only '+on(s.members),'toggle_members']],
   [['🌍 Countries','countries'],['📝 Description','description']],
   ...(s.type==='quiz'?[[['✅ சரியான விடை','correct'],['💡 Explanation','explanation']]]:[]),
   [['✏️ கேள்வி / Options மாற்று','edit'],[s.type==='quiz'?'🗳️ Poll ஆக மாற்று':'❓ Quiz ஆக மாற்று','type_'+(s.type==='quiz'?'poll':'quiz')]],
   [['💾 Template சேமி','save'],['✅ Topic தேர்வு','destinations']],
   [['📚 Templates','templates'],['❌ ரத்து','cancel']]
  ];
  return this.screen(d,body,rows);
 }
 async list(owner,page=0){
  const items=Object.entries(this.templates()).sort(([a],[b])=>a.localeCompare(b)),d=this.draft(owner)||{owner,active:false,settings:model.defaults()};
  const rows=items.slice(page*12,page*12+12).map(([code,t])=>[[code+' · '+t.poll.question.text.slice(0,45),'load_'+code]]);
  if(page>0)rows.push([['⬅️ முந்தையவை','list_'+(page-1)]]);if(items.length>(page+1)*12)rows.push([['அடுத்து ➡️','list_'+(page+1)]]);
  rows.push([['🆕 புதிய Poll / Quiz','new'],['📍 Topics','topics']]);
  return this.screen(d,'📚 Poll / Quiz / Checklist Templates\n\n'+(items.length?'Code word-ஐ private chat-ல் அனுப்பினால் preview வரும்.\nEnabled group topic-ல் அதே code word மட்டும் அனுப்பினால் புதிய Poll / Quiz / Checklist உடனே @'+this.c.expectedUsername+' மூலம் வெளியாகும்.':'இன்னும் template இல்லை. /poll மூலம் உருவாக்கி 💾 Template சேமி அழுத்துங்கள்.'),rows);
 }
 async load(owner,code){
  const t=this.templates()[code.toLowerCase()];check(t,'TEMPLATE_MISSING');
  const d={...clone(t),owner,active:true,stage:'settings'};delete d.target;return this.preview(d);
 }
 async topics(groupId){
  return this.personal(async client=>{const peer=await groupPeer(client,groupId,bounded);let all=[],offsetDate=0,offsetId=0,offsetTopic=0;
   for(let page=0;page<10;page++){const r=await bounded(client.invoke(new Api.messages.GetForumTopics({peer,offsetDate,offsetId,offsetTopic,limit:100}))),ts=(r.topics||[]).filter(t=>t.className==='ForumTopic');for(const t of ts)if(!all.some(x=>x.id===t.id))all.push(t);if(all.length>=r.count||!ts.length)break;const last=ts.at(-1),date=r.orderByCreateDate?last.date:r.messages?.find(m=>m.id===last.topMessage)?.date;check(date&&last.id!==offsetTopic,'TOPIC_PAGINATION');offsetDate=date;offsetId=last.topMessage;offsetTopic=last.id;}
   check(all.length<=500,'TOPIC_LIMIT');return all.filter(t=>!t.closed).map(t=>({groupId,topicId:t.id,title:t.title}));
  });
 }
 async topicGroups(owner){
  if(this.replyContext)return this.tell(owner,'Topic நிர்வாகத்தை தனிப்பட்ட chat-ல் திறக்கவும்.',[[{text:'↗️ Poll topics',url:'https://t.me/'+this.scope.botUsername+'?start=polltopics'}]]);
  const d=this.draft(owner)||{owner,active:false,settings:model.defaults()};
  return this.screen(d,'📍 Poll பயன்படுத்தும் topics\n\nGroup-ஐத் தேர்வு செய்து topics-ஐ ON/OFF செய்யுங்கள். புதிய topic உருவாக்கினால் இங்கே தோன்றும்; extension update தேவையில்லை.',this.scope.groups.map((g,i)=>[[g.title,'tg_'+i+'_0']]).concat([[['↩️ Poll Templates','templates']]]));
 }
 async topicPage(owner,gi,page=0){
  if(this.replyContext)return this.topicGroups(owner);
  const g=this.scope.groups[gi];check(g,'GROUPS');const list=await this.topics(g.id),enabled=this.targets(),d=this.draft(owner)||{owner,active:false,settings:model.defaults()};
  const rows=list.slice(page*12,page*12+12).map(t=>[[(enabled.some(e=>e.groupId===g.id&&e.topicId===t.topicId)?'✅ ':'▫️ ')+t.title,'en_'+gi+'_'+t.topicId+'_'+page]]);
  if(page>0)rows.push([['⬅️','tg_'+gi+'_'+(page-1)]]);if(list.length>(page+1)*12)rows.push([['➡️','tg_'+gi+'_'+(page+1)]]);
  rows.push([['↩️ Groups','topics'],['📚 Templates','templates']]);return this.screen(d,g.title+'\nTopic-ஐத் தொட்டு enable / disable செய்யுங்கள்.',rows);
 }
 async destinations(d){
  model.validate(d);const targets=this.targets().filter(t=>!this.replyContext||t.groupId===this.replyContext.chatId&&t.topicId===(this.replyContext.topicId||1));check(targets.length,'NO_TOPICS');d.stage='destination';d.destinations=targets;
  return this.screen(d,'📍 எந்த topic-ல் வெளியிட வேண்டும்?',targets.map((t,i)=>[[this.scope.groups.find(g=>g.id===t.groupId)?.title+' · '+(t.title||t.topicId),'dst_'+i]]).concat([[['↩️ Settings','settings'],['📍 Topics நிர்வகி','topics']]]));
 }
 async confirm(d,index){
  const t=d.destinations?.[index];check(t&&this.targets().some(x=>x.groupId===t.groupId&&x.topicId===t.topicId),'TOPIC_DISABLED');d.target=t;d.stage='confirm';
  return this.screen(d,'✅ வெளியிடுவதற்கான இறுதி உறுதி\n\n'+d.poll.question.text+'\n📍 '+t.title+'\n👤 @'+this.c.expectedUsername+(d.settings.type==='checklist'?'\n☑️ Checklist':'\n🔁 Vote மாற்றலாம்: '+(d.settings.revote?'ON':'OFF'))+'\n'+(d.settings.type==='quiz'?'❓ Quiz — சரியான விடை '+d.settings.correct.map(i=>String.fromCharCode(65+i)).join(', '):d.settings.type==='checklist'?'☑️ Checklist':'🗳️ Poll'),[[['✅ வெளியிடு','publish'],['↩️ Settings','settings']],[['💾 Template சேமி','save'],['❌ ரத்து','cancel']]]);
 }
 async deliver(owner,d,target,key){
  check(this.targets().some(x=>x.groupId===target.groupId&&x.topicId===target.topicId)&&(!this.replyContext||target.groupId===this.replyContext.chatId&&target.topicId===(this.replyContext.topicId||1)),'TOPIC_DISABLED');model.validate(d);
  let taken=false;this.store.change('send_'+key,old=>{if(old)return old;taken=true;return {status:'sending',owner,target,createdAt:Date.now()};});
  if(!taken)return {status:'duplicate'};
  try{const receipt=await this.personal(client=>(this.deps.publish||model.publish)(client,this.c,d,target,key,bounded));this.store.change('send_'+key,x=>({...x,...receipt,finishedAt:Date.now()}));if(d.settings.type!=='poll'||this.scope.pollPublishConfirmation!==false)await this.tell(owner,'✅ '+(d.settings.type==='quiz'?'Quiz':d.settings.type==='checklist'?'Checklist':'Poll')+' வெளியிடப்பட்டது.\n👤 @'+this.c.expectedUsername+'\n📍 '+receipt.url);return receipt;}
  catch(e){this.store.change('send_'+key,x=>({...x,status:'uncertain',error:/^POLL_[A-Z_]+$/.test(e.message)?e.message:'POLL_DELIVERY_UNCONFIRMED'}));throw e;}
 }
 async saveTemplate(d,code){
  code=String(code).trim().toLowerCase();check(/^[a-z][a-z0-9_]{2,31}$/.test(code),'CODE');model.validate(d);
  const template={sourceText:d.sourceText,sourceEntities:d.sourceEntities,poll:d.poll,settings:d.settings,savedBy:d.owner,savedAt:Date.now()};
  this.store.change('templates',old=>{const items={...(old?.items||{})};check(items[code]||Object.keys(items).length<200,'TEMPLATE_LIMIT');items[code]=clone(template);return {items};});
  await this.tell(d.owner,'💾 Template சேமிக்கப்பட்டது: '+code+'\n\nPrivate: '+code+' → Preview\nEnabled group topic: '+code+' → @'+this.c.expectedUsername+' மூலம் புதிய Poll / Quiz / Checklist.\nஒவ்வொரு முறையும் புதிய பதிவு உருவாகும்.');return this.preview(d);
 }
 async configureCommands(){
  const scope={type:'all_private_chats'},scoped=await this.bot('getMyCommands',{scope}),base=scoped.length?scoped:await this.bot('getMyCommands');
  const add=[['menu','முக்கிய keyboard menu'],['share','Image / Video பகிர்'],['bundle','Media + Article'],['live','Live Schedule'],['templates','Templates'],['save','புதிதாகச் சேமி'],['edit','Template மாற்று'],['poll','Poll / Quiz / Checklist உருவாக்கு'],['checklist','Checklist உருவாக்கு'],['quiz','சரியான விடையுடன் Quiz உருவாக்கு'],['polltemplates','சேமித்த Poll / Quiz templates'],['pollsave','தற்போதைய poll-ஐ code word-ல் சேமி'],['polluse','Poll template code word பயன்படுத்து'],['polltopics','Poll topics சேர்க்க / நீக்க'],['history','User ID / username chat history பெற']];
  const commands=[...base];for(const [command,description] of add){const i=commands.findIndex(x=>x.command===command);if(i<0)commands.push({command,description});else commands[i]={command,description};}
  await this.bot('setMyCommands',{scope,commands});const observed=await this.bot('getMyCommands',{scope});check(JSON.stringify(observed)===JSON.stringify(commands),'COMMANDS_UNCONFIRMED');
  if(this.scope.adminKeyboard)for(const g of this.scope.groups){const adminScope={type:'chat_administrators',chat_id:g.id},existing=await this.bot('getMyCommands',{scope:adminScope}),next=[...existing.filter(x=>!['menu','share','bundle','poll','quiz','checklist','polltemplates','polltopics','live','history','templates','save','edit'].includes(x.command)),...commands.filter(x=>['poll','quiz','checklist','polltemplates','polltopics','history'].includes(x.command)),{command:'menu',description:'NNA Admin menu'},{command:'share',description:'Image / Video பகிர்'},{command:'bundle',description:'Media + Article'},{command:'live',description:'Live Schedule'},{command:'templates',description:'Templates'},{command:'save',description:'புதிதாகச் சேமி'},{command:'edit',description:'Template மாற்று'}];await this.bot('setMyCommands',{scope:adminScope,commands:next});const seen=await this.bot('getMyCommands',{scope:adminScope});check(JSON.stringify(seen)===JSON.stringify(next),'COMMANDS_UNCONFIRMED');}
  return {status:'configured',commands:observed,adminKeyboard:!!this.scope.adminKeyboard};
 }
 async inspect(){return this.personal(async client=>{const me=await client.getMe();for(const g of this.scope.groups)await groupPeer(client,g.id,bounded);return {status:'verified',botId:this.scope.botId,senderId:sid(me.id),topics:this.targets(),templates:Object.keys(this.templates()),storePersistent:true,premium:!!me.premium};});}
 async action(a,u){
  let d=this.draft(a.owner);const text=a.text.replace(new RegExp('@'+this.scope.botUsername+'\\b','ig'),'').trim(),cb=a.callback;
  if((a.privateChat||a.inPlace)&&text==='/menu')return this.home(a.owner);
  if(!a.privateChat&&!a.inPlace&&this.scope.adminKeyboard&&(groupLaunch.test(text)||homeCommands[a.text]))return this.groupMenu(a);
  if(!a.privateChat&&(!a.inPlace||this.targets().some(t=>t.groupId===a.groupId&&t.topicId===a.topicId)&&this.templates()[( /^\/polluse\s+([a-z][a-z0-9_]{2,31})$/i.exec(text)?.[1]||text).toLowerCase()])){const code=/^\/polluse\s+([a-z][a-z0-9_]{2,31})$/i.exec(text)?.[1]||text,t=this.templates()[code.toLowerCase()];if(!t)return;return this.deliver(a.owner,t,{groupId:a.groupId,topicId:a.topicId},'u'+u.update_id);}
  if(/^\/(?:poll|quiz|checklist)$/i.test(text))return this.start(a.owner,/^\/poll$/i.test(text)?false:text.slice(1).toLowerCase());
  if(/^\/polltemplates$/i.test(text))return this.list(a.owner);
  if(/^\/polltopics$/i.test(text))return this.topicGroups(a.owner);
  const save=/^\/pollsave(?:\s+(.+))?$/i.exec(text);if(save){check(d?.poll,'NO_DRAFT');if(save[1])return this.saveTemplate(d,save[1]);return this.ask(d,'code','💾 Template code word அனுப்புங்கள்.\nஉதாரணம்: dailyvote');}
  const use=/^\/polluse\s+([a-z][a-z0-9_]{2,31})$/i.exec(text);if(use||this.templates()[text.toLowerCase()])return this.load(a.owner,use?use[1]:text);
  if(cb){
   if(cb.data==='tpl:'+a.owner+':poll:')return this.start(a.owner,false);
   const m=/^ps:(\d+):([a-f0-9]{8}):([a-zA-Z0-9_]+)$/.exec(cb.data||'');check(m&&m[1]===a.owner&&d&&m[2]===d.rev,'STALE');const act=m[3];
   if(act==='cancel'){d.active=false;d.stage='cancelled';this.save(d);return this.tell(a.owner,'❌ Poll draft ரத்து செய்யப்பட்டது. /poll மூலம் மீண்டும் தொடங்கலாம்.');}
   if(act==='new')return this.start(a.owner,false);
   if(act==='templates')return this.list(a.owner);
   if(act.startsWith('list_'))return this.list(a.owner,Number(act.slice(5)));
   if(act==='topics')return this.topicGroups(a.owner);
   if(act.startsWith('tg_')){const [,g,p]=act.split('_');return this.topicPage(a.owner,Number(g),Number(p));}
   if(act.startsWith('en_')){
    if(this.replyContext)return this.topicGroups(a.owner);
    const [,gi,id,page]=act.split('_'),g=this.scope.groups[Number(gi)];check(g,'GROUPS');const topics=await this.topics(g.id),t=topics.find(t=>t.topicId===Number(id));check(t,'TOPIC_CLOSED');
    this.store.change('topics',old=>{const exists=old.targets.some(x=>x.groupId===g.id&&x.topicId===t.topicId);return {targets:exists?old.targets.filter(x=>!(x.groupId===g.id&&x.topicId===t.topicId)):[...old.targets,t]};});return this.topicPage(a.owner,Number(gi),Number(page));
   }
   if(act.startsWith('load_'))return this.load(a.owner,act.slice(5));
   if(act.startsWith('type_')){if(act==='type_checklist'||d.settings.type==='checklist'){d.poll=null;d.sourceText='';d.settings=model.defaults();}d.settings={...d.settings,type:act.slice(5),correct:[],adding:false};if(d.poll){if(d.settings.type==='quiz')return this.ask(d,'correct','✅ சரியான விடை எது?\nA அல்லது 1 அனுப்புங்கள். பல சரியான விடைகள்: A,C');return this.preview(d);}return this.input(d);}
   check(d.poll,'NO_DRAFT');
   if(act==='settings')return this.preview(d);
   if(act==='edit')return this.input(d);
   if(act.startsWith('toggle_')){const k=act.slice(7);check(['anonymous','multiple','revote','shuffle','adding','hide','members','othersAppend','othersComplete'].includes(k),'SETTINGS');const next={...d.settings,[k]:!d.settings[k]};model.settings(next);if(k==='multiple'&&!next.multiple&&next.correct.length>1)throw Error('POLL_CORRECT_SINGLE');d.settings=next;return this.preview(d);}
   if(act==='correct')return this.ask(d,'correct','✅ சரியான விடை எது?\nA அல்லது 1 அனுப்புங்கள். பல சரியான விடைகள்: A,C');
   const prompts={timer:'⏱ Timer எத்தனை seconds?\n0 = OFF. உதாரணம்: 60, 300, 3600.',countries:'🌍 Country codes அனுப்புங்கள்.\nஉதாரணம்: IN,LK\nஅனைவருக்கும்: -',description:'📝 Poll description அனுப்புங்கள் (1024 characters வரை).\nநீக்க: -',explanation:'💡 சரியான விடைக்கான விளக்கம் அனுப்புங்கள் (200 characters வரை).\nவேண்டாம்: -',save:'💾 Template code word அனுப்புங்கள்.\nஉதாரணம்: dailyvote'};
   if(prompts[act])return this.ask(d,act==='save'?'code':act,prompts[act]);
   if(act==='destinations')return this.destinations(d);
   if(act.startsWith('dst_'))return this.confirm(d,Number(act.slice(4)));
   if(act==='publish'){check(d.stage==='confirm'&&d.target,'CONFIRM_REQUIRED');d.active=false;d.stage='sending';this.save(d);const result=await this.deliver(a.owner,d,d.target,'d'+a.owner+'_'+m[2]);d.stage=result.status;this.save(d);return result;}
   throw Error('POLL_STALE');
  }
  check(d?.active,'NO_DRAFT');
  if(text==='/cancel'){d.active=false;d.stage='cancelled';this.save(d);return this.tell(a.owner,'❌ Poll draft ரத்து செய்யப்பட்டது.');}
  if(d.stage==='content'){
   try{d.poll=(d.settings.type==='checklist'?require('./checklist').parse:parsePollText)(a.message.text,a.message.entities||[]);}catch(e){return this.tell(a.owner,'⚠️ '+e.message+'\nகேள்வி, அடுத்து A) / B) options உள்ள ஒரே message அனுப்புங்கள்.');}
   d.sourceText=a.message.text;d.sourceEntities=a.message.entities||[];d.settings.correct=[];
   if(d.settings.type==='quiz')return this.ask(d,'correct','✅ சரியான விடை எது?\nA அல்லது 1 அனுப்புங்கள். பல சரியான விடைகள்: A,C');
   return this.preview(d);
  }
  if(d.stage==='input_code')return this.saveTemplate(d,text);
  if(d.stage==='input_correct'){d.settings.correct=model.correct(text,d.poll.answers.length);if(d.settings.correct.length>1)d.settings.multiple=true;return this.preview(d);}
  if(d.stage==='input_timer'){const n=Number(text);d.settings=model.settings({...d.settings,seconds:n,hide:n?d.settings.hide:false});return this.preview(d);}
  if(d.stage==='input_countries'){d.settings=model.settings({...d.settings,countries:text==='-'?[]:text.toUpperCase().split(/[\s,]+/).filter(Boolean)});return this.preview(d);}
  if(['input_description','input_explanation'].includes(d.stage)){const key=d.stage.slice(6);d.settings=model.settings({...d.settings,[key]:text==='-'?'':a.message.text});return this.preview(d);}
  return this.preview(d);
 }
 async handle(u){
  require('../NnaMediaCollection/group-context').reset(this);
  let a=authenticate(u,this.scope);if(!a)return {handled:false,event:u};
  if(!a.privateChat&&this.scope.groupReplies){
   const gc=require('../NnaMediaCollection/group-context');
   const mention=/^\/[a-z_]+@([a-z0-9_]+)/i.exec(a.text);
   if(mention&&mention[1].toLowerCase()!==this.scope.botUsername.toLowerCase())return {handled:false,event:u};
   const relevant=a.text.startsWith('/')||a.callback||String(a.message.reply_to_message?.from?.id)===String(this.scope.botId)||this.templates()[a.text.toLowerCase()];
   if(!relevant)return {handled:false,event:u};
   const r=await gc.authorize(this,u,this.scope.groups.map(g=>g.id),this.scope.botId);if(!r)return {handled:true,status:'group_admin_required'};
   const routedText=homeCommands[a.text]||a.text.replace(/^\/start(?:@\w+)?\s+/i,'/');
   const privateCommand=/^\/(share|bundle|live|history|userhistory|templates|template|save|edit|polltopics)(?:@\w+)?(?:\s|$)/i.exec(routedText);
   if(privateCommand){await this.groupMenu({...a,text:'/'+(privateCommand[1].toLowerCase()==='userhistory'?'history':privateCommand[1].toLowerCase()==='template'?'templates':privateCommand[1].toLowerCase())});return {handled:true,status:'private_feature'};}
   if(a.callback&&!/^(ps:|gk:|mr:)/.test(a.callback.data||'')){await this.groupMenu({...a,text:'/menu'});return {handled:true,status:'private_feature'};}

   gc.attach(this,r);const decoded=await gc.decodeButton(this,u,r);if(!decoded)return {handled:true,status:'stale_group_button'};
   u=decoded;a={...authenticate(u,this.scope),inPlace:true};
  }

  const legacy=this.legacyIntent(u,a);if(legacy){u=legacy;a=authenticate(u,this.scope);}
  if((a.privateChat||a.inPlace)&&!a.callback&&a.text.startsWith('/'))this.clearLegacy(a.owner);
  const deep=(a.privateChat||a.inPlace)&&!a.callback&&/^\/start\s+(menu|poll|quiz|checklist|polltemplates|polltopics|share|bundle|live|history|templates|save|edit)$/.exec(a.text);if(deep){u={...u,message:{...u.message,text:'/'+deep[1],entities:[]}};a={...a,text:u.message.text,message:u.message};}
  if((a.privateChat||a.inPlace)&&!a.callback&&homeCommands[a.text]&&(a.text==='🏠 Main Menu'||!this.draft(a.owner)?.keys?.[a.text])){const command=homeCommands[a.text],old=this.draft(a.owner);if(old){old.active=false;old.keys={};this.save(old);}u={...u,message:{...u.message,text:command,entities:[]}};a={...a,text:command,message:u.message};}
  const current=this.draft(a.owner);if((a.privateChat||a.inPlace)&&!a.callback&&current?.keys?.[a.text])a={...a,callback:{data:'ps:'+a.owner+':'+current.rev+':'+current.keys[a.text]}};
  const d=this.draft(a.owner),text=a.text.replace(new RegExp('@'+this.scope.botUsername+'\\b','ig'),'').trim(),templates=this.templates();
  const code=/^\/polluse\s+([a-z][a-z0-9_]{2,31})$/i.exec(text)?.[1]||text;
  const ownCallback=a.callback?.data?.startsWith('ps:')||a.callback?.data==='tpl:'+a.owner+':poll:';
  const pollCommand=/^\/(?:menu|poll|quiz|checklist|pollsave|polluse|polltemplates|polltopics)(?:\s|$)/i.test(text);
  const known=!!templates[code.toLowerCase()];
  if(!a.privateChat&&!a.inPlace){const menu=this.scope.adminKeyboard&&(groupLaunch.test(text)||homeCommands[a.text]);if(a.callback||!menu&&(!known||!this.targets().some(t=>t.groupId===a.groupId&&t.topicId===a.topicId)))return {handled:false,event:u};}
  else if(!ownCallback&&!pollCommand&&!known&&!(d?.active&&!a.callback&&(!text.startsWith('/')||text==='/cancel'))){
   if(d&&(a.callback?.data?.startsWith('tpl:')||text.startsWith('/'))){d.active=false;d.keys={};this.save(d);}
   return {handled:false,event:u};
  }
  let claimed=false,lease=crypto.randomBytes(8).toString('hex');
  try{
   this.store.change('lease_'+a.owner,old=>{check(!old?.until||old.until<Date.now(),'BUSY');return {token:lease,until:Date.now()+120000};});
   this.store.change('event_'+u.update_id,old=>{if(old)return old;claimed=true;return {status:'processing',owner:a.owner,time:Date.now()};});
   if(!claimed)return {handled:true,status:'duplicate'};
   await this.init();if(a.callback?.id)await this.bot('answerCallbackQuery',{callback_query_id:a.callback.id}).catch(()=>{});
   await this.action(a,u);this.store.change('event_'+u.update_id,x=>({...x,status:'handled'}));
   return {handled:true,status:'handled',operatorId:a.owner};
  }catch(e){
   const code=/^POLL_[A-Z_]+$/.test(e.message)?e.message:'POLL_OPERATION_FAILED';
   if(claimed)this.store.change('event_'+u.update_id,x=>({...x,status:'failed',code}));
   await this.tell(a.owner,'⚠️ '+(errorText[code]||'இந்த poll செயலை முடிக்க முடியவில்லை ('+code+'). /poll மூலம் புதிய draft தொடங்கலாம்.')).catch(()=>{});
   return {handled:true,status:'failed',code};
  }finally{this.store.change('lease_'+a.owner,x=>x?.token===lease?{token:'',until:0}:x);}
 }
}
require('./legacy-keyboard').install(Service,authenticate);
module.exports={Service,config,authenticate,errorText};
