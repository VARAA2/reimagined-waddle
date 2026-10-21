'use strict';
// Media bot status / error / menu messages in the user's locked NNA rich look (19 Oct 2026, package 0.42.0).
// Page builders only; the caller sends with rich-format.send and keeps the old plain text as the fallback.
// Every line "Label : emoji text" with 2-3 [[yellow]] key words; true = finished step, false = failed, null = info.
const R = require('./rich-format');

const PLACE = '📍 #NNA Media bot';
const note = (head, main, lines, {rows = [], pre = '', tapHtml = '', place = PLACE} = {}) =>
  R.card({head, main, citeText: R.cite(place), lines, rows, pre, tapHtml});
const at = u => u ? '@' + u : 'personal account';

// ---- publishing ----
const publishUncertain = (what = 'பதிவின்') => note('⚠️ பதிவு உறுதியாகவில்லை ⏳', '⚠️ POST RESULT NOT CONFIRMED 🔎', [
  [false, `Post : 📤 ${what} [[முடிவு]], இன்னும் [[உறுதியாகவில்லை]]! ⏳`],
  [null, 'Check : 🔎 முதலில் [[Group]]-ல் பார்த்து, 👀 [[பதிவு]] வந்ததா என்று சரிபாருங்கள்.'],
  [null, 'Retry : 🔁 சரிபார்த்த [[பிறகே]], மீண்டும் [[முயற்சிக்க]] வேண்டும் 🙏'],
]);
const publishFailed = bot => note('❌ பதிவிட முடியவில்லை 😟', '❌ MEDIA NOT POSTED ⚠️', [
  [false, 'Post : 📤 இப்போது [[பதிவிட]] [[முடியவில்லை]]! 😟'],
  [null, `Start : 🤖 @${bot} bot-ஐ, 👤 [[sender account]]-ல் [[Start]] செய்துள்ளீர்களா? 🤔`],
  [null, 'Topic : 📌 தேர்ந்தெடுத்த [[topic]], இன்னும் [[கிடைக்கிறதா]] என்று பாருங்கள் 🔎'],
  [null, 'Next : 👇 கீழே [[topic]]-ஐ [[மீண்டும்]] தேர்வு செய்யலாம் 😊'],
]);
const albumFailed = () => note('❌ Album பதிவிடப்படவில்லை 😟', '❌ ALBUM NOT POSTED 🖼️', [
  [false, 'Album : 🖼️ இந்த [[Album]], [[பதிவிடப்படவில்லை]]! 😟'],
  [null, 'Check : 📌 [[Topic]] கிடைக்கிறதா, 📝 [[caption]] அளவு சரியா என்று பாருங்கள் 🔎'],
  [null, 'Retry : 🔁 சரிபார்த்து, [[topic]]-ஐ [[மீண்டும்]] தேர்வு செய்யலாம் 👍'],
]);
const alreadySent = (url, inTopic) => note('✅ ஏற்கெனவே பதிவிடப்பட்டது', inTopic ? '✅ ALREADY IN THIS TOPIC 📌' : '✅ ALREADY POSTED 📤', [
  [true, inTopic ? 'Posted : 📌 இந்த media, இந்த [[topic]]-ல் [[ஏற்கெனவே]] பதிவிடப்பட்டது ✅' : 'Posted : 📤 இந்த [[media]], [[ஏற்கெனவே]] பதிவிடப்பட்டது ✅'],
  ...(inTopic ? [[null, 'Other : 🔀 வேண்டுமென்றால் [[வேறு]] topic-ஐத் [[தேர்வு]] செய்யலாம் 👍']] : []),
], {rows: url ? [[['📄 Full message', url, 'success']]] : []});
const alreadyCancelled = () => note('❌ இந்த media ரத்து செய்யப்பட்டது', '❌ MEDIA ALREADY CANCELLED 🗑️', [
  [false, 'Media : 🗑️ இந்த [[media]], ஏற்கெனவே [[ரத்து]] செய்யப்பட்டது!'],
  [null, 'Again : 📷 பதிவிட வேண்டுமென்றால், [[மீண்டும்]] [[அனுப்புங்கள்]] 🔁'],
]);
const busy = (analysing, topic) => note('⏳ ஏற்கெனவே நடக்கிறது', analysing ? '⏳ ANALYSIS RUNNING 🤖' : '⏳ ALREADY IN PROGRESS 📤', analysing ? [
  [null, 'Analysis : 🤖 இந்த media-க்கு [[analysis]], இப்போது [[நடக்கிறது]]! ⏳'],
  [null, 'Next : 📌 முடிந்ததும் [[topic]]-ஐத் [[தேர்வு]] செய்யுங்கள் 👍'],
] : [
  [null, topic ? 'Post : 📌 இந்த [[topic]]-க்கான பதிவு, [[நடக்கிறது]] அல்லது முடிவு உறுதியாகவில்லை ⏳' : 'Media : 📤 இந்த [[media]], ஏற்கெனவே [[கையாளப்படுகிறது]] ⏳'],
  [null, 'Check : 🔎 [[Group]]-ல் [[சரிபாருங்கள்]] 👀'],
]);

