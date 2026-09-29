'use strict';
function parsePollText(text,rawEntities=[]){
 if(typeof text!=='string'||!text.trim()||text.length>4096||!Array.isArray(rawEntities))throw Error('POLL_INPUT');
 const lines=[];let offset=0;for(const line of text.split('\n')){lines.push({line,start:offset});offset+=line.length+1;}
 const option=/^\s*(?:([A-Za-z])\s*[.):\-]|(\d{1,2})\s*[.):\-]|([•●▪*\-]))\s+(.+?)\s*$/;
 const first=lines.findIndex(x=>option.test(x.line));if(first<1)throw Error('POLL_QUESTION_AND_OPTIONS');
 const range=(start,end)=>{const s=text.slice(start,end),left=s.length-s.trimStart().length,right=s.trimEnd().length;const a=start+left,b=start+right;const entities=rawEntities.filter(e=>e.type==='custom_emoji'&&e.offset>=a&&e.offset+e.length<=b).map(e=>({...e,offset:e.offset-a}));return {text:text.slice(a,b),entities};};
 const question=range(0,lines[first].start),answers=[];let kind='';
 for(const {line,start} of lines.slice(first)){
  if(!line.trim())continue;const m=option.exec(line);if(!m)throw Error('POLL_OPTION_LINE');
  const current=m[1]?'alpha':m[2]?'number':'bullet';if(kind&&kind!==current)throw Error('POLL_LABELS');kind=current;
  if(kind==='alpha'&&m[1].toUpperCase().charCodeAt(0)!==65+answers.length||kind==='number'&&Number(m[2])!==answers.length+1)throw Error('POLL_LABELS');
  const pos=line.indexOf(m[4],m[0].length-m[4].length-(line.length-line.trimEnd().length));
  if(pos<0)throw Error('POLL_INPUT');answers.push(range(start+pos,start+pos+m[4].length));
 }
 if(question.text.length<1||question.text.length>300)throw Error('POLL_QUESTION_LENGTH');
 if(answers.length<2||answers.length>12)throw Error('POLL_OPTION_COUNT');
 if(answers.some(a=>!a.text||a.text.length>100))throw Error('POLL_OPTION_LENGTH');
 if(new Set(answers.map(a=>a.text.normalize('NFC').toLocaleLowerCase())).size!==answers.length)throw Error('POLL_DUPLICATE_OPTION');
 return {question,answers};
}
module.exports={parsePollText};
