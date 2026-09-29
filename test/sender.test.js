'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Api } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { runOperation, parseApprovedHTML, deterministicRandomId, createClient } = require('../dist/nodes/NnaTelegramSender/sender');
const { NnaTelegramSender } = require('../dist/nodes/NnaTelegramSender/NnaTelegramSender.node');
const bigInt = require('big-integer');
const now = Date.parse('2026-09-24T00:00:00Z');
// Synthetic values only. No real account, session, TCP connection, or Telegram calls.
const c = { apiId: 12345, apiHash: 'a'.repeat(32), sessionString: '1' + 'A'.repeat(352), expectedUserId: '1234567890', expectedUsername: 'example_owner', allowedGroupId: '-1001234567890', allowedGroupUsername: 'example_group', allowedTopicIds: '10,20' };
const p = { draftKey: 'draft_test_0001', approvedAt: new Date(now).toISOString(), ownerId: c.expectedUserId, approvalClaimToken: 'execution-12', approvalValidated: true, bodyHTML: '<b>Dear Friend Soul🤍</b>\n\n<b>அன்பு</b>\n<blockquote>கருணையுடன் செயல்படுங்கள். 🤍🙏</blockquote>\n\n<b>#BotAns</b>', sourceText: 'A question?', messageId: 30, topicId: 10 };
const peerId = () => new Api.PeerChannel({ channelId: bigInt(1234567890) });
const source = () => new Api.Message({ id: p.messageId, peerId: peerId(), message: p.sourceText, date: 100, replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToMsgId: p.topicId, replyToTopId: p.topicId }) });
function fake(overrides = {}) {
  const calls = { send: 0, destroy: 0, sourceReads: 0 };
  const client = {
    connect: async () => {},
    getMe: async () => new Api.User({ id: bigInt(c.expectedUserId), username: c.expectedUsername, bot: false }),
    getEntity: async () => new Api.Channel({ id: bigInt(1234567890), megagroup: true, forum: true, accessHash: bigInt(22), title: 'Example' }),
    getInputEntity: async () => new Api.InputPeerChannel({ channelId: bigInt(1234567890), accessHash: bigInt(22) }),
    getMessages: async () => { calls.sourceReads++; return [source()]; },
    invoke: async request => {
      calls.send++; calls.request = request;
      const sent = new Api.Message({ id: 50, out: true, fromId: new Api.PeerUser({ userId: bigInt(c.expectedUserId) }), peerId: peerId(), message: request.message, entities: request.entities, date: 100, replyTo: new Api.MessageReplyHeader({ forumTopic: true, replyToMsgId: p.messageId, replyToTopId: p.topicId }) });
      return new Api.Updates({ updates: [new Api.UpdateMessageID({ id: 50, randomId: request.randomId }), new Api.UpdateNewChannelMessage({ message: sent, pts: 1, ptsCount: 1 })], users: [], chats: [], date: 100, seq: 1 });
    },
    destroy: async () => { calls.destroy++; },
    ...overrides,
  };
  return { client, calls, deps: { now, createClient: async () => client } };
}
test('identity operation sends nothing and always destroys its short-lived client', async () => {
  const f = fake(); const result = await runOperation('getIdentity', c, {}, f.deps);
  assert.equal(result.senderId, c.expectedUserId); assert.equal(f.calls.send, 0); assert.equal(f.calls.destroy, 1); assert.equal(f.calls.sourceReads, 0);
});
test('read-only identity rejects wrong user, bot, or wrong username without sending', async () => {
  for (const properties of [{ id: bigInt(7) }, { bot: true }, { username: 'wrong_owner' }]) {
    const f = fake({ getMe: async () => new Api.User({ id: bigInt(c.expectedUserId), username: c.expectedUsername, ...properties }) });
    await assert.rejects(runOperation('getIdentity', c, {}, f.deps), /NNA_WRONG/); assert.equal(f.calls.send, 0); assert.equal(f.calls.destroy, 1);
  }
});
test('approval, expiry, owner, topic, malformed HTML, and missing format fail before connecting', async () => {
  for (const patch of [{ approvalValidated: false }, { ownerId: '55' }, { approvedAt: '2026-09-20T00:00:00Z' }, { approvedAt: '2026-09-24' }, { topicId: 999 }, { bodyHTML: '<b>wrong</b>' }, { bodyHTML: '<a href="https://example.com">link</a>' }]) {
    let created = 0;
    await assert.rejects(runOperation('sendApprovedReply', c, { ...p, ...patch }, { now, createClient: async () => { created++; } }), /NNA_/); assert.equal(created, 0);
  }
});
test('wrong group, deleted source, wrong topic, changed source or edit after approval never send', async () => {
  const cases = [
    { getEntity: async () => new Api.Channel({ id: bigInt(999), megagroup: true, forum: true }) },
    { getMessages: async () => [] },
    { getMessages: async () => [{ ...source(), replyTo: { forumTopic: true, replyToTopId: 99 } }] },
    { getMessages: async () => [{ ...source(), message: 'Edited question' }] },
    { getMessages: async () => [{ ...source(), editDate: now / 1000 + 1 }] },
  ];
  for (const patch of cases) { const f = fake(patch); await assert.rejects(runOperation('sendApprovedReply', c, p, f.deps), /NNA_/); assert.equal(f.calls.send, 0); assert.equal(f.calls.destroy, 1); }
});
test('approved send uses exact topic/reply/account and deterministic signed64 randomId', async () => {
  const f = fake(); const result = await runOperation('sendApprovedReply', c, p, f.deps);
  assert.deepEqual(result, { status: 'sent', draftKey: p.draftKey, sentId: 50, senderId: c.expectedUserId, target: c.allowedGroupId, topicId: 10, replyToMessageId: 30 });
  const request = f.calls.request;
  assert.equal(request.className, 'messages.SendMessage'); assert.equal(request.replyTo.replyToMsgId, 30); assert.equal(request.replyTo.topMsgId, 10);
  assert.equal(request.sendAs.className, 'InputPeerSelf'); assert.equal(request.noWebpage, true); assert.ok(request.getBytes().length > 0);
  assert.equal(request.randomId.toString(), deterministicRandomId(c, p.draftKey).toString()); assert.equal(f.calls.send, 1); assert.equal(f.calls.destroy, 1);
  assert.ok(!JSON.stringify(result).includes(p.sourceText)); assert.ok(!JSON.stringify(result).includes('bodyHTML'));
});
test('post-send RPC failure is ambiguous, sanitized, destroyed, and not retried', async () => {
  let send = 0; const f = fake({ invoke: async () => { send++; throw new Error('secret-session-and-message'); } });
  await assert.rejects(runOperation('sendApprovedReply', c, p, f.deps), e => /NNA_DELIVERY_UNCONFIRMED/.test(e.message) && !e.message.includes('secret'));
  assert.equal(send, 1); assert.equal(f.calls.destroy, 1);
});
test('unmapped response never pretends delivery was verified', async () => {
  const f = fake({ invoke: async () => ({ updates: [] }) });
  await assert.rejects(runOperation('sendApprovedReply', c, p, f.deps), /NNA_DELIVERY_UNCONFIRMED/); assert.equal(f.calls.destroy, 1);
});
test('HTML parsing preserves Tamil+emoji UTF16 formatting and rejects hidden attributes/links', () => {
  const parsed = parseApprovedHTML(p.bodyHTML);
  assert.ok(parsed.entities.some(e => e.className === 'MessageEntityBlockquote'));
  for (const entity of parsed.entities) assert.ok(entity.offset + entity.length <= parsed.text.length);
  for (const bad of ['<b onclick="x">x</b>', '<script>x</script>', '<b><i>x</b></i>', '<a>x</a>', '<b>x</b><']) assert.throws(() => parseApprovedHTML(bad));
});
test('synthetic Telethon IPv4 StringSession imports; client is configured securely without networking', async () => {
  const raw = Buffer.concat([Buffer.from([2, 149, 154, 167, 51, 1, 187]), Buffer.alloc(256, 42)]);
  const encoded = '1' + raw.toString('base64'); const session = new StringSession(encoded); await session.load();
  assert.equal(session.serverAddress, '149.154.167.51'); assert.equal(session.port, 443); assert.equal(session.authKey.getKey().length, 256);
  const client = await createClient({ ...c, sessionString: encoded });
  assert.equal(client._securityChecks, true); assert.equal(client._requestRetries, 1); assert.equal(client._connectionRetries, 1); assert.equal(client._autoReconnect, false); assert.equal(client._log.logLevel, 'none');
  await client.destroy();
});
test('n8n node defaults to read-only identity and credentials hide secrets', () => {
  const { NnaTelegramSender: Credential } = require('../dist/credentials/NnaTelegramSender.credentials');
  const node = new NnaTelegramSender(); assert.equal(node.description.properties[0].default, 'getIdentity');
  for (const field of ['apiHash', 'sessionString']) assert.equal(new Credential().properties.find(p => p.name === field).typeOptions.password, true);
});
test('node rejects Retry On Fail or a claim from a different execution before networking', async () => {
  const node = new NnaTelegramSender();
  const context = { getInputData: () => [{}], getCredentials: async () => c, getNodeParameter: name => name === 'operation' ? 'sendApprovedReply' : p[name], getExecutionId: () => 'execution-12' };
  await assert.rejects(node.execute.call({ ...context, getNode: () => ({ retryOnFail: true }) }), /NNA_DISABLE_RETRY_ON_FAIL/);
  await assert.rejects(node.execute.call({ ...context, getNode: () => ({}), getExecutionId: () => 'another-execution' }), /NNA_CLAIM_EXECUTION_MISMATCH/);
});
test('post-send sender mismatch and changed returned text remain unconfirmed', async () => {
  for (const patch of [{ fromId: new Api.PeerUser({ userId: bigInt(99) }) }, { message: 'changed' }]) {
    const f = fake(); const original = f.client.invoke;
    f.client.invoke = async req => { const result = await original(req); Object.assign(result.updates[1].message, patch); return result; };
    await assert.rejects(runOperation('sendApprovedReply', c, p, f.deps), /NNA_DELIVERY_UNCONFIRMED/); assert.equal(f.calls.send, 1);
  }
});
