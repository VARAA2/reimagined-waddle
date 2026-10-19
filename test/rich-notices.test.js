'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const RN=require('../dist/nodes/NnaMediaCollection/rich-notices'),PP=require('../dist/nodes/NnaPollStudio/rich-pages'),{plain}=require('../dist/nodes/NnaMediaCollection/rich-format');
const draft=type=>({settings:{type,anonymous:false,multiple:false,revote:true,shuffle:false,adding:false,seconds:0,hide:false,members:false,countries:[],correct:type==='quiz'?[1]:[],othersAppend:true,othersComplete:false,description:'d <b>',explanation:type==='quiz'?'e & f':''},poll:{question:{text:'Which <time>?'},answers:['8 AM','6 PM','**9** PM'].map(text=>({text}))}});
const pages=()=>[
 RN.help('sender'),RN.home('sender'),RN.topicQuestion({kind:'image',topicCount:3}),RN.topicQuestion({kind:'album',count:3,summaryLines:['Lamp : 🪔 A **brass** **lamp**.'],tags:['#Lamp']}),
 RN.albumCollecting(2),RN.pendingList(2),RN.pendingList(0),RN.orderPage(['A','B']),RN.orderSaved(),RN.orderReset(),RN.orderInvalid(),RN.progress(),RN.analysisFailed(false),RN.analysisFailed(true),
 RN.unreliable('/mediareport'),RN.noResult('/analyze'),RN.armed(),RN.disarmed(),RN.analysisBusy(),RN.replyFirst('/analyze'),RN.unsupported(true),RN.unsupported(false),RN.publishFailed('bot'),
 RN.publishUncertain(),RN.albumFailed(),RN.alreadySent('https://t.me/c/1/2/3',true),RN.alreadySent(''),RN.alreadyCancelled(),RN.busy(true),RN.busy(false,true),RN.busy(false),RN.editPrompt(),RN.editFailed(),
 RN.cancelled('Analysis',[RN.backToMenu]),RN.albumBlocked(true),RN.albumBlocked(false),RN.albumLate(),RN.albumAnalyze(),RN.audioArmed(),RN.audioError(Error('X_SIZE')),RN.audioError(Error('NNA_AUDIO_REQUIRED')),
 RN.audioError(Error('other')),RN.reportArmed(),RN.freshCommand('/mediareport'),RN.openPrivate('bot'),RN.groupAnalysisMenu('bot'),
 PP.home(),PP.groupHome(),PP.openPrivate('bot','/history'),PP.start(),PP.input('poll'),PP.input('quiz'),PP.input('checklist'),...['correct','timer','countries','description','explanation','code'].map(PP.ask),
 PP.preview(draft('poll'),'sender'),PP.preview(draft('quiz'),'sender'),PP.preview(draft('checklist'),'sender'),PP.list([['code',draft('poll')]],'sender'),PP.list([],'sender'),PP.topicGroups(2),PP.privateTopics(),
 PP.topicPage('G',1,3),PP.destinations(2),PP.confirm(draft('quiz'),'T','sender'),PP.published('poll','sender','https://t.me/c/1/2/3'),PP.saved('code','sender'),PP.cancelled(true),PP.cancelled(false),
 PP.parseError('Options missing'),PP.failed('Timer wrong'),PP.previewControls(true),PP.previewControls(false),
];
test('every 0.42.0 status / menu page has the locked NNA look',()=>{
 for(const html of pages()){
  const text=plain(html);
  assert(html.startsWith('<h1><u>'),text.slice(0,40));assert(/<aside>[^]*<cite>/.test(html),text.slice(0,40));assert(html.includes('<hr>'),text.slice(0,40));
  assert(!html.includes('<input type="checkbox">'),'empty box: '+text.slice(0,40));assert(!/\bNNA\b/.test(html.replace(/#NNA/g,'')),'NNA without #');
  for(const line of html.split(/<li>|<br><br>|<p>/).filter(x=>/<b>/.test(x)&&!/<details>|<h1>|<blockquote>/.test(x)))
   assert((line.match(/<mark>/g)||[]).length>=2,'needs 2+ yellow words: '+plain(line).slice(0,60));
  assert(text.length>20&&text.length<4000);
 }
});
test('user text in poll pages is escaped and never turned into yellow marks',()=>{
 const html=PP.preview(draft('quiz'),'sender');assert(html.includes('&lt;'));assert(!html.includes('<time>'));assert(!html.includes('<b>d'));assert(plain(html).includes('**9** PM'));
});
