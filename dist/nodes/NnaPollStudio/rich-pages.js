'use strict';
// Poll Studio menus, previews and receipts in the user's locked NNA rich look (19 Oct 2026, package 0.42.0).
// Page builders only; service.js sends them with its reply keyboard and keeps the old plain text as the fallback.
// User text (questions, options, template codes) is shown escaped, never parsed for [[ ]] / ** **.
const R = require('../NnaMediaCollection/rich-format');

const PLACE = '📍 #NNA Poll Studio';
const note = (head, main, lines, {pre = '', extra = '', tapHtml = '', rows = [], place = PLACE} = {}) =>
  R.card({head, main, citeText: R.cite(place), lines, pre, extra, tapHtml, rows});
const u = s => R.mono(s);                       // user text, escaped (monospace English letters)
const on = x => x ? 'ON ✅' : 'OFF ⭕';
const kindName = t => t === 'quiz' ? 'Quiz' : t === 'checklist' ? 'Checklist' : 'Poll';
const kindIcon = t => t === 'quiz' ? '❓' : t === 'checklist' ? '☑️' : '🗳️';
const letter = i => String.fromCharCode(65 + i);
// mark the first n English words (3+ letters) of a fixed message yellow, so even error lines carry key words
const keys = (s, n = 2) => { let k = 0; return String(s).replace(/\b[A-Za-z][A-Za-z0-9_]{2,}\b/g, w => k++ < n ? `[[${w}]]` : w); };
const userBlock = (headText, rows) => R.sub(headText) + '<p>' + rows.join('<br>') + '</p>';

