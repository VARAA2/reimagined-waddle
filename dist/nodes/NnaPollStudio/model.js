'use strict';
const {Api,utils}=require('teleproto'),bigInt=require('big-integer');
const {parsePollText}=require('../NnaTelegramSender/poll-content');
const {caption,entityMatches,groupPeer,randomId}=require('../NnaTelegramSender/media-publish');
const check=(ok,code)=>{if(!ok)throw Error('POLL_'+code);};
const defaults=()=>({type:'poll',anonymous:true,multiple:false,revote:false,shuffle:true,adding:false,hide:false,seconds:0,members:false,countries:[],correct:[],explanation:'',description:'',othersAppend:false,othersComplete:false});
function settings(raw={}){
 const s={...defaults(),...raw};
 check(['poll','quiz','checklist'].includes(s.type),'TYPE');
 for(const k of ['anonymous','multiple','revote','shuffle','adding','hide','members','othersAppend','othersComplete'])check(typeof s[k]==='boolean','SETTINGS');
 check(Number.isSafeInteger(s.seconds)&&(s.seconds===0||s.seconds>=5&&s.seconds<=2628000),'TIMER');
 check(!s.hide||s.seconds>0,'HIDE_NEEDS_TIMER');
 check(Array.isArray(s.countries)&&s.countries.length<=50&&s.countries.every(x=>/^[A-Z]{2}$/.test(x)),'COUNTRIES');
 check(typeof s.explanation==='string'&&s.explanation.length<=200&&s.explanation.split('\n').length<=3,'EXPLANATION');
 check(typeof s.description==='string'&&s.description.length<=1024,'DESCRIPTION');
 check(!s.adding||s.type==='poll','QUIZ_ADDING');
 return s;
}
function validate(d){
 const s=settings(d.settings),p=(s.type==='checklist'?require('./checklist').parse:parsePollText)(d.sourceText,d.sourceEntities||[]);
 check(JSON.stringify(p)===JSON.stringify(d.poll),'CONTENT');
 if(s.type==='quiz'){
  check(Array.isArray(s.correct)&&s.correct.length>=1&&new Set(s.correct).size===s.correct.length&&s.correct.every(x=>Number.isSafeInteger(x)&&x>=0&&x<p.answers.length),'CORRECT');
  check(s.multiple||s.correct.length===1,'CORRECT_SINGLE');
 }else check(s.correct.length===0,'POLL_CORRECT');
 return {poll:p,settings:s};
}
function correct(text,count){const xs=String(text).trim().toUpperCase().split(/[\s,]+/).filter(Boolean).map(x=>/^[A-L]$/.test(x)?x.charCodeAt(0)-65:/^\d{1,2}$/.test(x)?Number(x)-1:-1);check(xs.length>0&&new Set(xs).size===xs.length&&xs.every(x=>x>=0&&x<count),'CORRECT');return xs;}
function matches(actual,d){
 const s=settings(d.settings),eq=(got,want)=>got?.text===want.text&&caption(want.text,want.entities).every(e=>entityMatches(got.entities,e));
 return actual?.className==='Poll'&&!actual.closed&&!!actual.publicVoters===!s.anonymous&&!!actual.multipleChoice===s.multiple&&!!actual.quiz===(s.type==='quiz')&&!!actual.openAnswers===s.adding&&!!actual.revotingDisabled===!s.revote&&!!actual.shuffleAnswers===s.shuffle&&!!actual.hideResultsUntilClose===s.hide&&!!actual.subscribersOnly===s.members&&JSON.stringify([...(actual.countriesIso2||[])].sort())===JSON.stringify([...s.countries].sort())&&(s.seconds?(actual.closePeriod===s.seconds||Number(actual.closeDate)>0):(!actual.closePeriod&&!actual.closeDate))&&eq(actual.question,d.poll.question)&&actual.answers.length===d.poll.answers.length&&d.poll.answers.every((a,i)=>actual.answers.some(g=>(s.type==='quiz'||Buffer.from(g.option).equals(Buffer.from([i])))&&eq(g.text,a)));
}
async function publish(client,c,d,target,key,bounded){
 validate(d);if(d.settings.type==='checklist')return require('./checklist').publish(client,c,d,target,key,bounded);
 const {poll:p,settings:s}=validate(d),peer=await groupPeer(client,target.groupId,bounded);
 const topics=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[target.topicId]})));
 const topic=topics.topics?.find(t=>t.className==='ForumTopic'&&t.id===target.topicId);check(topic&&!topic.closed,'TOPIC_CLOSED');
 const text=x=>new Api.TextWithEntities({text:x.text,entities:caption(x.text,x.entities)});
 const poll=new Api.Poll({id:bigInt(0),hash:bigInt(0),closed:false,publicVoters:!s.anonymous,multipleChoice:s.multiple,quiz:s.type==='quiz',openAnswers:s.adding,revotingDisabled:!s.revote,shuffleAnswers:s.shuffle,hideResultsUntilClose:s.hide,subscribersOnly:s.members,countriesIso2:s.countries.length?s.countries:undefined,closePeriod:s.seconds||undefined,question:text(p.question),answers:p.answers.map((a,i)=>s.type==='quiz'?new Api.InputPollAnswer({text:text(a)}):new Api.PollAnswer({text:text(a),option:Buffer.from([i])}))});
 const media=new Api.InputMediaPoll({poll,correctAnswers:s.type==='quiz'?s.correct:undefined,solution:s.type==='quiz'&&s.explanation?s.explanation:undefined,solutionEntities:s.type==='quiz'&&s.explanation?[]:undefined});
 const rid=randomId(c.expectedUserId,'poll-studio:'+key);
 const result=await bounded(client.invoke(new Api.messages.SendMedia({peer,media,message:s.description,randomId:rid,sendAs:new Api.InputPeerSelf(),replyTo:new Api.InputReplyToMessage({replyToMsgId:target.topicId,topMsgId:target.topicId})})));
 const id=result.updates?.find(x=>x.className==='UpdateMessageID'&&String(x.randomId)===String(rid))?.id||result.updates?.find(x=>x.message?.out&&x.message?.media?.className==='MessageMediaPoll')?.message?.id;
 check(Number.isSafeInteger(id)&&id>0,'DELIVERY_UNCONFIRMED');
 const [m]=await bounded(client.getMessages(peer,{ids:[id]}));
 check(m?.out&&String(m.fromId?.userId)===String(c.expectedUserId)&&String(utils.getPeerId(m.peerId))===target.groupId&&Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===target.topicId&&m.message===s.description&&matches(m.media?.poll,d),'DELIVERY_UNCONFIRMED');
 if(s.type==='quiz'){
  const marked=(m.media.results?.results||[]).filter(x=>x.correct).map(x=>d.poll.answers.findIndex(a=>m.media.poll.answers.some(g=>Buffer.from(g.option).equals(Buffer.from(x.option))&&g.text.text===a.text))).sort((a,b)=>a-b);
  check(JSON.stringify(marked)===JSON.stringify([...s.correct].sort((a,b)=>a-b)),'QUIZ_UNCONFIRMED');
  check((m.media.results?.solution||'')===s.explanation,'QUIZ_UNCONFIRMED');
 }
 return {status:'sent',messageId:id,pollId:String(m.media.poll.id),senderId:String(c.expectedUserId),groupId:target.groupId,topicId:target.topicId,settings:s,url:'https://t.me/c/'+target.groupId.slice(4)+'/'+target.topicId+'/'+id};
}
module.exports={check,defaults,settings,validate,correct,matches,publish};
