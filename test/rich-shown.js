'use strict';
// Test helper: the visible text of a bot message, plain (text) or rich (rich_message.html, read back as plain text).
const {plain}=require('../dist/nodes/NnaMediaCollection/rich-format');
const shown=body=>body?.text??(body?.rich_message?plain(body.rich_message.html):undefined);
const isMessage=c=>c.method==='sendMessage'||c.method==='sendRichMessage';
// buttons of a bot message: rich <tg-button> rows in the html (21 Oct 2026 rule) or an inline keyboard (plain fallback)
const unesc=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const buttonsOf=body=>{
 const html=body?.rich_message?.html;
 if(typeof html==='string'&&html.includes('<tg-button '))return [...html.matchAll(/<tg-button ([^>]*)>([\s\S]*?)<\/tg-button>/g)].map(([,attrs,label])=>{const a=Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map(([,k,v])=>[k,unesc(v)]));return {text:unesc(label),...(a.type==='url'?{url:a.url}:a.type==='copy_text'?{copy_text:{text:a.text}}:{callback_data:a.data})};});
 return (body?.reply_markup?.inline_keyboard||[]).flat();
};
module.exports={shown,isMessage,buttonsOf};