const home = () => note('🏠 #NNA Main Menu ✨', '🏠 CHOOSE A FEATURE BELOW 👇', [
  [null, 'Share : 📤 [[Image / Video]] பகிர்வு, 📁 Media + [[Article]] ஒன்றாக 📰'],
  [null, 'Poll : 🗳️ [[Poll]], ❓ Quiz, ☑️ [[Checklist]] உருவாக்கலாம் ✨'],
  [null, 'Report : 🔎 Image / Video [[Report]], 🎙️ [[Audio]] Summary 🎧'],
  [null, 'Live : 📡 Live [[Schedule]], 📄 User Chat [[History]] 🗂️'],
  [null, 'Templates : 📚 [[Templates]], 💾 புதிதாகச் [[சேமி]], ✏️ மாற்று 👍'],
]);
const groupHome = () => note('🗳️ #NNA Topic Menu ✨', '🗳️ USE THESE RIGHT HERE IN THIS TOPIC 👇', [
  [null, 'Here : 🔎 Image / Video [[Report]], 🗳️ Poll / Quiz / [[Checklist]] ✨'],
  [null, 'Private : 🔒 History, [[template]] நிர்வாகம், 📤 [[publishing]], scheduling — தனிப்பட்ட chat-ல் 😊'],
], {place: '📍 #NNA group'});
const openPrivate = (bot, command) => note('↗️ தனிப்பட்ட Chat-ல் திறக்கவும்', '↗️ OPEN IN PRIVATE CHAT 🤖', [
  [null, `Private : 🔒 [[${command}]] வசதி, @${bot} [[தனிப்பட்ட]] chat-ல் மட்டும் 🤖`],
  [null, 'Open : 👇 கீழே உள்ள [[button]]-ஐ [[அழுத்துங்கள்]] 😊'],
], {place: '📍 #NNA group'});
const start = () => note('🗳️ Poll / Quiz / Checklist ✨', '🗳️ WHAT WILL YOU CREATE? 🤔', [
  [null, 'Poll : 🗳️ [[Vote Poll]] — [[எல்லோரும்]] வாக்களிக்கலாம் 🙋'],
  [null, 'Quiz : ❓ [[Quiz]] — ✅ சரியான [[விடையுடன்]] 🎯'],
  [null, 'Checklist : ☑️ [[Checklist]] — [[பணிகளின்]] பட்டியல் 📋'],
  [null, 'Choose : 👇 கீழே உள்ள [[button]]-ஐத் [[தொடுங்கள்]] 😊'],
]);
const input = type => type === 'checklist' ? note('☑️ Checklist எழுதுங்கள் ✍️', '☑️ SEND THE CHECKLIST IN ONE MESSAGE ✍️', [
  [null, 'Format : ✍️ முதல் வரி [[தலைப்பு]], பிறகு [[1. 2. 3.]] என items 📋'],
  [null, 'Limit : 📏 தலைப்பு [[255]] characters; 1–30 items, ஒவ்வொன்றும் [[100]] வரை'],
], {pre: userBlock('✍️ உதாரணம்', [u('இன்றைய பணிகள்'), u('1. முதல் பணி'), u('2. இரண்டாவது பணி')])})
  : note(`${kindIcon(type)} ${kindName(type)} எழுதுங்கள் ✍️`, `${kindIcon(type)} SEND QUESTION + OPTIONS IN ONE MESSAGE ✍️`, [
  [null, 'Format : ✍️ முதல் வரி [[கேள்வி]], பிறகு [[A) B) C)]] என options 📋'],
  [null, 'Limit : 📏 2–12 options; கேள்வி [[300]], ஒவ்வொரு option [[100]] characters'],
  [null, type === 'quiz' ? 'Next : ✅ அடுத்ததாக சரியான [[விடையைக்]] [[கேட்பேன்]] 🎯' : 'Next : ⚙️ அடுத்து [[settings]], 👁 [[preview]] வரும் ✨'],
], {pre: userBlock('✍️ உதாரணம்', [u('உங்கள் கேள்வி?'), u('A) முதல் விடை'), u('B) இரண்டாவது விடை'), u('C) மூன்றாவது விடை')])});
const ASK = {
  correct: ['✅ சரியான விடை எது? 🎯', '✅ SEND THE CORRECT ANSWER 🎯', [
    [null, 'Answer : ✅ [[A]] அல்லது [[1]] அனுப்புங்கள் 👍'],
    [null, 'Many : ➕ [[பல]] சரியான விடைகள்: [[A,C]] 🙂']]],
  timer: ['⏱ Timer எத்தனை seconds? ⏳', '⏱ SEND THE TIMER IN SECONDS ⏳', [
    [null, 'Timer : ⏱ [[seconds]] எண்ணிக்கை அனுப்புங்கள்; [[0]] = OFF ⭕'],
    [null, 'Example : ✍️ [[உதாரணம்]]: [[60]], 300, 3600 🙂']]],
  countries: ['🌍 Country Codes 🗺️', '🌍 SEND COUNTRY CODES 🗺️', [
    [null, 'Codes : 🌍 2-letter [[codes]] அனுப்புங்கள்; உதாரணம்: [[IN,LK]] 🗺️'],
    [null, 'All : 🌐 [[அனைவருக்கும்]] அனுமதிக்க [[-]] அனுப்புங்கள் 👍']]],
  description: ['📝 Poll Description ✍️', '📝 SEND THE POLL DESCRIPTION ✍️', [
    [null, 'Text : 📝 [[description]] அனுப்புங்கள்; [[1024]] characters வரை ✍️'],
    [null, 'Remove : 🗑️ [[நீக்க]] [[-]] அனுப்புங்கள் 👍']]],
  explanation: ['💡 விடை விளக்கம் ✍️', '💡 SEND THE ANSWER EXPLANATION ✍️', [
    [null, 'Text : 💡 சரியான விடைக்கான [[விளக்கம்]]; [[200]] characters வரை ✍️'],
    [null, 'Skip : 🙅 [[வேண்டாம்]] என்றால் [[-]] அனுப்புங்கள் 👍']]],
  code: ['💾 Template Code Word ✍️', '💾 SEND A CODE WORD FOR THIS TEMPLATE 🏷️', [
    [null, 'Code : 💾 [[code word]] அனுப்புங்கள்; உதாரணம்: [[dailyvote]] 🏷️'],
    [null, 'Rule : 🔤 [[ஆங்கில]] எழுத்தில் தொடங்கி, letters / numbers / _ மட்டும்; [[3–32]] characters']]],
};
const ask = field => ASK[field] ? note(...ASK[field]) : '';
const replyHint = () => R.DIV + R.ticks([[null, 'Reply : ↩️ இந்த bot [[message]]-க்கு [[Reply]] செய்து, பதிலை அனுப்புங்கள் 👍']]);

