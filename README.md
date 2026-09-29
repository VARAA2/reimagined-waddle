# NNA Telegram Personal Sender

## Media + Article albums (0.29.0)

*Publish Operator Album or Audio* also accepts a claimed `mode: 'bundle'` delivery with `items` (2–10 photos/videos): the article is posted first with a placeholder, the album follows with the article link filled into the approved caption slot on its first item, then the article is edited to link back to the album. Pair, timing, link-slot and uncertain-write rules match the single-media bundle; a started bundle is never retried. *Preview Operator Album or Audio* omits approval buttons for bundles because the article preview carries them.

## Operator albums and audio (0.28.0)

NNA Media Collection gains three operations for an existing operator bot draft flow. Single photo/video drafts are unchanged.

- **Collect Operator Album** passes non-album updates through. For a Telegram album, the first update waits until the album has been quiet for 4 seconds (at most 30 seconds), then returns every item in message order as `operatorAlbum.role: leader`; the other updates return `follower`/`duplicate`, and updates after closing return `late`. State is kept in the persistent media store, so parallel webhook executions cannot lose items.
- **Preview Operator Album or Audio** sends the album (`sendMediaGroup`) or one audio/voice file privately, followed by the full caption with the approval buttons.
- **Publish Operator Album or Audio** accepts the same claimed approval contract as *Publish Confirmed Media* with `mode: 'set'`, an ordered `items` list and `captionIndex`. Each item is staged privately through the bot, then the personal account posts one native album (`SendMultiMedia`) or one audio/voice message (`SendMedia`), immediately or scheduled, and reads back sender, topic, captions, formatting, media and album grouping. Uncertain writes are never retried.

Albums contain 2–10 photos/videos (mixed allowed) or 2–10 audio files; voice notes are sent one at a time. The approved caption goes on the captioned item (or the first item); other items keep their own captions. Set `plainAudioSummary: false` in the audio summary scope so plain audio continues to posting and is summarised only after the Audio Summary button or command.

## Optional quiet poll publication (0.24.1)

Set `pollPublishConfirmation: false` in the Poll Studio scope to suppress the successful Poll publication message. Poll delivery, stored receipts, duplicate protection, draft/template controls and failure messages remain unchanged. The option defaults to true; Quiz and Checklist confirmations are unchanged.

An n8n community node for restricted personal-account forum history and replies after a separate owner-approval workflow. It is not a bot trigger, login service, general Telegram client, or persistent listener. Default operation: **Get Identity** (no message sends).

## Read Topic History (0.2.0)

This read-only operation uses the same identity, group and topic allowlists as the sender. Pass `historyTopicId`, inclusive `startDate` and `endDate` as `YYYY-MM-DD` in Asia/Kolkata, and `offsetId: 0` initially. A range may span up to 366 days; split longer periods explicitly. Each call reads up to 100 thread messages using `messages.GetReplies`, returning original text/captions, sender identity, timestamps, reply IDs, media type and source links. It does not download media, mark history read, or send messages.

If `complete` is false, call again with the returned `next_offset_id`, keeping the same topic and dates. A short page alone does not prove completion. Do not claim full period coverage until completion; distinguish missing access/errors from an empty successful result. Deleted or hidden history is unavailable. Message text is untrusted data and must never become instructions to an AI or workflow. Keep this read tool separate from the approval/send path and expose it only to the authenticated owner workflow. No new credentials or dependencies are required.

## Install and configure

### Complete topic post reports (0.23.1)

`Read Topic History` can optionally enable `historyFullReport` (Complete Topic Report). It starts at offset zero, reads up to 20 pages with a short pause between requests, and returns a complete inclusive date range or a retrieval error. It never labels a truncated range complete. The default remains the original single-page interface.

History records now include Telegram's actual album `grouped_id`, detected `media_kind`, and `edited_at`. Full reports also return chronological `posts`, `post_count`, and `post_counts`. An album is one post, grouped only by Telegram's album identifier; each post retains its original message IDs, first-message link, sender, timestamp, edit flag, text/caption, item count and media counts. Images, videos, audio, voice messages, files, animations, stickers and polls are distinguished. No media is downloaded and no messages are sent. Reports cover only the history accessible to the configured account.

