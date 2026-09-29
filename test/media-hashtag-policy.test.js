'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {selectHashtags,composeCaption,summaryLines,composeAnalysisCaption} = require('../dist/nodes/NnaMediaCollection/hashtag-policy.cjs');
const c = tag => ({tag,confidence:0.9,evidence:'Explicitly supported in this synthetic test.'});
test('canonical aliases deduplicate without expanding religious subjects',()=>{
  const r=selectHashtags({candidates:[c('Jesus'),c('#JesusChrist'),c('jesus')]});
  assert.deepEqual(new Set(r.tags),new Set(['#Jesus','#Gods','#Deities']));
  assert(!r.tags.includes('#Bible'));
  assert.deepEqual(new Set(selectHashtags({candidates:[c('Perumal')]}).tags),new Set(['#Perumal','#Gods','#Deities']));
});
test('previously returned tags reuse their stored spelling and count as known',()=>{
  const r=selectHashtags({candidates:['Nature','Art','Music','Travel','streetphotography','StreetPhotography','NewTopic'].map(c)},['#StreetPhotography']);
  assert(r.tags.includes('#StreetPhotography'));assert.equal(r.tags.filter(x=>x.toLowerCase()==='#streetphotography').length,1);
  assert.equal(r.knownCount,5);assert.equal(r.novelCount,1);assert(r.novelCount/r.tags.length<=.2);
  assert.deepEqual(selectHashtags({candidates:[c('JesusChrist')]},['#JesusChrist']).tags.sort(),['#Deities','#Gods','#Jesus']);
});
test('English summary has three or four short lines and rejects non-Latin or mixed-script text',()=>{
  const valid=['A lit lamp stands inside a stone lantern.','Clouds and rays of light fill the background.','The artwork creates a peaceful atmosphere.'];assert.deepEqual(summaryLines({summaryLines:valid}),valid);
  assert.deepEqual(summaryLines({summaryLines:[...valid,'A café sign is visible.']}),[...valid,'A café sign is visible.']);
  for(const lines of [[],valid.slice(0,2),[...valid,'Fourth line.','Fifth line.'],['1','2','3'],['First\nsecond',...valid.slice(1)],['#Nature',...valid.slice(1)],['https://example.test image',...valid.slice(1)],['இது ஒரு படம்.',...valid.slice(1)],['A தமிழ் lamp.',...valid.slice(1)],['दीपक',...valid.slice(1)],['A 灯笼.',...valid.slice(1)],['x'.repeat(161),...valid.slice(1)]])assert.throws(()=>summaryLines({summaryLines:lines}),/INVALID_SUMMARY/);
});
test('optional summary caption composition preserves original entities and fails without truncation',()=>{
  const lines=['A lamp is visible.','Clouds fill the sky.','The image conveys peace.'];const original='🙏 Original',entities=[{type:'bold',offset:3,length:8}];
  const r=composeAnalysisCaption(original,entities,lines,['#Faith'],1024);assert.equal(r.caption,original+'\n\n'+lines.join('\n')+'\n\n#Faith');assert.deepEqual(r.captionEntities,entities);
  const overflow=composeAnalysisCaption('x'.repeat(1000),[],lines,['#Faith']);assert.equal(overflow.status,'needs_edit');assert.equal(overflow.caption,'x'.repeat(1000));
});
test('novel tags occupy at most 20 percent with sufficient known evidence',()=>{
  const r=selectHashtags({candidates:['Jesus','Christianity','Bible','Gods','Spirituality','Devotion','Faith','Prayer','Compassion','Forgiveness','Love','Peace','SermonOnTheMount','GoodSamaritan','BreadOfLife','ExtraTag'].map(c)});
  assert.equal(r.tags.length,15);assert.equal(r.knownCount,12);assert.equal(r.novelCount,3);
});
test('small supported set is not padded and still respects novelty share',()=>{
  const r=selectHashtags({candidates:['Nature','Music','Art','NewOne','NewTwo'].map(c)});
  assert.equal(r.tags.length,3);assert.equal(r.novelCount,0);assert.equal(r.needsReview,false);
});
test('ambiguous, invalid, low-confidence and ungrounded classifications rejected',()=>{
  const r=selectHashtags({candidates:[c('Demigod'),{...c('Jesus'),confidence:0.2},c('two words'),{...c('Gods'),evidence:''}]});
  assert.equal(r.tags.length,0);assert.equal(r.rejected.length,4);
  assert.deepEqual(selectHashtags({candidates:[{...c('Demigod'),explicitClassification:true}]}).tags,['#Demigod']);
});
test('caption and UTF-16 entity offsets remain exact',()=>{
  const text='🙏 இயேசு #JesusChrist',entities=[{type:'bold',offset:3,length:5}];
  const r=composeCaption(text,entities,['#Jesus','#Faith']);
  assert.equal(r.caption,text+'\n\n#Faith');assert.deepEqual(r.captionEntities,entities);
  assert.notEqual(r.captionEntities,entities);
});
test('empty caption, hashtags disabled and duplicate aliases work',()=>{
  assert.equal(composeCaption('',[],['#JesusChrist','#Jesus']).caption,'#Jesus');
  assert.equal(composeCaption('',[],[]).caption,'');
  assert.equal(composeCaption('original',[],[]).caption,'original');
});
test('caption overflow is explicit without truncation or entity corruption',()=>{
  const original='x'.repeat(1024);const r=composeCaption(original,[],['#Jesus']);
  assert.equal(r.status,'needs_edit');assert.equal(r.caption,original);
  assert.throws(()=>composeCaption('a',[{type:'bold',offset:0,length:2}],[]),/INVALID_ENTITY_RANGE/);
  assert.throws(()=>composeCaption('',[],['bad tag']),/INVALID_HASHTAG/);
});
