'use strict';
// Test helper: the visible text of a bot message, plain (text) or rich (rich_message.html, read back as plain text).
const {plain}=require('../dist/nodes/NnaMediaCollection/rich-format');
const shown=body=>body?.text??(body?.rich_message?plain(body.rich_message.html):undefined);
const isMessage=c=>c.method==='sendMessage'||c.method==='sendRichMessage';
module.exports={shown,isMessage};
