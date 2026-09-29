'use strict';
const check=(ok,code)=>{if(!ok)throw Error('MEDIA_'+code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const groups=scope=>[scope,...(scope.additionalGroups||[])];
function validateGroups(scope){
 check(scope.additionalGroups===undefined||Array.isArray(scope.additionalGroups)&&scope.additionalGroups.length<=10,'ADDITIONAL_GROUPS');
 const ids=new Set([scope.groupId]);
 for(const g of scope.additionalGroups||[]){
  check(g&&typeof g.groupId==='string'&&/^-100[1-9]\d{0,15}$/.test(g.groupId)&&!ids.has(g.groupId),'ADDITIONAL_GROUP');ids.add(g.groupId);
  check(g.allTopics===undefined||typeof g.allTopics==='boolean','ADDITIONAL_TOPICS');
  check(Array.isArray(g.topicIds)&&g.topicIds.every(positive)&&(g.allTopics===true||g.topicIds.length>0)&&new Set(g.topicIds).size===g.topicIds.length,'ADDITIONAL_TOPICS');
  check(g.label===undefined||typeof g.label==='string'&&g.label.trim().length>0&&g.label.length<=80,'GROUP_LABEL');
 }
 for(const name of ['defaultTopicOrder','fullWidthTopicKeys']){
  const keys=scope[name];check(keys===undefined||Array.isArray(keys)&&keys.length<=90&&new Set(keys.map(String)).size===keys.length,'TOPIC_LAYOUT');
  for(const key of keys||[])resolveDestination(scope,key);
 }
 check(scope.topicOrderRevision===undefined||typeof scope.topicOrderRevision==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(scope.topicOrderRevision),'TOPIC_ORDER_REVISION');
}
function assertDestination(scope,groupId,topicId){
 const g=groups(scope).find(g=>g.groupId===groupId);
 check(g&&positive(topicId)&&(g.allTopics===true||g.topicIds.includes(topicId)),'DESTINATION');
 return {groupId,topicId};
}
function resolveDestination(scope,key){
 const match=/^(?:([1-9]\d*)|g([1-9]\d{0,15})_([1-9]\d*))$/.exec(String(key));check(match,'DESTINATION');
 return assertDestination(scope,match[1]?scope.groupId:'-100'+match[2],Number(match[1]||match[3]));
}
const topicKey=t=>t.key??t.id;
const matchesTopic=(t,scope,groupId,topicId)=>t.id===topicId&&(t.groupId||scope.groupId)===groupId&&!t.hidden&&!t.closed;
function topicTitle(t,topics){
 if(!topics.some(x=>x!==t&&x.title===t.title))return t.title;
 return t.title+' · '+(t.groupLabel||'Topic')+' · '+(t.groupId?t.groupId.slice(4)+'/':'')+t.id;
}
module.exports={groups,validateGroups,assertDestination,resolveDestination,topicKey,matchesTopic,topicTitle};
