'use strict';
// The three media reports in the locked NNA rich look (user, 19 Oct 2026): post receipt, reply-group media report,
// audio summary. Page builders only; sending is rich-format.send (plain fallback).
const R = require('./rich-format');

const kindWord = kind => kind === 'album' ? 'album' : kind === 'video' ? 'video' : 'image';
const kindIcon = kind => kind === 'album' ? '🖼️🖼️' : kind === 'video' ? '🎬' : '🖼️';
const firstLine = s => { const t = String(s || '').split('\n').find(x => x.trim()) || ''; const a = Array.from(t.trim()); return a.length > 70 ? a.slice(0, 70).join('').replace(/\s+\S*$/, '') + '…' : a.join(''); };

// ✅ media posted to a topic. topicLabel = destinations.topicLabel() ("📁 Topic" / "📁 Topic · Group").
// 0.58.0: topics = [{label,url}] of every topic this media went to (re-post by replying to this card adds one);
// with 2+ topics the card names them all and has one 📄 button per topic.
function receiptPage({kind = 'image', count = 1, topicLabel = '', caption = '', url = '', editData = '', edited = false, groupLabel = '#NNA', topics = null}) {
  const list = (Array.isArray(topics) && topics.length ? topics : [{label: topicLabel, url}]).map(t => ({label: String(t.label || 'topic').replace(/\n/g, ' · '), url: t.url || ''}));
  const many = list.length > 1;
  const topic = list[0].label;
  const names = list.map(t => `[[${t.label}]]`).join(' + ');
  const what = kind === 'album' ? `${count} media album` : kindWord(kind);
  const lines = edited ? [
    [true, `Caption : ✏️ இந்தப் பதிவின் [[caption]], [[திருத்தப்பட்டது]]! ✅`],
    [null, many ? `Topics : 📌 ${names} — 📄 எல்லா [[${list.length} பதிவுகளிலும்]] 👍` : `Topic : 📌 [[${topic}]] topic-ல், 📄 அதே [[பதிவு]] 👍`],
  ] : [
    [true, many ? `Posted : ${kindIcon(kind)} நீங்கள் அனுப்பிய [[${what}]], 📌 ${names} — [[${list.length} topics]]-ல் [[பதிவிடப்பட்டது]]! 🎉` : `Posted : ${kindIcon(kind)} நீங்கள் அனுப்பிய [[${what}]], 📌 [[${topic}]] topic-ல் [[பதிவிடப்பட்டது]]! 🎉`],
    [true, `Sender : 👤 உங்கள் [[account]] மூலம், 📤 [[அப்படியே]] போனது ✨`],
  ];
  if (caption && !edited) lines.push([true, `Caption : 📝 [[caption]] + [[hashtags]], ✍️ சேர்ந்தன 👍`]);
  if (editData) lines.push([null, `Edit : ✏️ caption மாற்ற வேண்டுமா? 👇 [[Caption திருத்து]] தட்டுங்கள் 😊`]);
  lines.push([null, `Again : 🔁 இன்னொரு topic-லும் வேண்டுமா? 👉 இந்த card-க்கு [[Reply]] செய்யுங்கள் 😊`]);
  const short = s => { const a = Array.from(s); return a.length > 22 ? a.slice(0, 21).join('') + '…' : s; };
  const linkButtons = many ? list.filter(t => t.url).map(t => ['📄 ' + short(t.label.split(' · ')[0].replace(/^[^\p{L}\p{N}\s]+\s+/u, '')), t.url, 'success']) : (list[0].url ? [['📄 Full message', list[0].url, 'success']] : []);
  const editButton = editData ? [[edited ? '✏️ மீண்டும் திருத்து' : '✏️ Caption திருத்து', 'cb:' + editData, 'primary']] : [];
  const rows = many ? [...Array.from({length: Math.ceil(linkButtons.length / 2)}, (_, i) => linkButtons.slice(i * 2, i * 2 + 2)), editButton] : [[...linkButtons, ...editButton]];
  return R.card({
    head: edited ? '✏️ Caption திருத்தப்பட்டது ✅' : '📥 Media பதிவிடப்பட்டது ✅🎉',
    main: edited ? `✏️ CAPTION UPDATED → 📌 ${many ? list.length + ' TOPICS' : topic}` : `${kindIcon(kind)} ${kind === 'album' ? count + ' MEDIA' : '1 ' + kindWord(kind).toUpperCase()} → 📌 ${many ? list.length + ' TOPICS' : topic}`,
    citeText: R.cite('📍 ' + groupLabel),
    pre: caption ? R.sub('🏷️ ' + firstLine(caption)) : '',
    lines, rows: rows.filter(r => r.length),
  });
}

