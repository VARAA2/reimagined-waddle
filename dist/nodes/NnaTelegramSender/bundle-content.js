'use strict';
// Formatting-preserving insertion into a single, pre-approved link slot.
function fillLink(part,url){
 if(!part||typeof part.text!=='string'||!Array.isArray(part.entities)||!Number.isInteger(part.linkOffset)||!Number.isInteger(part.linkLength)||part.linkOffset<0||part.linkLength<1||part.linkOffset+part.linkLength>part.text.length)throw Error('NNA_BUNDLE_LINK_SLOT');
 if(!/^https:\/\/t\.me\/c\/[1-9]\d*\/[1-9]\d*\/[1-9]\d*$/.test(url)||url.length>90)throw Error('NNA_BUNDLE_LINK_INVALID');
 const a=part.linkOffset,b=a+part.linkLength,delta=url.length-part.linkLength;
 const entities=part.entities.map(e=>{if(e.offset<b&&e.offset+e.length>a)throw Error('NNA_BUNDLE_LINK_OVERLAP');return {...e,offset:e.offset>=b?e.offset+delta:e.offset};});
 const text=part.text.slice(0,a)+url+part.text.slice(b);
 if(text.length>4096)throw Error('NNA_BUNDLE_TEXT_TOO_LONG');
 entities.push({type:'url',offset:a,length:url.length});return {text,entities};
}
function checkPart(part){
 if(!part||part.text.length-part.linkLength+90>4096)throw Error('NNA_BUNDLE_TEXT_TOO_LONG');
 fillLink(part,'https://t.me/c/123/1/1');return part;
}
module.exports={fillLink,checkPart};