// ---- caption edit ----
const editPrompt = () => note('✏️ புதிய Caption அனுப்புங்கள் 📝', '✏️ REPLY WITH THE NEW CAPTION 👇', [
  [null, 'Reply : ↩️ இந்த [[message]]-க்கு [[Reply]] செய்து, 📝 புதிய caption அனுப்புங்கள்!'],
  [null, 'Empty : 🗑️ Caption [[முழுவதையும்]] நீக்க, [[/empty]] அனுப்புங்கள் ✂️'],
  [null, 'Hashtags : 🏷️ தேவைப்பட்டால், புதிய [[caption]]-லேயே [[hashtags]] சேர்க்கவும் 👍'],
]);
const editFailed = () => note('⚠️ Caption மாற்றம் உறுதியாகவில்லை', '⚠️ CAPTION EDIT NOT CONFIRMED 🔎', [
  [false, 'Caption : ✏️ Caption [[மாற்றத்தை]], [[உறுதிப்படுத்த]] முடியவில்லை! 😟'],
  [null, 'Check : 🔎 [[Group]] பதிவைத் திறந்து, 👀 caption-ஐ [[சரிபாருங்கள்]] 🙏'],
]);

// ---- analysis ----
const replyFirst = (cmd, what = 'image அல்லது video', icon = '📷') => note('↩️ Media-க்கு Reply செய்யுங்கள்', `↩️ REPLY TO THE ${icon === '🎙️' ? 'AUDIO' : 'MEDIA'} FIRST ${icon}`, [
  [null, `Reply : ${icon} நீங்கள் அனுப்பிய [[${what}]]-க்கு, ↩️ [[Reply]] செய்யுங்கள்!`],
  [null, `Command : ✨ [[பிறகு]] [[${cmd}]] அனுப்புங்கள் 👍`],
]);
const freshCommand = cmd => note('↩️ புதிய Command தேவை', '↩️ USE A FRESH COMMAND 🔁', [
  [false, 'Forward : 📨 [[Forward]] செய்த message-ஐ, இங்கே [[ஏற்க]] முடியாது!'],
  [null, `Command : ✨ [[புதிய]] command, அல்லது உங்கள் media-க்கு Reply செய்து [[${cmd}]] 👍`],
]);
const analysisBusy = () => note('⏳ Analysis நடக்கிறது', '⏳ ANALYSIS ALREADY RUNNING 🤖', [
  [null, 'Analysis : 🤖 இந்த [[media]]-க்கு, [[analysis]] ஏற்கெனவே நடக்கிறது! ⏳'],
  [null, 'Wait : 🙏 முடிந்ததும் [[சுருக்கம்]] இங்கே [[வரும்]] 📩'],
]);
const armed = () => note('✨ Analysis Mode ON 🤖', '✨ NEXT MEDIA → SUMMARY + HASHTAGS 🏷️', [
  [true, 'Mode : ✨ [[Analysis]] mode, [[ON]] ஆனது! 🤖'],
  [null, 'Next : 📷 அடுத்து ஒரு [[image]] அல்லது [[video]] அனுப்புங்கள் 👇'],
  [null, 'Result : 📝 3–4 வரிச் [[சுருக்கம்]] + 🏷️ [[hashtags]], ஒரே பதிலாக வரும் ✨'],
  [null, 'Old : ↩️ ஏற்கெனவே அனுப்பிய [[media]]-க்கு Reply செய்து, [[/analyze]] கொடுக்கலாம் 👍'],
  [null, 'Cancel : ❌ [[ரத்து]] செய்ய [[/cancel]] அனுப்புங்கள் 🙂'],
]);
const disarmed = () => note('❌ Analysis Mode ரத்து', '❌ ANALYSIS MODE OFF 🤖', [
  [true, 'Mode : ❌ [[Analysis]] mode, [[ரத்து]] செய்யப்பட்டது ✅'],
  [null, 'Next : 📷 இனி media அனுப்பினால், 📌 [[topic]] மட்டும் [[கேட்கப்படும்]] 👍'],
]);
const progress = () => note('⏳ சுருக்கம் தயாராகிறது 🤖', '⏳ SUMMARY + HASHTAGS IN PROGRESS ✨', [
  [true, 'Received : 📥 உங்கள் [[media]], [[கிடைத்தது]] ✅'],
  [null, 'Working : 🤖 [[சுருக்கமும்]] 🏷️ [[hashtags]]-மும், தயாராகின்றன… ⏳'],
  [null, 'Stop : 👇 வேண்டாம் என்றால், கீழே உள்ள [[button]]-ஐ [[அழுத்துங்கள்]] 🙂'],
]);
const analysisFailed = analysisOnly => note('⚠️ Analysis முடியவில்லை', '❌ ANALYSIS FAILED 😟', [
  [false, 'Analysis : 🤖 இந்த media-க்கு [[analysis]] செய்ய, [[முடியவில்லை]]!'],
  [null, 'Reason : 📏 [[அளவு]] / நீள வரம்பு, அல்லது ⬇️ [[download]] பிரச்சினையாக இருக்கலாம் 🤔'],
  ...(analysisOnly ? [] : [[null, 'Post : 📌 அசல் media-வை, [[topic]] தேர்வு செய்து [[பதிவிடலாம்]] 👍']]),
]);
const unreliable = (cmd = '/analyze') => note('⚠️ சுருக்கம் நம்பகமாக இல்லை', '❌ SUMMARY NOT RELIABLE 🏷️', [
  [false, 'Summary : 📝 சுருக்கமும் பொருத்தமான [[hashtags]]-மும், [[நம்பகமாக]] உருவாகவில்லை! 😟'],
  [null, `Retry : ↩️ media-க்கு Reply செய்து [[${cmd}]], 🔁 [[மீண்டும்]] முயற்சிக்கலாம் 👍`],
]);
const noResult = cmd => note('⚠️ Analysis முடிவு இல்லை', '❌ NO ANALYSIS RESULT 🔎', [
  [false, 'Result : 🔎 Analysis [[முடிவு]], [[கிடைக்கவில்லை]]! 😟'],
  [null, `Retry : ↩️ media-க்கு [[Reply]] செய்து [[${cmd}]], 🔁 மீண்டும் முயற்சிக்கலாம் 👍`],
]);
const cancelled = (what, extra = []) => note(`❌ ${what} ரத்து செய்யப்பட்டது`, `❌ ${String(what).toUpperCase()} CANCELLED 🗑️`, [
  [true, `Cancel : 🗑️ இந்த [[${what}]], [[ரத்து]] செய்யப்பட்டது ✅`], ...extra,
]);
const backToMenu = [null, 'Menu : 🏠 [[/menu]] மூலம், முக்கிய [[menu]]-க்கு திரும்பலாம் 👍'];