// 🔎 reply-group / analysis-only media report: summary lines (AI may mark **key words**) + hashtags with copy buttons
function reportPage({summaryLines = [], tags = [], kind = 'image', sourceUrl = '', groupLabel = '#NNA'}) {
  const lines = summaryLines.map(s => [null, /^[A-Za-z][A-Za-z ]{0,20}? : /.test(s) ? s : `Summary : 📝 ${s}`]);
  if (tags.length) lines.push([null, `Hashtags : 🏷️ [[${tags.length} hashtags]] தயார், 📋 [[Copy]] button-ல் ஒரே தட்டில் 👇`]);
  const summaryText = summaryLines.map(s => s.replace(/\*\*/g, '')).join('\n');
  const rows = [[...(summaryText ? [['📋 Copy summary', 'copy:' + summaryText.slice(0, 256), 'primary']] : []), ...(tags.length ? [['🏷️ Copy hashtags', 'copy:' + tags.join(' ').slice(0, 256), 'success']] : [])], sourceUrl ? [['📄 Full message', sourceUrl]] : []];
  return R.card({
    head: `🔎 Media Report ${kindIcon(kind)}✨`,
    main: `📝 ${summaryLines.length} lines 🏷️ ${tags.length} hashtags`,
    citeText: R.cite('📍 ' + groupLabel),
    lines,
    tapHtml: tags.length ? tags.map(t => R.mono(t)).join(' ') : '',
    rows: rows.filter(r => r.length),
  });
}

// 🎙️ one message instead of 3500-character pieces; each long part has its own "Tap to read fully"
function audioPage({sender = '', senderId = '', when = '', duration = 0, summary = '', points = [], unclear = [], sourceUrl = ''}) {
  const mmss = Math.floor(duration / 60) + ':' + String(duration % 60).padStart(2, '0');
  const name = /^[1-9]\d*$/.test(String(senderId)) ? `<a href="tg://user?id=${senderId}">${R.hl(R.mono(sender))}</a>` : R.hl(R.mono(sender));
  const firstSentence = (() => { const t = String(summary).replace(/\*\*/g, '').trim(); const i = t.search(/[.!?।](\s|$)/); const s = i > 20 ? t.slice(0, i + 1) : t; return Array.from(s).length > 110 ? Array.from(s).slice(0, 110).join('') + '…' : s; })();
  const section = (icon, label, items) => items.length ? R.tap(items.map(x => R.line(/^[A-Za-z][A-Za-z ]{0,20}? : /.test(x) ? x : `${label} : ${icon} ${x}`)).join('<br><br>')) : '';
  return [
    R.title('🎙️ Audio Summary 🎧✨') + R.pull(`🎧 ${mmss} AUDIO → 📝 ${firstSentence}`, `🗓️ ${when} IST · ⏱️ ${mmss}`),
    `<p>👤 ${name} · 🎙️ ${R.mono('voice / audio')}</p>`,
    R.ticks([[null, /^[A-Za-z][A-Za-z ]{0,20}? : /.test(summary) ? summary : `Summary : 📝 ${summary}`]]),
    points.length ? R.sub('📌 Key points (' + points.length + ')') + section('📌', 'Point', points) : '',
    unclear.length ? R.sub('🔎 Unclear (' + unclear.length + ')') + section('🔎', 'Unclear', unclear) : '',
  ].filter(Boolean).join('\n' + R.DIV + '\n') + (sourceUrl ? '\n' + R.buttons([[['📄 Full message', sourceUrl, 'success']]]) : '');
}
module.exports = {receiptPage, reportPage, audioPage};
