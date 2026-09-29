'use strict';
const {run}=require('./reader');
class NnaMediaReader {
 constructor(){this.description={displayName:'NNA Media Reader',name:'nnaMediaReader',group:['transform'],version:1,description:'Read scoped private forum captions and photos for ChatGPT without posting',defaults:{name:'NNA Media Reader'},inputs:['main'],outputs:['main'],credentials:[{name:'nnaTelegramSender',required:true}],properties:[
  {displayName:'Scope JSON',name:'scopeJSON',type:'string',default:'',required:true,noDataExpression:true},
  {displayName:'Request JSON',name:'requestJSON',type:'string',default:'={{ $json.requestJSON }}',required:true}
 ]};}
 async execute(){
  if(this.getInputData().length!==1)throw Error('NNA_READER_SINGLE_REQUEST');
  const credentials=await this.getCredentials('nnaTelegramSender');
  const result=await run(credentials,JSON.parse(this.getNodeParameter('scopeJSON',0)),JSON.parse(this.getNodeParameter('requestJSON',0)));
  if(result.status==='audio_downloaded'){const {audioBytes,mimeType,...json}=result;const binary=await this.helpers.prepareBinaryData(audioBytes,'audio.'+({'audio/mp3':'mp3','audio/ogg':'ogg','audio/mp4':'m4a','audio/wav':'wav','audio/flac':'flac','audio/aac':'aac','audio/webm':'webm'}[mimeType]),mimeType);return [[{json,binary:{data:binary}}]];}
  return [[{json:result}]];
 }
}
module.exports={NnaMediaReader};