// ---- album ----
const albumBlocked = mixed => note('⚠️ Album பதிவிடப்படவில்லை', '❌ ALBUM BLOCKED 🖼️', mixed ? [
  [false, 'Album : 🖼️ Album-ல் [[2–10]] [[media]] மட்டும் இருக்க வேண்டும்! 😟'],
  [null, 'Mix : 📎 [[File]] வகையையும் 🖼️ [[photo/video]] வகையையும், ஒரே album-ல் கலக்க முடியாது'],
  [false, 'Post : 📤 இந்த [[album]], [[பதிவிடப்படவில்லை]]'],
] : [
  [false, 'File : 📎 Album-ல் [[ஆதரிக்கப்படாத]] [[file]] உள்ளது! 😟'],
  [false, 'Post : 📤 இந்த album [[முழுவதும்]], [[பதிவிடப்படவில்லை]]'],
  [null, 'Send : 🖼️ [[Image/video]] மட்டும் கொண்ட [[album]] அனுப்புங்கள் 👍'],
]);
const albumLate = () => note('⚠️ தாமதமாக வந்த Media', '⚠️ LATE MEDIA NOT ADDED 🖼️', [
  [false, 'Late : ⏰ Album முடிந்த பிறகு வந்த [[media]], [[சேர்க்கப்படவில்லை]]!'],
  [null, 'Check : 🔢 முழு album [[எண்ணிக்கையைச்]] [[சரிபாருங்கள்]] 🔎'],
]);
const albumAnalyze = () => note('✨ Album Analysis', '✨ ANALYZE ONE MEDIA AT A TIME 🖼️', [
  [null, 'Album : 🖼️ முழு [[Album]], தானாக [[AI]]-க்கு அனுப்பப்படாது 🤖'],
  [null, 'Analyze : ↩️ ஒவ்வொரு [[media]]-க்கும் Reply செய்து, [[/analyze]] கொடுக்கலாம் 👍'],
]);

