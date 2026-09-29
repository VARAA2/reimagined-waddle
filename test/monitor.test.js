'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {NnaTelegramMonitor,accepts:baseAccepts,tokenFor,UPDATES}=require('../dist/nodes/NnaTelegramMonitor/NnaTelegramMonitor.node');
const scope={ownerId:5845920581,membershipChatId:-1001417810280,chats:[5845920581,-1001417810280,-1004373500275]};const accepts=u=>baseAccepts(u,scope);
test('additional operator gets private updates without opening other private accounts',()=>{
 const s={...scope,additionalOwnerIds:[852744709],chats:[...scope.chats,852744709]};
 assert.equal(baseAccepts({update_id:1,message:{chat:{id:852744709,type:'private'}}},s),true);
 assert.equal(baseAccepts({update_id:1,message:{chat:{id:999999,type:'private'}}},s),false);
});
test('member events require allowed main supergroup and valid update id',()=>{
 const u={update_id:5,chat_member:{chat:{id:-1001417810280,type:'supergroup'}}};assert.equal(accepts(u),true);
 for(const id of [-1004373500275,-1001,5845920581])assert.equal(accepts({...u,chat_member:{chat:{id,type:'supergroup'}}}),false);
 assert.equal(accepts({...u,update_id:'5'}),false);assert.ok(UPDATES.includes('chat_member'));
});
test('unknown groups and private non-owner chats do not enter',()=>{
 const u={update_id:1,message:{chat:{id:5845920581,type:'private'}}};assert.equal(accepts(u),true);
 assert.equal(accepts({...u,message:{chat:{id:123,type:'private'}}}),false);
 assert.equal(accepts({...u,message:{chat:{id:-1004373500275,type:'supergroup'}}}),true);
});
test('webhook token is host-bound, credential-bound and fail closed',async()=>{
 const node=new NnaTelegramMonitor();const url='https://host.example/webhook/1',key='fake-key';
 assert.notEqual(tokenFor(key,url),tokenFor('different',url));assert.notEqual(tokenFor(key,url),tokenFor(key,url+'2'));
 let status;const ctx={getNodeParameter:n=>({expectedBotId:6224563564,ownerId:5845920581,membershipChatId:-1001417810280,reviewChatId:-1004373500275}[n]),getCredentials:async()=>({accessToken:key}),getNodeWebhookUrl:()=>url,getHeaderData:()=>({'x-telegram-bot-api-secret-token':'wrong'}),getResponseObject:()=>({status:s=>(status=s,{json:()=>{}})})};
 assert.deepEqual(await node.webhook.call(ctx),{noWebhookResponse:true});assert.equal(status,403);
 ctx.getHeaderData=()=>({'x-telegram-bot-api-secret-token':tokenFor(key,url)});ctx.getBodyData=()=>({update_id:1,message:{chat:{id:5845920581,type:'private'}}});
 assert.equal((await node.webhook.call(ctx)).workflowData[0][0].json.update_id,1);
});
test('registration preserves pending updates and explicit membership subscription',async()=>{
 const node=new NnaTelegramMonitor();const calls=[];const ctx={getNodeParameter:n=>({expectedBotId:6224563564}[n]),getNodeWebhookUrl:()=> 'https://whitesmoke-gerbil-365996.hostingersite.com/webhook/test',getCredentials:async()=>({accessToken:'6224563564:fake'}),helpers:{httpRequest:async req=>{calls.push(req);return {ok:true,result:req.url.endsWith('getMe')?{id:6224563564,is_bot:true}:true};}}};
 assert.equal(await node.webhookMethods.default.create.call(ctx),true);const b=calls[1].body;assert.equal(b.drop_pending_updates,false);assert.equal(b.max_connections,1);assert.ok(b.allowed_updates.includes('chat_member'));assert.match(b.secret_token,/^[a-f0-9]{64}$/);
});
