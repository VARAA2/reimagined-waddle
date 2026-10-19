'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../dist/nodes/NnaMediaCollection/rich-format');
const P = require('../dist/nodes/NnaMediaCollection/rich-reports');

test('a line gets its emoji in front of the bold English label and yellow key words', () => {
  const html = R.line('Upload : 📤 [[3 images]] upload, **Notion** ready');
  assert(html.startsWith('📤 <b>' + R.mono('Upload') + '</b> : '));
  assert.equal((html.match(/<mark>/g) || []).length, 2);
  assert(R.line('Text : no emoji').startsWith('🔹 <b>'));
});

test('ticks: a tick only for a finished step, ❌ for failed, never an empty box', () => {
  const html = R.ticks([[true, 'Done : ✅ [[ok]] [[yes]]'], [false, 'Failed : 🚫 [[no]] [[x]]'], [null, 'Info : ℹ️ [[a]] [[b]]']]);
  assert(html.includes('<input type="checkbox" checked>'));
  assert(!html.includes('<input type="checkbox">'));
  assert(html.includes('❌ '));
});

test('report pages carry title, pull quote with emoji, dividers, copy buttons and a plain fallback', () => {
  const pages = [
    P.receiptPage({kind: 'image', topicLabel: '🎬 Cinema', caption: 'Hello', url: 'https://t.me/c/1/2/3', editData: 'mc:k:1:edit'}),
    P.receiptPage({kind: 'album', count: 3, topicLabel: '📁 Art', url: 'https://t.me/c/1/2/4'}),
    P.reportPage({summaryLines: ['Scene : 🌧️ A **rainy** street.', 'Mood : 😌 **Calm** walk.', 'Use : 🎬 Good **intro**.'], tags: ['#rain', '#calm']}),
    P.audioPage({sender: 'Asha', senderId: '5', when: '19 Oct 2026, 6:00 am', duration: 75, summary: 'Summary : 🎙️ **தியானம்** பற்றி.', points: ['Breath : 🌬️ **மூச்சு**'], unclear: []}),
  ];
  for (const html of pages) {
    assert(html.includes('<h1><u>') && /<aside>\p{Extended_Pictographic}/u.test(html) && html.includes('<hr>'));
    assert(!html.includes('<input type="checkbox">'));
    assert(R.plain(html).length > 10 && !R.plain(html).includes('<'));
  }
  assert.equal((pages[2].match(/type="copy_text"/g) || []).length, 2);
  assert(pages[0].includes('data="mc:k:1:edit"'));
  assert(!R.plain(pages[2]).includes('**'));
});