// ---- topic order ----
const orderReset = () => note('✅ Topic வரிசை மாற்றப்பட்டது', '🔄 GROUP ORDER RESTORED 📌', [
  [true, 'Order : 🔄 [[Group]]-ல் தற்போது உள்ள [[வரிசைக்கு]], மாற்றப்பட்டது ✅'],
]);
const orderSaved = () => note('✅ Topic வரிசை சேமிக்கப்பட்டது', '↕️ YOUR TOPIC ORDER SAVED 📌', [
  [true, 'Order : ↕️ உங்களுக்கான topic [[வரிசை]], [[சேமிக்கப்பட்டது]] ✅'],
  [null, 'Next : 📌 அடுத்த [[topic]] தேர்வில், இந்த [[வரிசை]] வரும் 👍'],
]);
const orderInvalid = () => note('⚠️ எண்கள் சரியில்லை', '⚠️ ORDER NOT SAVED 🔢', [
  [false, 'Numbers : 🔢 பட்டியலில் உள்ள [[எண்களை]] மட்டும், ஒவ்வொன்றையும் [[ஒருமுறை]] அனுப்புங்கள்!'],
  [null, 'Example : ✍️ [[உதாரணம்]]: [[3, 1, 5, 2]] 👍'],
]);
const orderPage = titles => note('↕️ உங்கள் Topic வரிசை 📌', `↕️ ${titles.length} TOPICS · SEND THE ORDER 🔢`, [
  [null, 'Send : 🔢 வேண்டிய [[வரிசையில்]] எண்களை அனுப்புங்கள்; ✍️ உதாரணம்: [[3, 1, 5, 2]]'],
  [null, 'Rest : 📌 குறிப்பிடாத topics, அதன் [[பிறகு]] வரும்; 🗑️ எதுவும் [[நீக்கப்படாது]] 👍'],
], {pre: R.sub('📌 இப்போதைய வரிசை') + '<p>' + titles.map((t, i) => R.mono((i + 1) + '. ') + R.esc(t)).join('<br>') + '</p>'});

