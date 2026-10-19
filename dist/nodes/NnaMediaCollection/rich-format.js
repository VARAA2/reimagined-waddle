'use strict';
// The user's locked NNA report look (19 Oct 2026; Python original: D:\Videos\Prompt Library Bot\_project\nna_format.py).
// Telegram rich message (Bot API sendRichMessage / editMessageText with rich_message.html). Rules:
// - CAPS underlined title with emoji; pull quote (normal font, CAPS, emoji) + cite "date · time · place" in monospace.
// - A divider <hr> after every portion. Every line is "emoji Label : text" (English label, bold monospace).
// - 2-3 yellow key words in every line ([[word]] here, or **word** from the AI); every person's name yellow.
// - Tick only for a finished step, ❌ for failed / not done, info lines use their own emoji (never an empty box).
// - English letters in Unicode monospace (display only), Tamil normal; long text inside "Tap to read fully";
//   links as short words / buttons at the bottom; "#NNA" with the hash.
// If Telegram refuses a rich message, the same facts go out as plain text, so a report is never lost.
const m = s => Array.from(String(s ?? '')).map(ch => {
  const o = ch.codePointAt(0);
  if (o >= 65 && o <= 90) return String.fromCodePoint(0x1D670 + o - 65);
  if (o >= 97 && o <= 122) return String.fromCodePoint(0x1D68A + o - 97);
  if (o >= 48 && o <= 57) return String.fromCodePoint(0x1D7F6 + o - 48);
  return ch;
}).join('');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mono = s => esc(m(s));
const hl = s => `<mark>${s}</mark>`;
const DIV = '<hr>';
const EMOJI = /^((?:\p{Extended_Pictographic}[\uFE0F\u200D]*)+)\s*/u;
const LABEL = /^([A-Za-z][A-Za-z ]{0,20}?) : /;
const TZ = 'Asia/Kolkata';

const title = t => `<h1><u>${esc(String(t).toUpperCase())}</u></h1>`;
const pull = (t, cite) => `<aside>${esc(String(t).toUpperCase())}${cite ? `<cite>${mono(cite)}</cite>` : ''}</aside>`;
const sub = t => `<blockquote><b>${esc(String(t).toUpperCase())}</b></blockquote>`;
const tap = inner => `<details><summary>👉 📜 ${m('Tap to read fully')}</summary><p>${inner}</p></details>`;

