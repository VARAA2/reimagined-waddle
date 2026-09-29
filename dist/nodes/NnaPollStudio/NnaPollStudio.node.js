'use strict';
const {Service}=require('./service');
class NnaPollStudio{
 constructor(){this.description={displayName:'NNA Poll Studio',name:'nnaPollStudio',group:['transform'],version:1,description:'Prepare polls and quizzes, reuse templates and publish through the fixed personal account',defaults:{name:'NNA Poll Studio'},inputs:['main'],outputs:['main'],credentials:[{name:'telegramApi',required:true},{name:'nnaTelegramSender',required:true}],properties:[
 {displayName:'Operation',name:'operation',type:'options',noDataExpression:true,default:'handle',options:[{name:'ChatGPT Poll Bridge',value:'chatgptBridge',action:'Prepare and publish confirmed ChatGPT polls quizzes and checklists'},{name:'Handle Update',value:'handle',action:'Handle authorized poll commands and template keywords'},{name:'Render Nested Menu',value:'renderLegacy',action:'Render prepared private menu in persistent reply keyboard'},{name:'Render Preview Controls',value:'renderPreview',action:'Show prepared media preview controls in reply keyboard'},{name:'Inspect Scope',value:'inspect',action:'Verify bot sender groups and enabled topics'},{name:'Configure Commands',value:'configureCommands',action:'Add poll and quiz commands preserving existing private commands'}]},
 {displayName:'Scope JSON',name:'scopeJSON',type:'string',default:'',required:true,noDataExpression:true},
 {displayName:'ChatGPT Request JSON',name:'bridgeRequestJSON',type:'string',default:'={{ JSON.stringify($json) }}',required:true,displayOptions:{show:{operation:['chatgptBridge']}}},
 {displayName:'Original Telegram Update JSON',name:'updateJSON',type:'string',default:'={{ JSON.stringify($json) }}',required:true,displayOptions:{show:{operation:['handle']}}},
 {displayName:'Use one n8n instance with a persistent volume. Templates, topic choices and delivery claims are persisted under the n8n user directory. Disable Retry On Fail.',name:'storageNotice',type:'notice',default:''}
 ]};}
 async execute(){
  if(this.getInputData().length!==1||this.getNode().retryOnFail)throw Error('POLL_SINGLE_ITEM_NO_RETRY');
  const operation=this.getNodeParameter('operation',0),scope=JSON.parse(this.getNodeParameter('scopeJSON',0));
  const service=new Service(this,await this.getCredentials('nnaTelegramSender'),await this.getCredentials('telegramApi'),scope);
  if(operation==='chatgptBridge'){
   try{return [[{json:await new (require('./chatgpt-bridge').ChatGPTBridge)(service).run(JSON.parse(this.getNodeParameter('bridgeRequestJSON',0)))}]];}catch(e){return [[{json:{status:'error',code:/^POLL_[A-Z_]+$/.test(e.message)?e.message:'POLL_BRIDGE_FAILED',message:'Poll request could not be completed. Correct the reported input or check draft status; never assume a publication succeeded.'}}]];}
  }
  if(operation==='handle')return [[{json:await service.handle(JSON.parse(this.getNodeParameter('updateJSON',0)))}]];
  if(['renderLegacy','renderPreview'].includes(operation)){const p=await service.renderLegacy(this.getInputData()[0].json,operation==='renderPreview');return [p?[{json:p}]:[]];}
  await service.init();if(operation==='inspect')return [[{json:await service.inspect()}]];
  if(operation==='configureCommands')return [[{json:await service.configureCommands()}]];
  throw Error('POLL_OPERATION');
 }
}
module.exports={NnaPollStudio};
