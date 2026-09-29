'use strict';
const { createHash } = require('node:crypto');
const { TelegramClient, Api, utils } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { HTMLParser } = require('teleproto/extensions/html');
const { Logger } = require('teleproto/extensions/Logger');
const bigInt = require('big-integer');
const { historyQuery, readHistory } = require('./history');
const { parseDirectRequest, sendDirect } = require('./direct');
const { request:reactionRequest,runReaction,sendDirectReaction } = require('./reactions');
const {imageReactionConfig,imageReactionEvent,scheduledImageReaction}=require('./image-reactions');
const topicReactions=require('./topic-reactions');
const topicState=require('./topic-state');
const membershipDM=require('./membership-dm');
const mediaPublish=require('./media-publish');
class GuardError extends Error { constructor(code) { super(code); this.name = 'GuardError'; } }
const requireThat = (condition, code) => { if (!condition) throw new GuardError(code); };
const id = value => value === undefined || value === null ? '' : value.toString();
const integer = value => (typeof value === 'number' || typeof value === 'string') && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
async function bounded(promise, milliseconds = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new GuardError('NNA_OPERATION_TIMEOUT')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function validateCredentials(c) {
  requireThat(integer(c.apiId) && /^[a-f0-9]{32}$/i.test(c.apiHash || ''), 'NNA_INVALID_API_CREDENTIALS');
  requireThat(typeof c.sessionString === 'string' && /^1[A-Za-z0-9+/=_-]+$/.test(c.sessionString), 'NNA_INVALID_SESSION');
  requireThat(/^[1-9]\d{0,15}$/.test(id(c.expectedUserId)), 'NNA_INVALID_EXPECTED_USER');
  requireThat(/^-100[1-9]\d+$/.test(c.allowedGroupId || ''), 'NNA_INVALID_ALLOWED_GROUP');
  requireThat(/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(c.allowedGroupUsername || ''), 'NNA_INVALID_GROUP_USERNAME');
  const topics = String(c.allowedTopicIds || '').split(',').map(s => s.trim());
  requireThat(topics.length > 0 && topics.every(s => /^\d+$/.test(s) && integer(s)), 'NNA_INVALID_TOPICS');
  return { ...c, topics: topics.map(Number) };
}

function parseApprovedHTML(html) {
  requireThat(typeof html === 'string' && html.length <= 16000 && html === html.trim(), 'NNA_INVALID_BODY');
  const stack = []; let cursor = 0;
  for (const tag of html.matchAll(/<[^>]*>/g)) {
    requireThat(!/[<>]/.test(html.slice(cursor, tag.index)), 'NNA_INVALID_HTML');
    const m = /^<(\/)?(b|i|u|s|code|pre|blockquote)>$/.exec(tag[0]);
    requireThat(m, 'NNA_UNSUPPORTED_HTML');
    if (m[1]) requireThat(stack.pop() === m[2], 'NNA_UNBALANCED_HTML');
    else stack.push(m[2]);
    cursor = tag.index + tag[0].length;
  }
  requireThat(stack.length === 0 && !/[<>]/.test(html.slice(cursor)), 'NNA_UNBALANCED_HTML');
  const [text, entities] = HTMLParser.parse(html);
  requireThat(text.length > 0 && text.length <= 3500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), 'NNA_INVALID_BODY_LENGTH');
  requireThat(/^Dear [^\r\n]+ Soul🤍\n\n/.test(text) && /\n\n#BotAns$/.test(text), 'NNA_REQUIRED_REPLY_FORMAT');
  requireThat(!/(?:https?:\/\/|www\.|tg:\/\/)/i.test(text), 'NNA_UNAPPROVED_LINK');
  return { text, entities };
}

function validateApproval(c, p, now) {
  requireThat(p.approvalValidated === true && id(p.ownerId) === id(c.expectedUserId), 'NNA_OWNER_APPROVAL_REQUIRED');
  requireThat(/^[A-Za-z0-9_-]{8,128}$/.test(p.draftKey || '') && /^[A-Za-z0-9:_-]{1,128}$/.test(p.approvalClaimToken || ''), 'NNA_INVALID_APPROVAL_CLAIM');
  const approved = Date.parse(p.approvedAt);
  requireThat(typeof p.approvedAt === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(p.approvedAt) && Number.isFinite(approved) && approved <= now + 30000 && now - approved <= 86400000, 'NNA_STALE_APPROVAL');
  requireThat(integer(p.messageId) && integer(p.topicId) && c.topics.includes(Number(p.topicId)) && Number(p.messageId) !== Number(p.topicId), 'NNA_TARGET_NOT_ALLOWED');
  requireThat(typeof p.sourceText === 'string' && p.sourceText.length <= 16000, 'NNA_INVALID_SOURCE_SNAPSHOT');
  return parseApprovedHTML(p.bodyHTML);
}

function deterministicRandomId(c, draftKey) {
  const digest = createHash('sha256').update(`nna-reply-v1\0${c.expectedUserId}\0${c.allowedGroupId}\0${draftKey}`).digest();
  return bigInt((digest.readBigInt64BE(0) || 1n).toString());
}

function topicOf(message) {
  const reply = message.replyTo;
  if (!reply || reply.forumTopic !== true) return 0;
  return Number(reply.replyToTopId || reply.replyToMsgId || 0);
}

function validateSource(c, p, message) {
  requireThat(message && message.className === 'Message' && Number(message.id) === Number(p.messageId), 'NNA_SOURCE_MISSING');
  requireThat(id(utils.getPeerId(message.peerId)) === c.allowedGroupId && topicOf(message) === Number(p.topicId), 'NNA_SOURCE_WRONG_TOPIC');
  requireThat(message.message === p.sourceText && (!message.editDate || Number(message.editDate) * 1000 <= Date.parse(p.approvedAt)), 'NNA_SOURCE_CHANGED');
}

async function createClient(c) {
  const session = new StringSession(c.sessionString);
  await session.load();
  requireThat(session.authKey && session.authKey.getKey()?.length === 256, 'NNA_INVALID_SESSION');
  const client = new TelegramClient(session, Number(c.apiId), c.apiHash, {
    requestRetries: 1, connectionRetries: 1, reconnectRetries: 0, autoReconnect: false,
    securityChecks: true, floodSleepThreshold: 0, timeout: 15, baseLogger: new Logger('none'),
  });
  // This Teleproto version has no receiveUpdates switch. Register no handlers and
  // destroy the client after the operation; never run a long-lived listener.
  client.onError = async () => {};
  return client;
}

async function runOperation(operation, rawCredentials, p = {}, dependencies = {}) {
  let client, sendStarted = false;
  try {
    requireThat(['getIdentity', 'sendApprovedReply', 'readTopicHistory', 'sendDirectReply','sendDirectReaction','inspectReactionCopy','copyUserReaction','inspectImageReactionScope','reactToScheduledImage','inspectTopicReactionScope','reactToTopicPost','sendMembershipDirectPart','publishMedia','exportUserHistory','inspectMembershipRecordScope','sendMembershipRecord','inspectTopicState','setTopicState','pollLiveAttendance','sendAttendanceReport','readChannelMembership','readMessageTemplate','sendChannelMemberDirect','sendTopicImageForward'].includes(operation), 'NNA_INVALID_OPERATION');
    const c = validateCredentials(rawCredentials);
    if(operation==='exportUserHistory'){
      try{require('./user-history-export').request(c,p,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_EXPORT_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_EXPORT_CHECK_FAILED');}
    }
    if(['inspectMembershipRecordScope','sendMembershipRecord'].includes(operation)){
      try{const records=require('./membership-record');records.config(c,p);if(operation==='sendMembershipRecord')records.validate(c,p,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_RECORD_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_RECORD_CHECK_FAILED');}
    }
    if(operation==='readMessageTemplate'){
      try{require('./message-template').templateConfig(c,p);}
      catch(e){throw new GuardError(/^NNA_TEMPLATE_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_TEMPLATE_CHECK_FAILED');}
    }
    if(operation==='sendChannelMemberDirect'){
      try{require('./channel-member-dm').precheck(c,p,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_(CHANNELDM|MEMBER)_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_CHANNELDM_CHECK_FAILED');}
    }
    if(operation==='sendTopicImageForward'){
      try{require('./topic-image-forward').precheck(c,p,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_TOPICFWD_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_TOPICFWD_CHECK_FAILED');}
    }
    if(operation==='readChannelMembership'){
      try{require('./channel-membership').membershipConfig(c,p);}
      catch(e){throw new GuardError(/^NNA_MEMBERSHIP_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_MEMBERSHIP_CHECK_FAILED');}
    }
    if(operation==='sendAttendanceReport'){
      try{const report=require('./attendance-report');report.config(c,p);p.report.parts.forEach(x=>report.parsePart(x));}
      catch(e){throw new GuardError(/^NNA_REPORT_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_REPORT_CHECK_FAILED');}
    }
    if(operation==='pollLiveAttendance'){
      try{require('./live-attendance').attendanceConfig(c,p);}
      catch(e){throw new GuardError(/^NNA_ATTENDANCE_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_ATTENDANCE_CHECK_FAILED');}
    }
    if(['inspectTopicState','setTopicState'].includes(operation)){
      topicState.topicStateConfig(p,operation);requireThat(p.topicStateGroupId===c.allowedGroupId,'NNA_TOPIC_STATE_GROUP_NOT_ALLOWED');
    }
    if(['inspectTopicReactionScope','reactToTopicPost'].includes(operation)){
      topicReactions.topicReactionConfig(p);requireThat(p.topicReactionGroupId===c.allowedGroupId,'NNA_TOPIC_REACTION_GROUP_NOT_ALLOWED');
      if(operation==='reactToTopicPost')topicReactions.topicReactionClaim(p,dependencies.now??Date.now());
    }
    if(['inspectImageReactionScope','reactToScheduledImage'].includes(operation)){
      imageReactionConfig(p);requireThat(p.imageGroupId===c.allowedGroupId,'NNA_IMAGE_GROUP_NOT_ALLOWED');
      if(operation==='reactToScheduledImage'){const e=imageReactionEvent(p.update,p,dependencies.now??Date.now());requireThat(e&&p.claimValidated===true&&p.claimRequestKey===e.requestKey,'NNA_IMAGE_CLAIM_REQUIRED');}
    }
    if(['inspectReactionCopy','copyUserReaction'].includes(operation))reactionRequest(p);
    const query = operation === 'readTopicHistory' ? historyQuery(c, p, requireThat) : undefined;
    const approvedBody = operation === 'sendApprovedReply' ? validateApproval(c, p, dependencies.now ?? Date.now()) : undefined;
    if(['sendDirectReply','sendDirectReaction'].includes(operation)) {
      const e=parseDirectRequest(p.update,p,dependencies.now??Date.now());
      requireThat(e?.kind===(operation==='sendDirectReaction'?'reaction':'direct')&&p.claimValidated===true&&p.claimRequestKey===e.requestKey&&p.claimBody===e.body&&p.claimUrl===e.targetUrl&&p.claimOperatorId===e.operatorId,'NNA_DIRECT_CLAIM_REQUIRED');
    }
    client = await (dependencies.createClient || createClient)(c);
    await bounded(client.connect());
    const me = await bounded(client.getMe());
    requireThat(me && me.className === 'User' && !me.bot && !me.deleted && id(me.id) === id(c.expectedUserId), 'NNA_WRONG_ACCOUNT');
    requireThat(!c.expectedUsername || String(me.username || '').toLowerCase() === c.expectedUsername.replace(/^@/, '').toLowerCase(), 'NNA_WRONG_USERNAME');
    if (operation === 'getIdentity') return { verified: true, senderId: id(me.id), username: me.username || '', isBot: false };
    if(operation==='exportUserHistory'){
      try{return await require('./user-history-export').run(client,c,p,bounded,dependencies);}
      catch(e){throw new GuardError(/^NNA_EXPORT_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_EXPORT_READ_FAILED');}
    }
    if(['inspectMembershipRecordScope','sendMembershipRecord'].includes(operation)){
      try{return await require('./membership-record').run(operation,client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_RECORD_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_RECORD_CHECK_FAILED');}
    }
    if(operation==='readMessageTemplate'){
      try{return await require('./message-template').runTemplates(operation,client,c,p,bounded);}
      catch(e){throw new GuardError(/^NNA_TEMPLATE_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_TEMPLATE_CHECK_FAILED');}
    }
    if(operation==='sendChannelMemberDirect'){
      try{return await require('./channel-member-dm').runDirect(operation,client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_(CHANNELDM|MEMBER)_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_CHANNELDM_CHECK_FAILED');}
    }
    if(operation==='sendTopicImageForward'){
      try{return await require('./topic-image-forward').run(operation,client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_TOPICFWD_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_TOPICFWD_CHECK_FAILED');}
    }
    if(operation==='readChannelMembership'){
      try{return await require('./channel-membership').runMembership(operation,client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_MEMBERSHIP_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_MEMBERSHIP_CHECK_FAILED');}
    }
    if(operation==='sendAttendanceReport'){
      try{return await require('./attendance-report').run(operation,client,c,p,bounded);}
      catch(e){throw new GuardError(/^NNA_REPORT_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_REPORT_CHECK_FAILED');}
    }
    if(operation==='pollLiveAttendance'){
      try{return await require('./live-attendance').runAttendance(operation,client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_ATTENDANCE_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_ATTENDANCE_CHECK_FAILED');}
    }
    if(['inspectTopicState','setTopicState'].includes(operation)){
      try{return await topicState.runTopicState(operation,client,c,p,bounded);}
      catch(e){throw new GuardError(/^NNA_TOPIC_STATE_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_TOPIC_STATE_CHECK_FAILED');}
    }
    if(['inspectTopicReactionScope','reactToTopicPost'].includes(operation)){
      requireThat(me.premium===true,'NNA_PREMIUM_ACCOUNT_REQUIRED');
      try{return await topicReactions.reactToTopicPost(operation,client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_TOPIC_REACTION_CHECK_FAILED');}
    }
    if(operation==='publishMedia'){
      if(p.delivery?.mode==='live'){
        try{return await require('./live-schedule').scheduleLive(client,c,p,bounded,dependencies.now??Date.now());}
        catch(e){return {status:e.message==='NNA_LIVE_DELIVERY_UNCONFIRMED'?'uncertain':'rejected',mode:'live',requestKey:p.delivery.requestKey,error:/^NNA_LIVE_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_LIVE_CHECK_FAILED'};}
      }
      if(p.delivery?.mode==='poll'){
        try{return await require('./poll-publish').publishPoll(client,c,p,bounded,dependencies.now??Date.now());}
        catch(e){throw new GuardError(/^NNA_POLL_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_POLL_CHECK_FAILED');}
      }
      if(p.delivery?.mode==='bundle'){
        try{return await require('./bundle-publish').publishBundle(client,c,p,bounded,dependencies.now??Date.now());}
        catch(e){throw new GuardError(/^NNA_(BUNDLE|MEDIA)_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_BUNDLE_CHECK_FAILED');}
      }
      try{return await mediaPublish.publish(client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_MEDIA_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_MEDIA_CHECK_FAILED');}
    }
    if(operation==='sendMembershipDirectPart'){
      try{return await membershipDM.sendPart(client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_MEMBER_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_MEMBER_CHECK_FAILED');}
    }
    if(['inspectImageReactionScope','reactToScheduledImage'].includes(operation)){
      try{return await scheduledImageReaction(operation,client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_IMAGE_REACTION_CHECK_FAILED');}
    }
    if(operation==='sendDirectReaction'){
      try{return await sendDirectReaction(client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_REACTION_CHECK_FAILED');}
    }
    if(['inspectReactionCopy','copyUserReaction'].includes(operation)) {
      try{return await runReaction(operation,client,c,p,bounded);}
      catch(e){throw new GuardError(/^NNA_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_REACTION_CHECK_FAILED');}
    }
    if(operation==='sendDirectReply') {
      try {return await sendDirect(client,c,p,bounded,dependencies.now??Date.now());}
      catch(e){throw new GuardError(/^NNA_[A-Z0-9_]+$/.test(e.message)?e.message:'NNA_DIRECT_TARGET_CHECK_FAILED');}
    }
    const group = await bounded(client.getEntity(c.allowedGroupUsername));
    requireThat(group && group.className === 'Channel' && group.megagroup === true && group.forum === true && id(utils.getPeerId(group)) === c.allowedGroupId, 'NNA_WRONG_GROUP');
    const peer = await bounded(client.getInputEntity(group));
    if (operation === 'readTopicHistory') return await readHistory(client, peer, c, p, query, requireThat, bounded);
    const messages = await bounded(client.getMessages(peer, { ids: [Number(p.messageId)] }));
    requireThat(messages.length === 1, 'NNA_SOURCE_MISSING');
    validateSource(c, p, messages[0]);
    const randomId = deterministicRandomId(c, p.draftKey);
    const request = new Api.messages.SendMessage({ peer, message: approvedBody.text, entities: approvedBody.entities,
      replyTo: new Api.InputReplyToMessage({ replyToMsgId: Number(p.messageId), topMsgId: Number(p.topicId) }),
      sendAs: new Api.InputPeerSelf(), noWebpage: true, randomId,
    });
    sendStarted = true;
    const result = await bounded(client.invoke(request));
    const updates = result.updates || (result.update ? [result.update] : []);
    const mapping = updates.find(u => u.className === 'UpdateMessageID' && id(u.randomId) === id(randomId));
    const sentId = mapping?.id || (result.className === 'UpdateShortSentMessage' ? result.id : undefined);
    requireThat(integer(sentId), 'NNA_DELIVERY_UNCONFIRMED');
    let sent = updates.map(u => u.message).find(m => m?.className === 'Message' && m.id === sentId);
    if (!sent) sent = (await bounded(client.getMessages(peer, { ids: [sentId] })))[0];
    requireThat(sent && sent.id === sentId && sent.out === true && sent.message === approvedBody.text && id(sent.fromId?.userId) === id(c.expectedUserId) && id(utils.getPeerId(sent.peerId)) === c.allowedGroupId && topicOf(sent) === Number(p.topicId) && sent.replyTo?.replyToMsgId === Number(p.messageId), 'NNA_DELIVERY_UNCONFIRMED');
    return { status: 'sent', draftKey: p.draftKey, sentId: sent.id, senderId: id(me.id), target: c.allowedGroupId, topicId: Number(p.topicId), replyToMessageId: Number(p.messageId) };
  } catch (error) {
    // Never attach the underlying RPC error/request: it can include session or message data.
    if (sendStarted) throw new Error('NNA_DELIVERY_UNCONFIRMED: Do not retry automatically; reconcile this draft with Telegram.');
    throw new Error(error instanceof GuardError ? error.message : 'NNA_TELEGRAM_CHECK_FAILED: No send was attempted.');
  } finally {
    if (client) { try { await bounded(client.destroy(), 10000); } catch { /* Never expose cleanup internals. */ } }
  }
}
module.exports = { runOperation, validateCredentials, validateApproval, parseApprovedHTML, deterministicRandomId, validateSource, topicOf, createClient };