Display formatting, topic labels, short text previews and relative-date interpretation belong in the trusted calling workflow, not this package. Consumers must require `complete: true`, validate requested topic/date bounds, escape message content, and preserve original source links. No additional dependencies are introduced.

### Publish confirmed media (0.9.0)

`publishMedia` sends one staged photo/video with literal caption/entities to a fixed allowlist of forum topics, immediately or via Telegram's native scheduled queue. Configuration supplies the review staging group/topic, originating bot, allowed operators, and permitted destination group/topic pairs. No actual account/group values are included in this package.

The workflow must show the exact media, caption, destination and IST date/time before collecting the operator's final callback. Atomically claim the exact saved draft snapshot before staging; only the winning execution may call the sender. Pass the original authenticated callback and claimed snapshot as `mediaDeliveryJSON`, static scope as `mediaScopeJSON`, and the current sender execution ID as `mediaClaimExecutionId`. Disable node retries. The staged message must be from the configured bot, in the configured staging topic, with caption `NNA_MEDIA_STAGE:` plus the unique request key. Review temporary staging content and remove it after a confirmed result.

Scheduled delivery returns `scheduledMessageId`, not a published message link. Telegram manages the schedule without the workflow remaining running. Reject near/past times instead of silently publishing immediately. Unconfirmed writes remain closed for manual reconciliation, with no automatic retries.

Version 0.9.1 checks the sending account's current membership when a destination topic is closed. The group creator or an administrator with Manage Topics may post without reopening the topic. Other accounts are rejected before sending; Telegram still enforces its server permissions.

Version 0.9.2 supports captions up to 4,096 UTF-16 units. For captions above 1,024 units it verifies the sender's current Premium status and Telegram's live premium caption limit before writing. Bot API previews must show long captions as separate text, with final confirmation bound to the complete saved caption; the destination receives a single media message with that caption.

After this package has been reviewed and published, install `n8n-nodes-nna-telegram-sender` through n8n Settings → Community Nodes if your provider permits unverified npm packages. A successful local package build does not establish that a particular managed host allows installation or Telegram TCP traffic.

Create an **NNA Telegram Personal Sender** credential. Enter an existing `apiId`, secret `apiHash`, secret `sessionString`, fixed expected user ID, optional expected username, fixed allowed public supergroup username and numeric `-100…` ID, and comma-separated allowed topic IDs. No real credentials or account identifiers are bundled. A session string grants access to the account; keep it in n8n credentials only. This node has no phone-code, QR-login, 2FA, login, or logout operation.

Use **Get Identity** first. It connects, checks a non-bot account against the fixed credential identity, returns only verified ID/username, then destroys the client. This reads Telegram identity; it sends no chat messages.

## Required approval workflow

1. Store each draft revision as a new immutable row with the exact source text, topic, message ID and approved HTML. Send this same HTML to the owner as a preview using Bot API `parse_mode=HTML`.
2. Authenticate the private callback by numeric owner ID, private chat ID, originating bot and preview message ID. Never let an LLM authorize sending.
3. Atomically update the specific draft row `WHERE id = … AND status = 'pending'` to `status='claimed'`, `claim_token=$execution.id`, `approved_at=now`. On n8n non-PostgreSQL storage, returned rows alone are insufficient: verify the returned/read row token equals this execution token and its complete immutable snapshot still matches. Only the winning claim may reach this node.
4. Provide exactly one item to **Send Approved Reply**, with `draftKey`, timezone-qualified `approvedAt`, `ownerId`, `approvalClaimToken=$execution.id`, `approvalValidated=true`, `bodyHTML`, exact `sourceText`, `messageId` and `topicId`. Keep the sender in this same execution. The node checks the token matches n8n's current execution ID and refuses **Retry On Fail**.
5. On `status: sent`, record returned `sentId`. On any ambiguous failure, leave the claim closed and reconcile in Telegram. Never automatically reset it to pending or execute the sender again.

The approval fields attest to the upstream workflow's decision; they are not an independent approval service or signature. A trusted workflow editor must configure the preceding checks correctly. This package cannot query an arbitrary n8n Data Table or protect against a malicious workflow editor.