// ---- menus ----
const home = sender => note('📷 Media Bot 📤✨', '📷 SEND MEDIA → 📌 CHOOSE TOPIC → 📤 POSTED', [
  [null, 'Send : 📷 [[Image]], [[video]], அல்லது 2–10 படங்கள்/வீடியோக்கள் கொண்ட 🖼️ [[Album]] அனுப்புங்கள்!'],
  [null, `Post : 📌 [[Topic]] தேர்வு செய்ததும், 👤 ${at(sender)} மூலம் [[பதிவிடப்படும்]] 📤`],
  [null, 'Analyze : ✨ [[சுருக்கம்]] + 🏷️ Hashtags: media-க்கு Reply செய்து [[/analyze]] 👍'],
  [null, 'Buttons : 👇 கீழே உள்ள [[buttons]] மூலமும் [[தேர்வு]] செய்யலாம் 😊'],
]);
const help = sender => note('📷 Media Bot உதவி ℹ️', '📷 SEND MEDIA → 📌 CHOOSE TOPIC → 📤 POSTED', [
  [null, 'Send : 📷 [[Image]] அல்லது [[video]] அனுப்புங்கள்; 📝 caption இருந்தாலும் இல்லாவிட்டாலும் பரவாயில்லை!'],
  [null, `Post : 📌 [[Topic]] தேர்வு செய்தால், 👤 ${at(sender)} பெயரில் [[பதிவிடப்படும்]] 📤`],
  [null, 'Analyze : ✨ 3–4 வரிச் [[சுருக்கம்]] + 🏷️ Hashtags வேண்டுமா? media-க்கு Reply செய்து [[/analyze]] 👍'],
  [null, 'Mode : 🔁 அல்லது [[/analyze]] கொடுத்துவிட்டு, 📷 [[அடுத்த]] ஒரு media அனுப்புங்கள்'],
  [null, 'Group : ↩️ Group-ல் பதிவிட்ட media-க்கும் Reply செய்யலாம்; 🔁 அது [[மீண்டும்]] [[பதிவாகாது]] ✅'],
]);
const unsupported = album => album ? note('⚠️ தனியாக அனுப்புங்கள்', '⚠️ ALBUM NOT SUPPORTED HERE 🖼️', [
  [false, 'Album : 🖼️ இங்கே [[Album]] support, இன்னும் [[இல்லை]]! 😟'],
  [null, 'Send : 📷 ஒரு [[image]] அல்லது [[video]]-வைத் தனியாக அனுப்புங்கள் 👍'],
]) : note('⚠️ Image / Video மட்டும்', '⚠️ ONLY IMAGE OR VIDEO 📷', [
  [false, 'File : 📎 இந்த [[வகை]] message-ஐ, ஏற்க [[முடியாது]]! 😟'],
  [null, 'Send : 📷 [[Image]] அல்லது [[video]] அனுப்புங்கள்; 📝 caption-ஐ media உடன் சேர்க்கலாம் 👍'],
]);
const pendingList = count => note('🗂 காத்திருக்கும் பதிவுகள்', count ? `🗂 ${count} WAITING POSTS 📌` : '🗂 NO WAITING POSTS ✨', count ? [
  [null, `Waiting : 🗂 [[${count}]] பதிவுகள், 📌 [[topic]] தேர்வுக்காகக் காத்திருக்கின்றன ⏳`],
  [null, 'Choose : 👇 தொடர வேண்டிய [[பதிவைத்]] [[தேர்வு]] செய்யுங்கள் 😊'],
] : [
  [null, 'Waiting : 🗂 காத்திருக்கும் [[பதிவுகள்]] [[இல்லை]] ✨'],
  [null, 'Send : 📷 [[புதிய]] media [[அனுப்பலாம்]] 👍'],
]);
const albumCollecting = count => note('🖼 Album பெறப்படுகிறது ⏳', `🖼️ ALBUM ARRIVING · ${count || 1} MEDIA 📥`, [
  [true, `Received : 📥 இதுவரை [[${count || 1} media]], [[வந்துள்ளன]] ✅`],
  [null, 'Send : 🖼️ எல்லா [[படங்கள்/வீடியோக்களும்]] [[அனுப்பி]] முடியுங்கள் 📤'],
  [null, 'Ready : 👇 பிறகு கீழே [[Album தயார்]] அழுத்துங்கள்; 📌 [[topic]] பெயர்கள் வரும் ✨'],
]);