// 👁 preview of the draft (what will be published) + its settings
function preview(d, username) {
  const s = d.settings, q = d.poll.question.text;
  if (s.type === 'checklist') return note('☑️ Checklist Preview 👁', '☑️ ' + q, [
    [null, `Add : ➕ மற்றவர்கள் items [[சேர்க்கலாம்]]: [[${on(s.othersAppend)}]]`],
    [null, `Complete : ✅ மற்றவர்கள் [[complete / undo]]: [[${on(s.othersComplete)}]]`],
    [null, `Sender : 👤 [[வெளியிடுபவர்]] [[@${username}]] 📤`],
  ], {pre: userBlock(`📋 ${d.poll.answers.length} ITEMS`, d.poll.answers.map((a, i) => R.mono((i + 1) + '. ') + '☐ ' + u(a.text)))});
  const lines = [
    ...(s.type === 'quiz' ? [[null, `Correct : ✅ [[சரியான விடை]]: [[${s.correct.map(letter).join(', ')}]] 🎯`]] : []),
    [null, `Voters : 👤 [[${s.anonymous ? 'Anonymous' : 'பெயர் தெரியும்'}]] · ☑️ பல விடைகள்: [[${on(s.multiple)}]]`],
    [null, `Revote : 🔁 Vote மாற்றலாம்: [[${on(s.revote)}]] · 🔀 Shuffle: [[${on(s.shuffle)}]]`],
    [null, `Adding : ➕ புதிய options: [[${on(s.adding)}]] · ⏱ Timer: [[${s.seconds ? s.seconds + ' sec' : 'OFF ⭕'}]]`],
    [null, `Hide : 🙈 முடியும் வரை results மறை: [[${on(s.hide)}]] · 👥 Members only: [[${on(s.members)}]]`],
    [null, `Countries : 🌍 [[${s.countries.join(', ') || 'அனைத்து'}]] நாடுகளுக்கு [[அனுமதி]] 🗺️`],
    [null, `Sender : 👤 [[வெளியிடுபவர்]] [[@${username}]] 📤`],
  ];
  const notes = [s.description ? R.line('Description : 📝 [[Poll]] [[விளக்கம்]] — ') + u(s.description) : '', s.explanation ? R.line('Explanation : 💡 [[விடை]] [[விளக்கம்]] — ') + u(s.explanation) : ''].filter(Boolean);
  return note(`${kindIcon(s.type)} ${kindName(s.type)} Preview 👁`, `${kindIcon(s.type)} ` + q, lines, {
    pre: userBlock(`📋 ${d.poll.answers.length} OPTIONS`, d.poll.answers.map((a, i) => R.mono(letter(i) + ') ') + u(a.text) + (s.type === 'quiz' && s.correct.includes(i) ? ' ✅' : ''))),
    extra: notes.length ? '<p>' + notes.join('<br><br>') + '</p>' : '',
  });
}
const list = (items, username) => note('📚 Poll Templates 🗂️', items.length ? `📚 ${items.length} SAVED TEMPLATES ✨` : '📚 NO TEMPLATES YET ✨', items.length ? [
  [null, 'Private : 🔒 [[Code word]]-ஐ இங்கே அனுப்பினால், 👁 [[preview]] வரும் ✨'],
  [null, `Group : 📌 Enabled topic-ல் அதே [[code word]] மட்டும் → @${username} மூலம் [[புதிய]] பதிவு 📤`],
  [null, 'Choose : 👇 கீழே ஒரு [[template]]-ஐத் தொடுங்கள் 😊'],
] : [
  [null, 'Empty : 🗂️ இன்னும் [[template]] [[இல்லை]] 🙂'],
  [null, 'Create : 🗳️ [[/poll]] மூலம் உருவாக்கி, 💾 [[Template சேமி]] அழுத்துங்கள் 👍'],
], {tapHtml: items.length ? items.map(([code, t]) => R.mono(code) + ' · ' + u(String(t.poll.question.text).slice(0, 80))).join('<br>') : ''});
const topicGroups = count => note('📍 Poll Topics ⚙️', `📍 ${count} GROUPS · TURN TOPICS ON / OFF 🔀`, [
  [null, 'Choose : 👥 [[Group]]-ஐத் தேர்வு செய்து, topics-ஐ [[ON/OFF]] செய்யுங்கள் 🔀'],
  [null, 'New : 🆕 புதிய [[topic]] உருவாக்கினால், இங்கே [[தானாக]] தோன்றும் ✨'],
]);
const privateTopics = () => note('🔒 தனிப்பட்ட Chat-ல் திறக்கவும்', '🔒 TOPIC SETTINGS ARE PRIVATE ⚙️', [
  [null, 'Private : ⚙️ Topic [[நிர்வாகத்தை]], [[தனிப்பட்ட]] chat-ல் திறக்கவும் 👇'],
], {place: '📍 #NNA group'});
const topicPage = (title, enabled, total) => note('📍 ' + title, `📍 ${enabled} OF ${total} TOPICS ON ✅`, [
  [null, 'Toggle : 👆 Topic-ஐத் தொட்டு [[enable]] / [[disable]] செய்யுங்கள் 🔀'],
  [null, 'Mark : ✅ = [[ON]], ▫️ = [[OFF]] 🙂'],
]);
const destinations = count => note('📍 எந்த Topic? 📤', `📍 ${count} TOPICS READY · CHOOSE ONE 👇`, [
  [null, 'Topic : 📌 எந்த [[topic]]-ல் [[வெளியிட]] வேண்டும்? 👇'],
]);
const confirm = (d, title, username) => note('✅ இறுதி உறுதி 🔒', `${kindIcon(d.settings.type)} ` + d.poll.question.text, [
  [null, `Topic : 📌 [[${title}]] topic-ல் [[வெளியாகும்]] 📤`],
  [null, `Sender : 👤 [[@${username}]] [[மூலம்]] ✨`],
  [null, d.settings.type === 'quiz' ? `Type : ❓ [[Quiz]] — சரியான விடை [[${d.settings.correct.map(letter).join(', ')}]] 🎯`
    : d.settings.type === 'checklist' ? 'Type : ☑️ [[Checklist]] 📋' : `Type : 🗳️ [[Poll]] · 🔁 Vote மாற்றலாம்: [[${on(d.settings.revote)}]]`],
  [null, 'Publish : 👇 [[✅ வெளியிடு]] அழுத்தினால் [[உடனே]] வெளியாகும் 🚀'],
]);
const published = (type, username, url) => note(`✅ ${kindName(type)} வெளியிடப்பட்டது 🎉`, `${kindIcon(type)} ${kindName(type).toUpperCase()} PUBLISHED 🎉`, [
  [true, `Published : ${kindIcon(type)} உங்கள் [[${kindName(type)}]], [[வெளியிடப்பட்டது]]! 🎉`],
  [true, `Sender : 👤 [[@${username}]] [[மூலம்]] 📤`],
], {rows: url ? [[['📄 Full message', url, 'success']]] : []});
const saved = (code, username) => note('💾 Template சேமிக்கப்பட்டது ✅', '💾 TEMPLATE SAVED · ' + code, [
  [true, `Saved : 💾 [[${code}]] என்ற code word-ல், [[சேமிக்கப்பட்டது]] ✅`],
  [null, `Private : 🔒 இங்கே [[${code}]] அனுப்பினால் → 👁 [[Preview]]`],
  [null, `Group : 📌 Enabled topic-ல் [[${code}]] → @${username} மூலம் [[புதிய]] பதிவு 📤`],
  [null, 'New : 🆕 ஒவ்வொரு முறையும் [[புதிய]] [[பதிவு]] உருவாகும் ✨'],
]);
const cancelled = again => note('❌ Poll Draft ரத்து', '❌ POLL DRAFT CANCELLED 🗑️', [
  [true, 'Cancel : 🗑️ இந்த Poll [[draft]], [[ரத்து]] செய்யப்பட்டது ✅'],
  ...(again ? [[null, 'Again : 🗳️ [[/poll]] மூலம் [[மீண்டும்]] தொடங்கலாம் 👍']] : []),
]);
const parseError = msg => note('⚠️ வடிவம் சரியில்லை ✍️', '⚠️ QUESTION / OPTIONS NOT READ ✍️', [
  [false, 'Format : ⚠️ [[வடிவம்]] [[பிழை]] — ' + keys(msg, 1)],
  [null, 'Send : ✍️ [[கேள்வி]], அடுத்து [[A) / B)]] options உள்ள ஒரே message அனுப்புங்கள் 👍'],
]);
const failed = msg => note('⚠️ Poll செயல் முடியவில்லை', '⚠️ POLL ACTION NOT DONE 😟', [
  [false, 'Reason : ⚠️ [[காரணம்]] — ' + keys(msg, 2)],
  [null, 'Next : 🔁 சரிசெய்து [[மீண்டும்]] அனுப்புங்கள், அல்லது [[/poll]] மூலம் புதிதாக 👍'],
]);
const previewControls = bundle => note('👁 Preview மேலே உள்ளது ✨', bundle ? '👁 MEDIA + ARTICLE PREVIEW ABOVE 👆' : '👁 MEDIA + CAPTION PREVIEW ABOVE 👆', bundle ? [
  [true, 'Preview : 👁 Media, 📰 [[article]] preview மேலே [[தயார்]] ✅'],
  [null, 'Next : 👇 கீழே buttons மூலம் drafts-ஐ [[உறுதி]] செய்து, 📍 [[destination]] / ⏰ [[நேரம்]] தேர்வு செய்யுங்கள்'],
] : [
  [true, 'Preview : 👁 Media + [[caption]] preview மேலே [[தயார்]] ✅'],
  [null, 'Next : 👇 கீழே [[Draft]] [[உறுதி]] செய்யுங்கள் 😊'],
]);

module.exports = {keys, home, groupHome, openPrivate, start, input, ask, replyHint, preview, list, topicGroups, privateTopics,
  topicPage, destinations, confirm, published, saved, cancelled, parseError, failed, previewControls};