## Send checks and formatting

Before sending: validate approval age (24 hours maximum, 30-second clock tolerance), numeric owner, fixed topic allowlist, non-bot account identity, resolved group's numeric ID and forum status, and the source message's exact topic/text. Deleted messages, text changes, and edits newer than approval stop the send. Telegram offers no transaction that locks another person's source message between this check and delivery.

HTML supports balanced, attribute-free `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>` and `<blockquote>`. Raw `<`/`>` in prose must be escaped. Unsupported tags, attributes and HTTP/TG links are rejected. The rendered text must start `Dear {name} Soul🤍`, followed by a blank line, and end with a blank line plus `#BotAns`. Visible content is limited to 3500 UTF-16 code units. This node does not rewrite, shorten, or append to an approved body. Emoji relevance and quotation accuracy remain draft/review responsibilities.

The request uses `InputReplyToMessage(replyToMsgId, topMsgId)`, explicit `InputPeerSelf` for `sendAs`, and a deterministic signed 64-bit `randomId` derived from expected account, group and immutable draft key. Successful output is confirmed against Telegram's random-ID mapping and returned/read message sender, group, topic, original reply ID and text. Output contains only status and IDs, never the source/body/session/API secrets.

## Failure and dependency boundaries

There is **no persistent delivery ledger in this node**. Telegram random-ID deduplication plus the upstream atomic claim reduces duplicates; it is not an unlimited exactly-once guarantee. Network timeouts after sending are ambiguous, even if Telegram delivered the reply. Errors are sanitized, automatic application retries are disabled, and every client is destroyed in `finally`. Individual remote calls have a 20-second bound; cleanup has 10 seconds.

Pinned runtime: `teleproto@1.229.0`, with a published `npm-shrinkwrap.json` freezing the runtime dependency graph. Explicit `securityChecks:true`, one request attempt, one connection attempt, no reconnect, no flood-wait auto-sleep, and a silent logger are configured. That Teleproto version does **not** implement `receiveUpdates:false`; it briefly runs its internal update loop while connected. This node registers no update handlers and closes the client after every operation. It does not run a second receiver or alter a Bot API webhook.

Telethon IPv4 StringSession compatibility is verified with a synthetic session only. This does not test authorization validity, the user's actual session, managed-host connectivity, or live Telegram delivery. There are no real-account tests or credentials in this package.

## Development

Node.js 20 or newer is required by this package. Run `npm ci --ignore-scripts`, `npm test`, then `npm pack`. There is no build step: reviewed CommonJS runtime files are already under `dist`. Tests use fake clients and synthetic keys only. No install lifecycle hooks are included; `prepack` runs the offline suite locally.

