'use strict';
const {utils}=require('teleproto'),contract=require('../NnaMediaCollection/audio-contract');
const check=(ok,code)=>{if(!ok)throw Error('NNA_READER_AUDIO_'+code);};
async function read(client,peer,scope,request,ts,bounded,topicOf){
 const link=contract.parseLink(request.url);check(link.groupId===scope.groupId,'SCOPE');
 const messages=await bounded(client.getMessages(peer,{ids:[link.messageId]}));const m=messages.find(x=>x.id===link.messageId);
 check(m?.className==='Message'&&String(utils.getPeerId(m.peerId))===scope.groupId,'MISSING');
 const topic=topicOf(m);check(!link.topicId||link.topicId===topic,'TOPIC');check(ts.some(t=>t.id===topic),'TOPIC');
 const doc=m.media?.document,attrs=doc?.attributes||[],audio=attrs.find(a=>a.className==='DocumentAttributeAudio');
 check(audio&&!attrs.some(a=>a.className==='DocumentAttributeVideo')&&/^audio\//.test(doc.mimeType||''),'REQUIRED');
 contract.limits(Number(doc.size),Number(audio.duration));
 const bytes=await bounded(client.downloadMedia(m,{signal:AbortSignal.timeout(60000)}),62000),mimeType=contract.audioMime(bytes,doc.mimeType);
 let sender;try{sender=await bounded(m.getSender?.()||Promise.resolve(null));}catch{}
 const senderId=m.fromId?String(utils.getPeerId(m.fromId)):'';
 const metadata={group_id:scope.groupId,group_name:scope.groupName,topic_id:topic,topic_name:ts.find(t=>t.id===topic)?.name||String(topic),message_id:m.id,sender_id:senderId,sender:[sender?.firstName,sender?.lastName].filter(Boolean).join(' ')||sender?.title||m.postAuthor||'Unknown',username:sender?.username||'',posted_at:new Date(m.date*1000).toISOString(),timezone:'Asia/Kolkata',duration_seconds:Number(audio.duration),caption:m.message||'',voice_note:!!audio.voice,source_url:'https://t.me/c/'+scope.groupId.slice(4)+'/'+topic+'/'+m.id};
 return {status:'audio_downloaded',metadata,prompt:contract.prompt,audioBytes:bytes,mimeType};
}
module.exports={read};
