'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const safeKey=k=>typeof k==='string'&&/^[a-z0-9_-]{1,80}$/.test(k);
class Store {
 constructor(botId,root){
  if(!/^\d+$/.test(String(botId)))throw Error('MEDIA_BOT_ID');
  this.root=path.resolve(root||path.join(process.env.N8N_USER_FOLDER||os.homedir(),'.n8n','nna-media-collection',String(botId)));
  fs.mkdirSync(this.root,{recursive:true,mode:0o700});
 }
 file(k,suffix='.json'){if(!safeKey(k))throw Error('MEDIA_INVALID_KEY');return path.join(this.root,k+suffix);}
 read(k){try{return JSON.parse(fs.readFileSync(this.file(k),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('MEDIA_STATE_READ');}}
 change(k,fn){
  let lock;try{lock=fs.openSync(this.file(k,'.lock'),'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('MEDIA_BUSY');throw Error('MEDIA_STATE_LOCK');}
  try{const old=this.read(k),next=fn(old);if(next===undefined)return old;
   const tmp=this.file(k,'.'+crypto.randomBytes(6).toString('hex')+'.tmp');
   const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(tmp,this.file(k));return next;
  }finally{fs.closeSync(lock);fs.unlinkSync(this.file(k,'.lock'));}
 }
}
function jobKey(bot,user,message){return crypto.createHash('sha256').update([bot,user,message].join(':')).digest('hex').slice(0,20);}
module.exports={Store,jobKey};