// 📍 topic question (private chat). summaryLines / tags shown when the media was analysed.
function topicQuestion({kind = 'image', count = 1, summaryLines = [], tags = [], topicCount = 0, page = 0, pages = 1}) {
  const icon = kind === 'album' ? '🖼️🖼️' : kind === 'video' ? '🎬' : '📷';
  const what = kind === 'album' ? `${count} media album` : kind === 'video' ? 'video' : 'image';
  const lines = [
    [true, `Ready : ${icon} உங்கள் [[${what}]], பதிவிடத் [[தயார்]] ✅`],
    ...(summaryLines.length ? [[true, `Summary : 📝 [[${summaryLines.length} வரிச்]] சுருக்கம் + 🏷️ [[${tags.length} hashtags]], caption-ல் சேரும் ✨`]] : []),
    [null, `Topic : 📌 எந்த [[topic]]-ல் பதிவிட வேண்டும்? 👇 கீழே [[தொடுங்கள்]]${pages > 1 ? ` (${page + 1}/${pages})` : ''}`],
    ...(topicCount && pages <= 1 ? [[null, `List : 📚 [[${topicCount} topics]], [[ஒரே]] பட்டியல் 😊`]] : []),
    ...(kind === 'album' ? [[null, `Album : 🖼️ எல்லா [[${count} media]]-வும், ஒரே [[album]] ஆக வெளியாகும் 👍`]] : []),
  ];
  const tapHtml = summaryLines.length || tags.length ? [...summaryLines.map(s => R.line(/^[A-Za-z][A-Za-z ]{0,20}? : /.test(s) ? s : `Summary : 📝 ${s}`)), tags.length ? R.mono(tags.join(' ')) : ''].filter(Boolean).join('<br><br>') : '';
  return note('📍 Topic தேர்வு செய்யுங்கள் 📤', `${icon} ${kind === 'album' ? count + ' MEDIA' : '1 ' + what.toUpperCase()} → 📌 CHOOSE TOPIC`, lines, {tapHtml});
}

// ---- audio ----
const audioError = e => /_(SIZE|DURATION)$/.test(e.message) ? note('⚠️ Audio மிக நீளம்', '⚠️ AUDIO TOO LONG 🎙️', [
  [false, 'Limit : 📏 Audio அதிகபட்சம் [[20 MB]] / [[20 நிமிடங்கள்]] இருக்க வேண்டும்!'],
  [null, 'Split : ✂️ முழுவதும் சுருக்க, [[நீளமான]] audio-வை [[பகுதிகளாக]] அனுப்புங்கள் 👍'],
]) : e.message === 'NNA_AUDIO_REQUIRED' ? note('🎙️ Audio அனுப்புங்கள்', '🎙️ VOICE OR AUDIO NEEDED 🎧', [
  [false, 'Audio : 🎧 இது [[voice]] / [[audio]] இல்லை! 😟'],
  [null, 'Send : 🎙️ [[Voice message]] அல்லது [[audio file]] அனுப்புங்கள் 👍'],
  [null, 'Old : ↩️ அனுப்பிய [[audio]]-க்கு Reply செய்து, [[/audiosummary]] கொடுக்கலாம்'],
]) : note('⚠️ Audio புரியவில்லை', '❌ AUDIO SUMMARY FAILED 🎙️', [
  [false, 'Audio : 🎧 Audio-வை [[முழுமையாகப்]] புரிந்துகொள்ள, [[முடியவில்லை]]! 😟'],
  [null, 'Retry : ⏳ சிறிது [[நேரம்]] கழித்து, audio-க்கு Reply செய்து [[/audiosummary]] 🔁'],
]);
const audioArmed = () => note('🎙️ Audio Summary 🎧✨', '🎙️ SEND VOICE OR AUDIO → 📝 TAMIL SUMMARY', [
  [true, 'Mode : 🎙️ [[Audio Summary]], [[தயார்]] ✅'],
  [null, 'Send : 🎧 [[Voice message]] அல்லது [[audio file]] அனுப்புங்கள் 👇'],
  [null, 'Result : 👤 யார் அனுப்பியது, 📌 முக்கிய கருத்துகள், 📝 [[சுருக்கம்]] [[தமிழில்]] கிடைக்கும் ✨'],
  [null, 'Limit : 📏 வரம்பு [[20 MB]] / [[20 நிமிடங்கள்]] ⏱️'],
  [null, 'Old : ↩️ அனுப்பிய [[audio]]-க்கு Reply செய்து, [[/audiosummary]] பயன்படுத்தலாம் 👍'],
]);

