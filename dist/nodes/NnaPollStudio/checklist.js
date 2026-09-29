'use strict';
const {Api,utils}=require('teleproto');
const {caption,entityMatches,groupPeer,randomId}=require('../NnaTelegramSender/media-publish');
const check=(v,c)=>{if(!v)throw Error('POLL_'+c);};
function parse(text,entities=[]){
 check(typeof text==='string'&&text.length<=4096&&Array.isArray(entities),'CHECKLIST_INPUT');
 const lines=[];let offset=0;for(const line of text.split('\n')){if(line.trim())lines.push({line,start:offset});offset+=line.length+1;}
 check(lines.length>=2&&lines.length<=31,'CHECKLIST_COUNT');
 const range=(line,start)=>{const left=line.length-line.trimStart().length,t=line.trim(),at=start+left;return {text:t,entities:entities.filter(e=>e.type==='custom_emoji'&&e.offset>=at&&e.offset+e.length<=at+t.length).map(e=>({...e,offset:e.offset-at}))};};
 const question=range(lines[0].line,lines[0].start);check(question.text.length<=255,'CHECKLIST_TITLE');
 const answers=lines.slice(1).map(({line,start},i)=>{const m=/^\s*(?:(\d{1,2})[.)]|([•●▪*\-]))\s+/.exec(line);check(m&&(!m[1]||Number(m[1])===i+1),'CHECKLIST_LABELS');const item=range(line.slice(m[0].length),start+m[0].length);check(item.text.length>=1&&item.text.length<=100,'CHECKLIST_ITEM');return item;});
 return {question,answers};
}
function matches(actual,d){const eq=(a,b)=>a?.text===b.text&&caption(b.text,b.entities).every(e=>entityMatches(a.entities,e));return actual?.className==='TodoList'&&!!actual.othersCanAppend===d.settings.othersAppend&&!!actual.othersCanComplete===d.settings.othersComplete&&eq(actual.title,d.poll.question)&&actual.list.length===d.poll.answers.length&&actual.list.every((a,i)=>a.id===i+1&&eq(a.title,d.poll.answers[i]));}
async function publish(client,c,d,target,key,bounded){
 check((await bounded(client.getMe())).premium,'PREMIUM_REQUIRED');
 const peer=await groupPeer(client,target.groupId,bounded),topics=await bounded(client.invoke(new Api.messages.GetForumTopicsByID({peer,topics:[target.topicId]})));
 check(topics.topics?.some(t=>t.className==='ForumTopic'&&t.id===target.topicId&&!t.closed),'TOPIC_CLOSED');
 const text=x=>new Api.TextWithEntities({text:x.text,entities:caption(x.text,x.entities)}),todo=new Api.TodoList({othersCanAppend:d.settings.othersAppend,othersCanComplete:d.settings.othersComplete,title:text(d.poll.question),list:d.poll.answers.map((a,i)=>new Api.TodoItem({id:i+1,title:text(a)}))}),rid=randomId(c.expectedUserId,'poll-studio:'+key);
 const result=await bounded(client.invoke(new Api.messages.SendMedia({peer,media:new Api.InputMediaTodo({todo}),message:'',randomId:rid,sendAs:new Api.InputPeerSelf(),replyTo:new Api.InputReplyToMessage({replyToMsgId:target.topicId,topMsgId:target.topicId})})));
 const id=result.updates?.find(x=>x.className==='UpdateMessageID'&&String(x.randomId)===String(rid))?.id;check(Number.isSafeInteger(id)&&id>0,'DELIVERY_UNCONFIRMED');
 const [m]=await bounded(client.getMessages(peer,{ids:[id]}));
 check(m?.out&&String(m.fromId?.userId)===String(c.expectedUserId)&&String(utils.getPeerId(m.peerId))===target.groupId&&Number(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===target.topicId&&matches(m.media?.todo,d)&&!(m.media.completions||[]).length,'DELIVERY_UNCONFIRMED');
 return {status:'sent',messageId:id,senderId:String(c.expectedUserId),groupId:target.groupId,topicId:target.topicId,settings:d.settings,url:'https://t.me/c/'+target.groupId.slice(4)+'/'+target.topicId+'/'+id};
}
module.exports={parse,matches,publish};
