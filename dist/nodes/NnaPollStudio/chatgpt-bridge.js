'use strict';
const crypto=require('node:crypto');
const model=require('./model');
const {parsePollText}=require('../NnaTelegramSender/poll-content');
const {check}=model;
const clone=x=>JSON.parse(JSON.stringify(x));
const keys=(x,allowed)=>{check(x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype,'BRIDGE_INPUT');check(Object.keys(x).every(k=>allowed.includes(k)),'BRIDGE_FIELDS');};
const line=(x,max)=>{check(typeof x==='string'&&x.trim().length>0&&x.length<=max&&!/[\r\n\u0000]/.test(x),'BRIDGE_TEXT');return x.trim();};
const bounded=async(p,ms=25000)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('POLL_TIMEOUT')),ms))]);}finally{clearTimeout(timer);}};
const pollSettings=['anonymous','multiple','revote','shuffle','adding','hide','seconds','members','countries','correct','explanation','description'];
const checklistSettings=['othersAppend','othersComplete'];
const fingerprint=d=>crypto.createHash('sha256').update(JSON.stringify({owner:d.owner,sourceText:d.sourceText,sourceEntities:d.sourceEntities,poll:d.poll,settings:d.settings,target:d.target})).digest('hex');
class ChatGPTBridge{
 constructor(service){this.s=service;this.owner=String(service.scope.chatgptOwnerId||'');check(service.scope.chatgptEnabled===true&&this.owner===String(service.c.expectedUserId)&&service.scope.operatorIds.includes(this.owner),'BRIDGE_DISABLED');}
 target(groupId,topicId){check(typeof groupId==='string'&&Number.isSafeInteger(topicId),'BRIDGE_TARGET');const t=this.s.targets().find(t=>t.groupId===groupId&&t.topicId===topicId);check(t,'TOPIC_DISABLED');return {...clone(t),groupTitle:this.s.scope.groups.find(g=>g.id===groupId).title};}
 read(id){check(typeof id==='string'&&/^[a-f0-9]{32}$/.test(id),'BRIDGE_DRAFT_ID');const d=this.s.store.read('chatgpt_draft_'+id);check(d&&d.owner===this.owner&&d.id===id&&d.hash===fingerprint(d),'BRIDGE_DRAFT_MISSING');return d;}
 preview(d){
  const s=d.settings,on=x=>x?'ON':'OFF';
  const lines=[s.type==='quiz'?'❓ Quiz':s.type==='checklist'?'☑️ Checklist':'🗳️ Poll',d.poll.question.text,...d.poll.answers.map((a,i)=>(i+1)+'. '+a.text),'📍 '+d.target.groupTitle+' → '+d.target.title,'👤 வெளியிடுபவர்: @'+this.s.c.expectedUsername];
  if(s.type==='checklist')lines.push('மற்றவர்கள் items சேர்க்கலாம்: '+on(s.othersAppend),'மற்றவர்கள் complete / undo செய்யலாம்: '+on(s.othersComplete));
  else{
   lines.push('Anonymous: '+on(s.anonymous),'Multiple answers: '+on(s.multiple),'Vote மாற்றலாம்: '+on(s.revote),'Shuffle answers: '+on(s.shuffle),'Add new answers: '+on(s.adding),'Timer: '+(s.seconds?s.seconds+' seconds':'OFF'),'முடியும் வரை results மறை: '+on(s.hide),'24 மணி நேர group members மட்டும்: '+on(s.members),'Countries: '+(s.countries.join(', ')||'அனைத்தும்'),'Description: '+(s.description||'இல்லை'));
   if(s.type==='quiz')lines.push('சரியான விடைகள்: '+s.correct.map(i=>(i+1)+'. '+d.poll.answers[i].text).join('; '),'விளக்கம்: '+(s.explanation||'இல்லை'));
  }
  const receipt=this.s.store.read('chatgpt_send_'+d.id);
  return {status:'ok',draftId:d.id,confirmationHash:d.hash,state:receipt?.status||(d.expiresAt>Date.now()?'draft':'expired'),expiresAt:new Date(d.expiresAt).toISOString(),kind:s.type,question:d.poll.question.text,options:d.poll.answers.map(a=>a.text),settings:s,destination:d.target,sender:'@'+this.s.c.expectedUsername,preview:lines.join('\n'),...(receipt?.status==='sent'?{receipt:receipt.receipt}:{}),next_step:'Show all applicable settings and this full preview. Ask the user for changes or explicit publication approval before publish. Uncertain/sending deliveries must never be automatically recreated or retried.'};
 }
 async run(request){
  keys(request,['action','arguments']);const a=request.arguments;check(['list','prepare','get','publish'].includes(request.action),'BRIDGE_ACTION');
  if(request.action==='list'){
   keys(a,[]);
   const defaults=model.defaults();
   return {status:'ok',sender:'@'+this.s.c.expectedUsername,targets:this.s.targets().map(t=>this.target(t.groupId,t.topicId)),types:['poll','quiz','checklist'],defaults:{poll:Object.fromEntries(pollSettings.map(k=>[k,defaults[k]])),quiz:{...Object.fromEntries(pollSettings.map(k=>[k,defaults[k]])),correct:'Ask the user; required zero-based answer indices.'},checklist:Object.fromEntries(checklistSettings.map(k=>[k,defaults[k]]))},limits:{poll:{question:300,optionsMin:2,optionsMax:12,option:100},checklist:{title:255,itemsMin:1,itemsMax:30,item:100}},instructions:'Ask Poll, Quiz or Checklist. Collect content, destination and settings preferences. Explain defaults and obtain agreement or changes; quiz requires correct answers, checklist requires others-add and others-complete preferences. Show prepared preview before asking to publish. Only listed enabled targets are allowed. Enable other topics in TestBot /polltopics.'};
  }
  if(request.action==='prepare'){
   keys(a,['kind','question','options','settings','groupId','topicId']);check(['poll','quiz','checklist'].includes(a.kind),'TYPE');const todo=a.kind==='checklist';
   const question=line(a.question,todo?255:300);check(Array.isArray(a.options)&&a.options.length>=(todo?1:2)&&a.options.length<=(todo?30:12),'OPTION_COUNT');
   const options=a.options.map(o=>line(o,100)),raw=a.settings||{};keys(raw,todo?checklistSettings:pollSettings);
   const settings=model.settings({...raw,type:a.kind}),sourceText=question+'\n'+options.map((o,i)=>(i+1)+'. '+o).join('\n');
   const poll=(todo?require('./checklist').parse:parsePollText)(sourceText,[]);
   check(poll.question.text===question&&JSON.stringify(poll.answers.map(x=>x.text))===JSON.stringify(options),'CONTENT');
   const d={id:crypto.randomBytes(16).toString('hex'),owner:this.owner,sourceText,sourceEntities:[],poll,settings,target:this.target(a.groupId,a.topicId),createdAt:Date.now(),expiresAt:Date.now()+86400000};
   model.validate(d);d.hash=fingerprint(d);this.s.store.change('chatgpt_draft_'+d.id,old=>{check(!old,'BRIDGE_DRAFT_COLLISION');return d;});return this.preview(d);
  }
  keys(a,request.action==='publish'?['draftId','confirmationHash','confirm']:['draftId']);const d=this.read(a.draftId);
  if(request.action==='get')return this.preview(d);
  check(a.confirm===true&&typeof a.confirmationHash==='string'&&a.confirmationHash===d.hash,'BRIDGE_CONFIRMATION');
  const prior=this.s.store.read('chatgpt_send_'+d.id);if(prior)return this.outcome(prior);
  check(d.expiresAt>Date.now(),'BRIDGE_DRAFT_EXPIRED');this.target(d.target.groupId,d.target.topicId);model.validate(d);
  let taken=false;const claim=this.s.store.change('chatgpt_send_'+d.id,old=>{if(old)return old;taken=true;return {status:'sending',owner:this.owner,hash:d.hash,createdAt:Date.now()};});if(!taken)return this.outcome(claim);
  try{
   const receipt=await this.s.personal(client=>(this.s.deps.publish||model.publish)(client,this.s.c,d,d.target,'chatgpt:'+d.id,bounded));
   check(receipt?.status==='sent'&&receipt.senderId===String(this.s.c.expectedUserId)&&receipt.groupId===d.target.groupId&&receipt.topicId===d.target.topicId&&Number.isSafeInteger(receipt.messageId)&&receipt.messageId>0,'DELIVERY_UNCONFIRMED');
   const expected='https://t.me/c/'+d.target.groupId.slice(4)+'/'+d.target.topicId+'/'+receipt.messageId;check(receipt.url===expected,'DELIVERY_UNCONFIRMED');
   this.s.store.change('chatgpt_send_'+d.id,x=>({...x,status:'sent',receipt,finishedAt:Date.now()}));return {status:'ok',state:'sent',receipt,alreadyPublished:false};
  }catch(e){
   const state=this.s.store.read('chatgpt_send_'+d.id);if(state?.status==='sent')return this.outcome(state);
   const error=/^POLL_[A-Z_]+$/.test(e.message)?e.message:'POLL_DELIVERY_UNCONFIRMED';
   this.s.store.change('chatgpt_send_'+d.id,x=>({...x,status:'uncertain',error,finishedAt:Date.now()}));return {status:'error',state:'uncertain',code:error,message:'Publication may have occurred. Check the destination topic; do not recreate or retry this poll automatically.'};
  }
 }
 outcome(x){return x.status==='sent'?{status:'ok',state:'sent',receipt:x.receipt,alreadyPublished:true}:{status:'error',state:x.status,code:'POLL_DELIVERY_UNCONFIRMED',message:'Publication is pending or uncertain. Check the destination topic; do not recreate or retry automatically.'};}
}
module.exports={ChatGPTBridge,fingerprint};