// ---- image / video report ----
const reportArmed = () => note('🔎 Image / Video Report ✨', '🔎 SEND MEDIA → 📝 SUMMARY + 🏷️ HASHTAGS', [
  [true, 'Mode : 🔎 [[Media Report]], [[தயார்]] ✅'],
  [null, 'Send : 📷 அடுத்து ஒரு [[image]] அல்லது [[video]] அனுப்புங்கள் 👇'],
  [null, 'Result : 📝 English [[summary]] + 🏷️ [[hashtags]], தனித்தனியாக 📋 copy செய்யலாம் ✨'],
  [null, 'Old : ↩️ அனுப்பிய [[media]]-க்கு Reply செய்து, [[/mediareport]] கொடுக்கலாம்'],
  [null, 'Cancel : ❌ [[ரத்து]] செய்ய [[/cancelmedia]] 🙂'],
]);

// ---- group ----
const openPrivate = bot => note('↗️ தனிப்பட்ட Chat-ல் திறக்கவும்', '↗️ OPEN IN PRIVATE CHAT 🤖', [
  [null, `Private : 🔒 இந்த [[வசதி]], @${bot} [[தனிப்பட்ட]] chat-ல் மட்டும் 🤖`],
  [null, 'Open : 👇 கீழே உள்ள [[button]]-ஐ [[அழுத்துங்கள்]] 😊'],
], {place: '📍 #NNA group'});
const groupAnalysisMenu = bot => note('🔎 Group Image / Video Analysis', '🔎 REPLY → /ANALYZE → 📝 RESULT HERE', [
  [null, `Analyze : ↩️ [[Image]] அல்லது video-க்கு Reply செய்து, [[/analyze@${bot}]] அனுப்புங்கள் 👍`],
  [null, 'Result : 📝 முடிவு [[இதே]] topic-ல், அந்த media-க்கு [[Reply]] ஆக வரும் ✨'],
  [null, 'Private : 🔒 Topic [[வரிசை]], 📤 media [[publishing]] தனிப்பட்ட chat-ல் தொடரும் 😊'],
], {place: '📍 #NNA group'});

// the topic question after the post: its topic buttons are taken away (rich buttons live inside the html)
const topicDone = topic => note('✅ Topic தேர்வு முடிந்தது', '✅ POSTED IN THE CHOSEN TOPIC 📌', [
  [true, `Topic : 📌 ${topic ? String(topic).replace(/\[|\]/g, '') : 'தேர்ந்தெடுத்த topic'}-ல் [[பதிவிடப்பட்டது]] ✅`],
  [null, 'Receipt : 🧾 முழு [[விவரம்]], [[receipt]]-ல் உள்ளது 👇'],
]);
module.exports = {note, topicDone, publishUncertain, publishFailed, albumFailed, alreadySent, alreadyCancelled, busy, editPrompt, editFailed,
  replyFirst, freshCommand, analysisBusy, armed, disarmed, progress, analysisFailed, unreliable, noResult, cancelled, backToMenu,
  albumBlocked, albumLate, albumAnalyze, orderReset, orderSaved, orderInvalid, orderPage, home, help, unsupported,
  pendingList, albumCollecting, topicQuestion, audioError, audioArmed, reportArmed, openPrivate, groupAnalysisMenu};