// "[[key]]" (bot text) or "**key**" (AI text) -> yellow; the rest monospace; URLs become short link words
function marked(s) {
  return String(s ?? '').split(/\[\[(.+?)\]\]|\*\*([^*]{1,60})\*\*/).map((p, i) => {
    if (p === undefined) return '';
    return i % 3 === 0 ? links(p) : hl(mono(p));
  }).join('');
}
function links(s) {
  let out = '', last = 0;
  for (const mt of String(s).matchAll(/https?:\/\/[^\s<>"]+/g)) {
    out += mono(s.slice(last, mt.index));
    const u = mt[0], word = /youtu\.?be/.test(u) ? '▶️ ' + m('YouTube') : /t\.me\//.test(u) ? '📄 ' + m('Full message') : '🔗 ' + m('Link');
    out += `<a href="${esc(u)}">${word}</a>`;
    last = mt.index + u.length;
  }
  return out + mono(String(s).slice(last));
}
// one line "Label : 📤 text" -> "📤 <b>Label</b> : text" (emoji before the label; 🔹 when the text has none)
function line(s) {
  s = String(s ?? '');
  const lm = LABEL.exec(s);
  if (!lm) return marked(s).replace(/\n/g, '<br>');
  let rest = s.slice(lm[0].length), icon = '🔹';
  const em = EMOJI.exec(rest);
  if (em) { icon = em[1]; rest = rest.slice(em[0].length); }
  return `${icon} <b>${mono(lm[1])}</b> : ${marked(rest).replace(/\n/g, '<br>')}`;
}
// items: [[state, text]]: true = finished step (ticked), false = failed / not done (❌), null = info (own emoji)
function ticks(items) {
  const out = [];
  let ticked = [], plain = [];
  const flush = () => {
    if (ticked.length) out.push('<ul>' + ticked.map(t => `<li><input type="checkbox" checked>${t}</li>`).join('') + '</ul>');
    if (plain.length) out.push('<p>' + plain.join('<br><br>') + '</p>');
    ticked = []; plain = [];
  };
  for (const [state, text] of items) {
    if ((state === true && plain.length) || (state !== true && ticked.length)) flush();
    (state === true ? ticked : plain).push(state === false ? '❌ ' + line(text) : line(text));
  }
  flush();
  return out.join('');
}
// rows: [[label, target, style?]]; target "https://…" url, "copy:<text>" copy button, "cb:<data>" callback
function buttons(rows) {
  return (rows || []).filter(r => r && r.length).map(r => '<tg-button-row align="center">' + r.map(([label, target, style]) => {
    const st = style ? ` style="${esc(style)}"` : '';
    const t = String(target);
    if (t.startsWith('copy:')) return `<tg-button type="copy_text"${st} text="${esc(t.slice(5))}">${esc(label)}</tg-button>`;
    if (t.startsWith('cb:')) return `<tg-button type="callback_data"${st} data="${esc(t.slice(3))}">${esc(label)}</tg-button>`;
    return `<tg-button type="url"${st || ' style="primary"'} url="${esc(t)}">${esc(label)}</tg-button>`;
  }).join('') + '</tg-button-row>').join('');
}
function cite(place, when = new Date()) {
  const d = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, day: '2-digit', month: 'short'}).format(when);
  const t = new Intl.DateTimeFormat('en-US', {timeZone: TZ, hour: 'numeric', minute: '2-digit'}).format(when);
  return `🗓️ ${d} · 🕘 ${t} · ${place}`;
}
// title + pull quote, [pre], ticked/plain lines, [extra], [tap], buttons — a divider between the portions
function card({head, main, citeText, lines = [], pre = '', extra = '', tapHtml = '', rows = []}) {
  const blocks = [title(head) + pull(main, citeText || cite('📍 #NNA')), pre, lines.length ? ticks(lines) : '', extra, tapHtml ? tap(tapHtml) : ''];
  return blocks.filter(Boolean).join('\n' + DIV + '\n') + (rows.length ? '\n' + buttons(rows) : '');
}
// plain text of a page, for the fallback when Telegram refuses a rich message
function plain(html) {
  const map = {};
  for (let i = 0; i < 26; i++) { map[String.fromCodePoint(0x1D670 + i)] = String.fromCharCode(65 + i); map[String.fromCodePoint(0x1D68A + i)] = String.fromCharCode(97 + i); }
  for (let i = 0; i < 10; i++) map[String.fromCodePoint(0x1D7F6 + i)] = String(i);
  return Array.from(String(html).replace(/<tg-button-row[\s\S]*?<\/tg-button-row>/g, '').replace(/<br>|<\/(p|li|h1|blockquote|aside|details|summary)>|<cite>|<hr>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    .map(ch => map[ch] || ch).join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}
// send (or with messageId: replace) a rich page through service.bot, so group routing (group-context.js) applies
async function send(service, chatId, html, {messageId, extra = {}, fallback, fallbackExtra = {}} = {}) {
  const body = {chat_id: chatId, rich_message: {html}, ...extra};
  try {
    return messageId ? await service.bot('editMessageText', {...body, message_id: messageId}) : await service.bot('sendRichMessage', body);
  } catch (e) {
    const text = fallback || plain(html);
    return messageId ? service.bot('editMessageText', {chat_id: chatId, message_id: messageId, text, ...fallbackExtra})
      : service.tell(chatId, text, fallbackExtra);
  }
}
// plain sendMessage options -> rich sendRichMessage options (reply_to -> reply_parameters; text-only options dropped)
function richExtra(extra = {}) {
  const {entities, disable_web_page_preview, link_preview_options, parse_mode, reply_to_message_id, allow_sending_without_reply, ...rest} = extra;
  if (reply_to_message_id && !rest.reply_parameters) rest.reply_parameters = {message_id: reply_to_message_id, allow_sending_without_reply: allow_sending_without_reply !== false};
  return rest;
}
module.exports = {m, esc, mono, hl, title, pull, sub, tap, DIV, marked, line, ticks, buttons, cite, card, plain, send, richExtra};
