'use strict';
class NnaTelegramSender {
  constructor() {
    this.name = 'nnaTelegramSender';
    this.displayName = 'NNA Telegram Personal Sender';
    this.documentationUrl = 'https://core.telegram.org/api/obtaining_api_id';
    this.properties = [
      { displayName: 'API ID', name: 'apiId', type: 'number', default: 0, required: true },
      { displayName: 'API Hash', name: 'apiHash', type: 'string', typeOptions: { password: true }, default: '', required: true },
      { displayName: 'Session String', name: 'sessionString', type: 'string', typeOptions: { password: true }, default: '', required: true, description: 'Existing Telethon IPv4 or Teleproto StringSession; this node never performs login' },
      { displayName: 'Expected User ID', name: 'expectedUserId', type: 'string', default: '', required: true },
      { displayName: 'Expected Username', name: 'expectedUsername', type: 'string', default: '', description: 'Optional additional identity check, without @' },
      { displayName: 'Allowed Group ID', name: 'allowedGroupId', type: 'string', default: '', required: true, description: 'Full -100… supergroup ID' },
      { displayName: 'Allowed Group Username', name: 'allowedGroupUsername', type: 'string', default: '', required: true, description: 'Resolve this public group, then verify its numeric ID' },
      { displayName: 'Allowed Topic IDs', name: 'allowedTopicIds', type: 'string', default: '', required: true, description: 'Comma-separated numeric topic IDs' },
    ];
  }
}
module.exports = { NnaTelegramSender };