Primary references: [Teleproto package](https://www.npmjs.com/package/teleproto), [String sessions](https://ref.teleproto.dev/classes/sessions.StringSession.html), [Telegram sendMessage](https://core.telegram.org/method/messages.sendMessage), [Telegram reply target](https://core.telegram.org/constructor/inputReplyToMessage).
# 0.4.0: Operator-written direct replies

Adds `sendDirectReply` for explicit text authored by configured, numerically verified Telegram operators. It accepts a Telegram group message URL on the first or last line and preserves the remaining plain text. It does not call an LLM, add a greeting, or request button approval. Only authenticated incoming `message` events in an operator's private chat or configured review topics are eligible; forwarded, edited, stale, bot and anonymous requests fail closed.

An upstream durable delivery claim must bind the exact request key, operator, URL and text to the current execution. Use a pre-seeded per-operator database lock before deduplication and insert, keep a permanent request ledger, and leave uncertain requests closed. The node rejects automatic retries, verifies the fixed personal account, resolves existing group access without joining, validates the original message/topic, and uses a stable MTProto random ID. Public and private supergroup message links are supported. Private user links, invite links, topic-only links, and broadcast channels are not direct reply targets. Private peer resolution can search up to 500 existing dialogs.

The monitor now accepts a static comma-separated `additionalOwnerIds` allowlist for private incoming events. Existing approved-reply and read-history operations retain their original restrictions.

## 0.5.0: Explicit reaction copy trial

`inspectReactionCopy` reads one source message and one target message in a statically configured private supergroup. `copyUserReaction` copies the single distinct emoji/custom emoji selected by the configured numeric operators, using the credential's fixed personal account. Source URL, target URL, group ID and operator IDs are static workflow parameters. No automatic reaction monitoring is added.

Both messages, operator reactions, existing membership, personal identity and default reaction sender are checked before mutation. Ambiguous source selections fail closed. Existing target reactions from the personal account are preserved; an already-present reaction is a no-op. Telegram group restrictions and custom emoji eligibility still apply. The final reaction is read back and attributed to the expected personal user ID. An uncertain result must be inspected before any further attempt. Automatic node retries are refused. Keep the write operation in a trusted workflow for an explicitly authorized source/target pair, never as an unrestricted AI tool.

### 0.5.1 empty-target reaction fix

A valid target message with no reactions can cause Telegram's reaction-list method to return MSG_ID_INVALID. Read the freshly fetched message reaction summary first and skip only the known empty target listing. Nonempty listing errors still block sending, and post-send identity/reaction verification remains mandatory. Covered by empty-target and nonempty-error regression tests.

## 0.6.0: Operator-selected direct reactions

A single emoji and a standalone target message URL on the first or last line are classified as a reaction request. Longer prose stays a literal reply. Multiple emoji-only selections are rejected instead of sending an accidental text reply. Custom emoji IDs are taken only from the exact authenticated Telegram message entity covering the emoji.

`sendDirectReaction` uses the same operator authentication, immutable upstream delivery claim and fixed personal identity as `sendDirectReply`, and rejects retry-on-fail. It resolves existing accessible supergroups, verifies the target message/topic and personal defaultSendAs, preserves current personal reactions, skips an already-present selection, and confirms the actual personal reactor after sending. Unsupported reactions or premium/group limits are surfaced; uncertain writes are never retried automatically. Includes the empty-target fix described above. No reaction is generated or chosen by an LLM.

## Scheduled image reactions (0.7)
Adds a read-only scope check and a claimed new-image reaction operation. Configure group, topic, three custom emoji IDs, activation time and an India-time hour window. Supports photos and image documents, verifies actual source media and the connected personal sender, preserves existing selections, and verifies all three reactions after one write. Edited events, stale events, other topics and other media are excluded. Store claims and outcomes durably upstream; disable automatic write retries. No image bytes are downloaded.

## Membership direct messages (0.8)

Adds a single-part sender for fresh, verified membership events in a statically configured supergroup. Store exact text/entity templates and activation time privately in workflow configuration. Welcome applies to joins; departure applies only to voluntary exits. Removed users, bots, stale events and events before activation are excluded. The fixed personal account must be an administrator; the sender corroborates the event and recipient against Telegram admin logs and current membership before sending. Telegram privacy, flood and paid-message restrictions are not bypassed.

A trusted workflow must keep durable event/part claims, bind the recipient and execution, and send the custom emoji only after text delivery is confirmed. Automatic retries are refused. Deterministic per-event/per-part random IDs and post-send readback reduce duplicate/uncertain delivery risk; ambiguous failures must remain closed for manual reconciliation. Actual group identifiers, templates and credentials must never be bundled in this package.


## Random topic reactions

The optional `inspectTopicReactionScope` and `reactToTopicPost` operations support a configured forum topic and a pool of 3–50 custom emoji document IDs. Choose three distinct IDs upstream, persist that selection with a durable first-writer claim, and bind the claim to the current execution. The action validates the original new message, allowed group/topic, activation time, 30-minute freshness, Premium personal-account identity, and selected IDs. Text and media posts are supported at all hours. Edited and service updates are excluded. Existing unrelated personal reactions are preserved; ambiguous delivery must be reconciled without automatic retries. No group, account, emoji pool or credentials are bundled in this package. The existing image-window operation is unchanged.

The optional `inspectTopicState` and `setTopicState` operations read or change the open/closed state of one configured forum topic in the credential's allowed group, as the personal account. `setTopicState` takes `open` or `close`; if the topic already matches it returns `already_open`/`already_closed` without writing. Otherwise it requires creator or Manage Topics admin rights, edits only the closed flag and reads the topic back before returning `opened`/`closed`. Ambiguous results fail as `NNA_TOPIC_STATE_UNCONFIRMED`. The General topic is not supported. Scheduling (for example a daily open and close) belongs in the calling workflow; no group or topic is bundled in this package.

## Membership topic records (0.14)

`inspectMembershipRecordScope` verifies two statically configured destination forum topics without posting. `sendMembershipRecord` posts a six-field membership record through the fixed personal account. A trusted upstream workflow must authenticate the original membership update, classify the transition, format the record, persist a durable first-writer delivery claim and bind it to the current execution. The destination, joined/left topic IDs and activation time are static private configuration. This operation is not an unrestricted text-publishing or AI tool.

The sender validates the source scope, event key, person, action, topic, format, body and delivery claim. It uses deterministic per-event random IDs, explicitly sends as the personal account and reads back the posted sender, topic, complete text and formatting. Name mentions use available user references; unavailable references leave readable names and IDs intact. Labelled format trials require an explicit static trial setting, a separate key namespace and a visible test marker. Automatic node retries are rejected; ambiguous delivery must be reconciled before another attempt. No real group identifiers or account credentials are included in the package.
# User history export

`exportUserHistory` is read-only. A static scope defines the permitted group, topic IDs, bot username and private operator IDs. The original authenticated private update supplies a numeric user ID or username. Numeric IDs are matched directly against message senders, including former members; usernames are first resolved to an immutable user ID.

The operation traverses results in each configured topic until an empty page, retaining only that user's messages through a fixed message-ID snapshot. It uses sender search when an authenticated user reference is available, otherwise scans the topics and matches sender IDs directly. Every returned sender is checked when sender search is used. Legacy posts whose topic header is omitted retain the server-scoped topic; explicit conflicting topic metadata is rejected. It creates a UTF-8 text document with chronological messages, topic counts, India timestamps, original message links, captions, embedded links and attachment types. Photos, videos, audio, voice messages and PDFs are links only; no attachments are downloaded. Service events such as pins are excluded from the chat message count. Deleted/hidden history, older edits and unattributable anonymous/channel posts are unavailable.

The n8n output contains metadata and a `data` binary property suitable for a separate Telegram Send Document node. It never sends a message itself. Use a durable upstream event claim and verify the downstream bot document receipt. Do not mark a read error or stalled cursor complete. A bounded flood wait is retried on the same read cursor; a time limit or document approaching 45 MB fails explicitly without sending a partial file.

## Media collection bot (0.16)

The separate NNA Media Collection node uses a dedicated receiving bot and a fixed personal sender. Static private workflow scope supplies the destination forums, bot username, operator IDs and topic emoji maps. Every upload displays live topic names. A selected open topic immediately posts the original image/video and caption as the personal account; a receipt link includes a caption-edit control. Closed or hidden topics are labelled and unavailable for posting. Optional album and keyboard features are described below.

AI is off by default. `/analyze` arms only the next media within 15 minutes, or can reply to the user's previously uploaded image/video. Pending uploads retain their topic picker; previously posted or older media return a standalone private analysis without reposting or modifying the group message. Only explicit analysis downloads media and returns binary data for a downstream classifier. Native analysis nodes must route errors back to Finish Requested Analysis. Normal uploads and topic selections never authorize analysis. Configurable bounds default to 50 MiB and five minutes, with at most two concurrent analysis jobs. Video documents without a verified duration cannot be analyzed.

Every successful analysis combines 3–4 short English summary lines and hashtags in one private reply. The prompt uses broad reusable categories; the policy normalizes canonical aliases, remembers validated returned spellings for later reuse, keeps at least 80% known/reused tags, and permits at most three novel tags only when needed. Fewer relevant tags are allowed without filler. A missing, invalid or ungrounded summary cannot produce a hashtags-only success. Recognized deity subjects share Gods and Deities without merging specific names. Summary and tags stay private by default; group delivery preserves the original caption. A static `includeAnalysisInCaption: true` can opt into combined caption composition, but defaults to false and is not controlled by untrusted updates. Classification remains probabilistic.

The sender account must first Start the receiving bot. A short-lived private cached-media copy bridges Bot API and MTProto file references. It is removed after confirmed delivery or analysis download. The selected group post has no forwarded header. A bounded, persistent filesystem ledger under the n8n user directory enforces draft ownership/revision, consent, single delivery claims and uncertain-result handling. This release requires one regular-mode n8n instance with a persistent volume; queue mode is rejected. Do not distribute across workers with separate disks. Disable Retry On Fail. After a process crash or an uncertain Telegram write, inspect the stored claim and Telegram before recovery; do not blindly delete locks or resend.

Use an authenticated Telegram webhook. The included NNA Telegram Group Monitor verifies a credential-bound secret header; configure it exclusively for this dedicated bot. Handle Private Update additionally rejects other operators, nonprivate inputs and callbacks from another bot. Do not expose this sender as an unrestricted AI tool. Inspect Scope is read-only. Configure Private Commands registers the dedicated bot's private command menu. Actual group IDs, bot tokens, personal sessions, private captions and topic configuration must remain outside the npm package.

### 0.16.1 private staging fix
Telegram can omit fromId on incoming private messages. Staging now verifies the resolved sender ID, exact bot peer and incoming direction, preserving strict identity checks without rejecting legitimate private media. Topic choices now use four buttons per row. The administrative Refresh Pending Topic Buttons operation updates one existing pending draft without posting.


### 0.16.2 delivery receipts
After independent delivery verification, reply to the original uploaded media with a separate receipt: destination URL first, then the success confirmation below. Disable link previews and retain the caption-edit control. Caption-edit confirmations follow the same URL-first layout.

### 0.17.0 paired private summary and hashtags
Reply `/analyze` (or `/analysis`) selects that exact prior upload, including an already posted image/video. Summary and tags are validated and displayed together, with no automatic repost. Previously returned tags are retained in a bounded per-bot vocabulary for consistent reuse. Duplicate analysis commands and cancelled late results are ignored. Original captions and existing delivery receipts remain intact.


### 0.17.1 English analysis summaries

Image and video summaries use 3–4 short English lines for easier searching, even when the source content is in another language. The prompt requests English spellings for names and the validator rejects non-Latin-script summaries. Hashtag reuse, paired private replies, opt-in analysis and original group captions are unchanged. The script check is a format guard, not a semantic language detector.

### 0.18.0 Poll, Quiz, Checklist and persistent keyboard

Adds the NNA Poll Studio node: operator-only private preparation, settings, native quizzes with verified correct answers, native checklists, code-word templates and a configurable topic picker. Main menu and wizard buttons appear as Telegram reply keyboards below the composer. Configured group keywords publish fresh items through the fixed personal sender. Polls default to single answer with revoting disabled; the legacy poll publisher also disables revoting. Checklists expose add-item and complete/undo permissions and require Premium on the sender. New topics can be enabled without a package update. Poll media attachments are not included.

Use one n8n instance with a persistent user volume. Templates and delivery claims are atomically stored under `.n8n/nna-poll-studio`; disable execution retries. Duplicate updates and uncertain writes never automatically repost. Commands: `/menu`, `/poll`, `/quiz`, `/checklist`, `/polltemplates`, `/pollsave code`, `/polluse code`, `/polltopics`. Existing private commands are preserved when registering these commands.

Group slash commands are registered using `chat_administrators` scope. Authorized operators must still be current administrators/creators before group commands provide the corresponding private bot deep link. The app controls the slash icon appearance; typing `/` opens command suggestions. Private reply keyboards remain separate.

Media collection 0.19.0: optional native photo/video albums (2-10 items), persistent private topic keyboard with original forum custom icons, one topic per row, pagination, per-operator topic order editing and pending draft selection. Enable scope flags albums, replyKeyboard and buttonCustomEmoji. Existing captions, sender checks, per-media analysis consent and uncertain-delivery guards remain in place.

# Nested private navigation

Media Collection scope option `fullTopicKeyboard: true` shows all available topics in one collapsible keyboard, without previous/next page actions. Short labels use up to three buttons per row, medium labels up to two, and long labels a full row. Topic order and native custom emoji IDs are preserved. Telegram controls the physical keyboard viewport, so scrolling may still be needed on small screens.

The Poll Studio `Render Nested Menu` and `Render Preview Controls` operations convert prepared legacy dispatcher controls into persistent private reply keyboards. Authorized text selections retain the original owner, action and revision, and reuse the existing dispatcher validation and publish claims. Main Menu and Poll Studio screens clear old keyboard mappings. Groups, history ForceReply prompts, and controls with ambiguous labels retain their existing chat UI. Media and article previews remain in chat.

### 0.20.0 multiple media destinations and configurable layout

Keep the primary `groupId`, `topicIds` and `allTopics` settings. Add up to ten `additionalGroups` entries, each with a `groupId`, optional `label`, and an explicit `topicIds` array. An entry may instead enable `allTopics: true` with an empty `topicIds` array. The combined keyboard supports at most 90 topics. Only configured groups and topics can receive media; the personal sender must already have access. No group is automatically joined and no permissions are changed.

The primary group's topic keys remain numeric for compatibility. Other groups use `g<channelId>_<topicId>` keys, so equal topic IDs in different groups remain independent. Topic discovery reads actual names and custom emoji; duplicate names include group and topic identifiers. Single media, native albums, independent delivery checks, receipt links and caption edits all retain the selected group. Adding a configured destination does not require another package update.

`defaultTopicOrder` is an array of these keys. `topicOrderRevision` applies a new default ordering once per operator; later `/topicorder` choices persist for that revision. Existing saved orders are retained when no new revision is configured. Unlisted/new topics follow the ordered keys. `fullWidthTopicKeys` forces selected topics onto individual full-width keyboard rows. Other buttons retain the compact layout. Keep actual group IDs, private scope and operator identities outside the published package.

## Private analysis copy format

Image and video analysis replies use two native Telegram inline monospace entities: the entire English summary is one copy target, and the complete hashtag batch is another. Text is never shortened or split into individual hashtag targets. Native client gestures control copying. Original group captions and topic keyboards are preserved.

## Group admin command launchers

Set `adminCommandGroupIds` in the Media Collection scope to an explicit array of allowed supergroup ID strings. Add these groups to the monitor main/review/additionalGroupIds allowlist and route their message updates into Handle Media Update. Run Configure Private and Admin Commands after changing the list. Only existing operators who are current group administrators can launch private media tools; ordinary group messages/media never enter the private composer. Commands preserve forum topics, exact bot mentions and replay guards. The private deep link opens menu, topicorder, analyze, cancel or help. Removing a configured group and rerunning command setup removes its managed menu commands. No package release is needed to change configured groups.

## Optional analysis for an existing reply bot

Handle Reply Bot Analysis intercepts only mediareport, cancelmedia, the Image / Video Report button, owned analysis callbacks, and one explicitly armed upload. Other events return analysisHandled=false with the original event. Use separate image/video AI branches and Finish Requested Analysis under that bot's own credentials and scope. Set analysisCommand to mediareport for distinct help text. Configure Reply Analysis Commands merges these commands into the existing private/admin menus. Results use independent monospace summary/hashtag spans. Without groupReplies, group commands retain the private launcher behavior.


## 0.22.0 optional replies within group topics

Set `groupReplies: true` on the Media handle/analysis/finish scopes and Poll Studio handle scope to enable explicit group conversations. Group analysis requires an existing allowed operator who is a current administrator. Media uses `/analyze`; the reply bot uses `/mediareport`. Reply to an image/video (including a selected album item) to analyze it. Results and errors remain in the same forum topic, replying to the source media. No media is republished. The private analysis and upload flows continue independently.

An armed group upload must reply to the bot prompt. Group/topic/operator state is isolated; completed analysis restores its persisted origin after process restart and rechecks admin permission. Source media is read directly from the configured group through the existing sender session, with a topic check and existing size/duration limits. Callback actions bind the actor, chat, topic, control message and draft revision; another admin cannot operate the initiating admin's buttons.

Poll Studio group conversations offer Poll, Quiz, Checklist and poll templates with inline controls. Text answers must reply to the bot prompt. Group publishing is limited to the current enabled topic and retains the configured personal sender. Topic management, history export, generic templates, media publishing and scheduling continue through private deep links. Configure group allowlists and monitor routing separately; this setting never joins groups or grants privileges. Disable automatic workflow retries and retain a persistent, single-instance state volume.

## 0.23.0 optional analysis progress feedback

`processingFeedback` enables a delayed, separate animated custom-emoji message for requested image/video analysis, plus one persistent bot reaction on the initiating command. Configure the same object on the corresponding handle and finish nodes. Give each bot its own `indicator` and share its `reaction` definition. Each emoji definition has a decimal-string `customEmojiId` and its Unicode `emoji` alternative. Keep deployment-specific identifiers outside this public package.

An optional `indicatorFallback` chooses a second custom emoji if Telegram explicitly rejects the primary emoji or strips its custom entity. A stripped entity is replaced by editing the existing indicator message. Ambiguous network errors do not trigger a duplicate message. Optional `fallbackEmoji: "👀"` on `reaction` allows ordinary eyes after an explicit custom-reaction rejection.

`delayMs` (1000–10000) avoids animations and reactions for quick work; `timeoutMs` bounds stale feedback (60000–900000). Completion, errors and cancellation remove only the separate indicator message. The single eyes reaction remains unchanged: there are no success, failure or cancellation reactions. Ordinary menu/button actions do not create progress messages.

The indicator and reply stay in the originating private chat or group topic. Feedback uses the bot identity; no personal account is used. Unsupported emoji, permission and network errors do not suppress the analysis report. Telegram custom emoji message rendering and reactions have separate eligibility rules.

Pending cleanup stores only message identifiers and feedback settings on the existing persistent volume. A single-process timer handles delayed feedback, stale-work cleanup and transient deletion retries. After a restart, pending jobs resume when the bot's Media Collection node next initializes; idle servers cannot guarantee immediate cleanup. Preserve the existing single-instance deployment constraint.

## 0.24.0 optional ChatGPT Poll, Quiz and Checklist bridge

The `chatgptBridge` operation supports four actions: `list`, `prepare`, `get` and `publish`. Enable it explicitly with `chatgptEnabled` and a `chatgptOwnerId` matching the sender credential owner and an allowed operator. Keep the bridge behind an authenticated, owner-restricted workflow; never expose it as a public webhook or accept a caller-supplied owner identity.

The connector first lists enabled destinations and defaults, collects the content and relevant settings, and prepares a saved draft. Show the complete preview, including destination, sender and settings, and obtain explicit approval before publishing that exact draft. Quiz drafts require correct answers; checklist drafts include whether others may add or complete tasks. Drafts expire after 24 hours. Publishing requires its exact draft ID and confirmation hash.

Publishing uses the existing configured sender, enabled-topic list and native Poll Studio validation. Durable send claims prevent duplicate posts; ambiguous delivery requires checking the existing draft, never blindly creating or sending another. Bridge drafts are separate from Telegram wizard drafts. Retain the existing persistent, single-instance state volume. All deployment identities and credentials belong in the workflow configuration, outside this package.
# Audio summaries (0.26.0)

Tamil is the primary expected audio and summary language. Recognition guidance covers colloquial Tamil, regional accents and Tamil-English code-switching; transcripts preserve the spoken language and Tamil script. English, Hindi and other input languages remain supported. Optional spiritual-term spelling hints apply only when supported by the recording. Unclear names/words must be marked rather than guessed. This is prompt guidance for the existing Gemini audio model, not an installed language pack or a Tamil accuracy guarantee.

Reply bot operators can use **🎙️ Audio Summary**, `/audiosummary`, or send a Telegram voice/audio message in private. Replying to audio with `/audiosummary` also works for authorized group administrators, in the same topic. `/cancelaudio` cancels a pending result. One recording is limited to 20 MB and 20 minutes; files are never silently truncated. Existing processing feedback remains unchanged.

The NNA group reader accepts `action: "audio"` with an exact Telegram message URL for the two configured NNA groups. It validates the group, actual topic, sender metadata, audio attributes, byte format and limits before returning temporary binary data to Gemini. The ChatGPT adapter returns a complete timestamped transcript and summary for detailed explanation, not an audio player. Video is excluded. Sender metadata identifies the Telegram poster, not the speaker's voice. Gemini output must be complete and structurally valid; failures are not presented as empty or successful summaries.
