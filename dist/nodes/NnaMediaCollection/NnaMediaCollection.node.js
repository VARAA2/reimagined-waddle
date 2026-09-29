'use strict';
const {Service}=require('./core');
const operatorMedia=require('./operator-media');
class NnaMediaCollection {
 constructor(){this.description={displayName:'NNA Media Collection',name:'nnaMediaCollection',group:['transform'],version:1,description:'Route private media to selected forum topics as a fixed personal sender; analyze only after a per-media /analyze command',defaults:{name:'NNA Media Collection'},inputs:['main'],outputs:['main'],credentials:[{name:'telegramApi',required:true},{name:'nnaTelegramSender',required:true}],properties:[
  {displayName:'Operation',name:'operation',type:'options',noDataExpression:true,default:'inspect',options:[{name:'Handle Audio Summary',value:'handleAudio'},{name:'Finish Audio Summary',value:'finishAudio'},{name:'Configure Audio Commands',value:'configureAudioCommands'},{name:'Handle Reply Bot Analysis',value:'handleAnalysis',action:'Handle explicit mediareport commands without capturing other bot features'},{name:'Configure Reply Analysis Commands',value:'configureAnalysisCommands',action:'Register distinct mediareport commands preserving existing commands'},{name:'Refresh Pending Topic Buttons',value:'refreshTopics',action:'Refresh the topic buttons for one pending draft'},{name:'Configure Private and Admin Commands',value:'configureCommands',action:'Register private commands and configured group admin menus'},{name:'Inspect Scope',value:'inspect',action:'Verify bot sender and topic scope without posting'},{name:'Handle Media Update',value:'handle',action:'Handle media commands and topic selections'},{name:'Finish Requested Analysis',value:'finish',action:'Store results only for the matching explicitly requested analysis'},{name:'Collect Operator Album',value:'collectOperatorAlbum',action:'Collect one Telegram album per operator draft; later album updates are skipped'},{name:'Preview Operator Album or Audio',value:'previewOperatorMedia',action:'Send a private preview of an album or audio draft with approval buttons'},{name:'Publish Operator Album or Audio',value:'publishOperatorMedia',action:'Post or schedule a claimed album or audio draft as the personal account'}]},
  {displayName:'Scope JSON',name:'scopeJSON',type:'string',default:'',required:true,noDataExpression:true},
  {displayName:'Operator Context JSON',name:'contextJSON',type:'string',default:'={{ JSON.stringify($json) }}',required:true,displayOptions:{show:{operation:['collectOperatorAlbum','previewOperatorMedia']}}},
  {displayName:'Claimed Delivery JSON',name:'deliveryJSON',type:'string',default:'',required:true,displayOptions:{show:{operation:['publishOperatorMedia']}}},
  {displayName:'Claim Execution ID',name:'claimExecutionId',type:'string',default:'',required:true,displayOptions:{show:{operation:['publishOperatorMedia']}}},
  {displayName:'Original Telegram Update JSON',name:'updateJSON',type:'string',default:'={{ JSON.stringify($json) }}',required:true,displayOptions:{show:{operation:['handle','handleAnalysis','handleAudio']}}},
  {displayName:'Job Key',name:'jobKey',type:'string',default:'',required:true,displayOptions:{show:{operation:['finish','finishAudio','refreshTopics']}}},
  {displayName:'Analysis Revision',name:'analysisRevision',type:'number',default:0,required:true,displayOptions:{show:{operation:['finish','finishAudio']}}},
  {displayName:'Analysis Result JSON',name:'analysisJSON',type:'string',default:'={{ JSON.stringify($json) }}',required:true,displayOptions:{show:{operation:['finish','finishAudio']}}},
  {displayName:'Private job state is persisted under the n8n user directory. Use one instance with a persistent volume; do not share this workflow across workers with separate disks. Disable Retry On Fail. /analyze applies to one media only.',name:'storageNotice',type:'notice',default:''}
 ]};}
 async execute(){
  if(this.getInputData().length!==1)throw Error('MEDIA_SINGLE_ITEM_REQUIRED');
  if(this.getNode().retryOnFail)throw Error('MEDIA_DISABLE_RETRY_ON_FAIL');
  if(operatorMedia.OPERATIONS.includes(this.getNodeParameter('operation',0)))return [[{json:await operatorMedia.run(this,this.getNodeParameter('operation',0))}]];
  if(this.getNodeParameter('operation',0)==='handleAudio'){
   const u=JSON.parse(this.getNodeParameter('updateJSON',0)),s=JSON.parse(this.getNodeParameter('scopeJSON',0)),m=u?.message;
   if(!m||!s.operatorIds?.includes(String(m.from?.id))||m.from?.is_bot||!['private','supergroup'].includes(m.chat?.type))return [[{json:{next:0,audioHandled:false,event:u}}]];
  }
  if(this.getNodeParameter('operation',0)==='handleAnalysis'){
   const u=JSON.parse(this.getNodeParameter('updateJSON',0)),scope=JSON.parse(this.getNodeParameter('scopeJSON',0));
   const cb=u?.callback_query,m=cb?.message||u?.message,actor=cb?.from||m?.from;
   const relevant=actor&&!actor.is_bot&&scope.operatorIds?.includes(String(actor.id))&&(
    m?.chat?.type==='private'&&(!cb||/^mc:/.test(cb.data||''))||
    m?.chat?.type==='supergroup'&&(scope.groupReplies===true||!cb&&/^\/(mediareport|cancelmedia)(?:@\w+)?$/i.test((m.text||'').trim())));
   if(!relevant)return [[{json:{next:0,analysisHandled:false,event:u}}]];
  }
  const c=await this.getCredentials('nnaTelegramSender'),b=await this.getCredentials('telegramApi');
  let service;
  try{
   service=await new Service(this,c,b,JSON.parse(this.getNodeParameter('scopeJSON',0))).init();
   const operation=this.getNodeParameter('operation',0);
   if(operation==='configureAudioCommands')return [[{json:await service.configureAudioCommands()}]];
   if(operation==='handleAudio')return [[await service.handleAudio(JSON.parse(this.getNodeParameter('updateJSON',0)))]];
   if(operation==='finishAudio')return [[{json:await service.finishAudio(this.getNodeParameter('jobKey',0),this.getNodeParameter('analysisRevision',0),JSON.parse(this.getNodeParameter('analysisJSON',0)))}]];
   if(operation==='configureAnalysisCommands')return [[{json:await service.configureAnalysisCommands()}]];
   if(operation==='handleAnalysis')return [[await service.handleAnalysis(JSON.parse(this.getNodeParameter('updateJSON',0)))]];
   if(operation==='configureCommands')return [[{json:await service.configureCommands()}]];
   if(operation==='refreshTopics')return [[{json:await service.refreshTopicButtons(this.getNodeParameter('jobKey',0))}]];
   if(operation==='inspect')return [[{json:await service.inspect()}]];
   if(operation==='finish')return [[{json:await service.finish(this.getNodeParameter('jobKey',0),this.getNodeParameter('analysisRevision',0),JSON.parse(this.getNodeParameter('analysisJSON',0)))}]];
   if(operation==='handle')return [[await service.handle(JSON.parse(this.getNodeParameter('updateJSON',0)))]];
   throw Error('MEDIA_OPERATION');
  }catch(e){
   const code=/^MEDIA_[A-Z_]+$/.test(e.message)?e.message:'MEDIA_OPERATION_FAILED';
   if(service&&['handle','handleAnalysis'].includes(this.getNodeParameter('operation',0))){
    let u;try{u=JSON.parse(this.getNodeParameter('updateJSON',0));}catch{}
    const actor=u?.callback_query?.from||u?.message?.from;
    const chat=u?.callback_query?.message?.chat||u?.message?.chat;
    if(actor&&!actor.is_bot&&service.scope.operatorIds.includes(String(actor.id))&&(chat?.type==='private'||service.replyContext))await service.tell(String(actor.id),'⚠️ இந்த செயலை முடிக்க முடியவில்லை ('+code+'). பழைய button என்றால் புதிய media-வை அனுப்புங்கள்.').catch(()=>{});
   }
   throw Error(code);
  }
 }
}
module.exports={NnaMediaCollection};
