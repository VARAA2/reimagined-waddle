'use strict';
const crypto=require('node:crypto');
const UPDATES=['message','edited_message','callback_query','chat_member','my_chat_member'];
function tokenFor(accessToken,url){return crypto.createHmac('sha256',accessToken).update('nna-monitor-v1:'+url).digest('hex');}
function accepts(update,scope){
 if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)return false;
 const kind=UPDATES.find(k=>update[k]);if(!kind)return false;
 const m=update[kind];const chat=kind==='callback_query'?m.message?.chat:m.chat;
 if(!scope.chats.includes(chat?.id))return false;
 if([scope.ownerId,...(scope.additionalOwnerIds||[])].includes(chat.id))return chat.type==='private'&&(kind==='message'||kind==='callback_query');
 if(chat.type!=='supergroup')return false;
 if(kind==='chat_member'||kind==='my_chat_member')return chat.id===scope.membershipChatId;
 return true;
}
async function api(ctx,method,body){
 const c=await ctx.getCredentials('telegramApi');
 const botId=ctx.getNodeParameter('expectedBotId');
 if(!Number.isSafeInteger(botId)||botId<=0||typeof c.accessToken!=='string'||!c.accessToken.startsWith(botId+':'))throw new Error('NNA_MONITOR_WRONG_BOT');
 try {const r=await ctx.helpers.httpRequest({method:'POST',url:'https://api.telegram.org/bot'+c.accessToken+'/'+method,body,json:true,timeout:20000});
  if(!r?.ok)throw new Error('request failed');return r.result;
 } catch {throw new Error('NNA_MONITOR_TELEGRAM_REQUEST_FAILED_'+method);}
}
class NnaTelegramMonitor {
 constructor(){
 this.description={displayName:'NNA Telegram Group Monitor',name:'nnaTelegramMonitor',group:['trigger'],version:1,
 description:'Receive authenticated updates for configured NNA groups, including member status changes',
 defaults:{name:'NNA Telegram Group Monitor'},inputs:[],outputs:['main'],credentials:[{name:'telegramApi',required:true}],
 webhooks:[{name:'default',httpMethod:'POST',responseMode:'onReceived',path:'webhook'}],
 properties:[{displayName:'One receiver per bot. Subscribes to message, edit, callback and membership events. Membership events require bot admin access.',name:'scopeNotice',type:'notice',default:''},
 {displayName:'Expected Bot ID',name:'expectedBotId',type:'number',default:0,required:true,noDataExpression:true},
 {displayName:'Owner ID',name:'ownerId',type:'number',default:0,required:true,noDataExpression:true},
 {displayName:'Additional Operator IDs',name:'additionalOwnerIds',type:'string',default:'',noDataExpression:true,description:'Comma-separated verified numeric Telegram user IDs'},
 {displayName:'Additional Group IDs',name:'additionalGroupIds',type:'string',default:'',noDataExpression:true,description:'Comma-separated allowed supergroup IDs; does not enable membership events for these groups'},
 {displayName:'Main Group ID',name:'membershipChatId',type:'number',default:0,required:true,noDataExpression:true},
 {displayName:'Review Group ID',name:'reviewChatId',type:'number',default:0,required:true,noDataExpression:true}]};
 this.webhookMethods={default:{
 async checkExists(){const r=await api(this,'getWebhookInfo',{});return r.url===this.getNodeWebhookUrl('default')&&UPDATES.every(k=>(r.allowed_updates||[]).includes(k));},
 async create(){const url=this.getNodeWebhookUrl('default');if(!url||new URL(url).protocol!=='https:')throw new Error('NNA_MONITOR_HTTPS_REQUIRED');
 const me=await api(this,'getMe',{});if(me.id!==this.getNodeParameter('expectedBotId')||me.is_bot!==true)throw new Error('NNA_MONITOR_WRONG_BOT');
 const c=await this.getCredentials('telegramApi');await api(this,'setWebhook',{url,secret_token:tokenFor(c.accessToken,url),allowed_updates:UPDATES,drop_pending_updates:false,max_connections:1});return true;},
 async delete(){const r=await api(this,'getWebhookInfo',{});if(r.url===this.getNodeWebhookUrl('default'))await api(this,'deleteWebhook',{drop_pending_updates:false});return true;}
 }};
 }
 async webhook(){const c=await this.getCredentials('telegramApi');const expected=Buffer.from(tokenFor(c.accessToken,this.getNodeWebhookUrl('default')));const received=Buffer.from(String(this.getHeaderData()['x-telegram-bot-api-secret-token']||''));
 if(expected.length!==received.length||!crypto.timingSafeEqual(expected,received)){this.getResponseObject().status(403).json({message:'Invalid webhook authentication'});return {noWebhookResponse:true};}
 const ownerId=this.getNodeParameter('ownerId'),membershipChatId=this.getNodeParameter('membershipChatId'),reviewChatId=this.getNodeParameter('reviewChatId');
 if(![ownerId,membershipChatId,reviewChatId].every(Number.isSafeInteger)||ownerId<=0||membershipChatId>=0||reviewChatId>=0)throw new Error('NNA_MONITOR_INVALID_ALLOWLIST');
 const extra=String(this.getNodeParameter('additionalOwnerIds','')||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(extra.length>20||!extra.every(x=>/^[1-9]\d{0,15}$/.test(x)&&Number.isSafeInteger(Number(x))))throw new Error('NNA_MONITOR_INVALID_OPERATORS');
 const additionalOwnerIds=extra.map(Number);
 const groups=String(this.getNodeParameter('additionalGroupIds','')||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(groups.length>20||!groups.every(x=>/^-100[1-9]\d+$/.test(x)&&Number.isSafeInteger(Number(x))))throw new Error('NNA_MONITOR_INVALID_GROUPS');
 const additionalGroupIds=groups.map(Number);
 const body=this.getBodyData();if(!accepts(body,{ownerId,additionalOwnerIds,membershipChatId,chats:[ownerId,...additionalOwnerIds,membershipChatId,reviewChatId,...additionalGroupIds]}))return {};return {workflowData:[[{json:body}]]};}
}
module.exports={NnaTelegramMonitor,accepts,tokenFor,UPDATES};
