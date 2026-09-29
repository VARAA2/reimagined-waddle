'use strict';
const { runOperation } = require('./sender');
const sendOnly = { operation: ['sendApprovedReply'] };
const parameter = (displayName, name, type = 'string', defaultValue = '') => ({ displayName, name, type, default: defaultValue, required: true, displayOptions: { show: sendOnly } });
class NnaTelegramSender {
  constructor() {
    this.description = {
      displayName: 'NNA Telegram Personal Sender', name: 'nnaTelegramSender', group: ['output'], version: 1,
      description: 'Read allowed topic history, verify identity, or send an explicitly approved reply',
      defaults: { name: 'NNA Telegram Personal Sender' }, inputs: ['main'], outputs: ['main'],
      credentials: [{ name: 'nnaTelegramSender', required: true }],
      properties: [
        { displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true, default: 'getIdentity', options: [
          { name: 'Get Identity', value: 'getIdentity', action: 'Verify the connected account without sending' },
          { name: 'Export User History', value: 'exportUserHistory', action: 'Read all accessible posts by one user in configured topics into a text file' },
          { name: 'Inspect Membership Record Scope', value: 'inspectMembershipRecordScope', action: 'Verify membership record destination topics without posting' },
          { name: 'Send Membership Record', value: 'sendMembershipRecord', action: 'Post one claimed membership record as the personal account' },
          { name: 'Inspect Topic Reaction Scope', value: 'inspectTopicReactionScope', action: 'Verify the topic and custom emoji pool without reacting' },
          { name: 'React to Topic Post', value: 'reactToTopicPost', action: 'Apply three persisted random custom reactions to a claimed new topic post' },
          { name: 'Inspect Topic State', value: 'inspectTopicState', action: 'Read whether the configured forum topic is open or closed without changing it' },
          { name: 'Set Topic State', value: 'setTopicState', action: 'Open or close the configured forum topic, skipping when it already matches' },
          { name: 'Poll Live Attendance', value: 'pollLiveAttendance', action: 'Read who is currently inside the group Live without joining or posting anything' },
          { name: 'Read Message Template', value: 'readMessageTemplate', action: 'Read the text and formatting of specific messages (including custom emoji ids) as a welcome or departure template' },
          { name: 'Send Channel Member Direct Message', value: 'sendChannelMemberDirect', action: 'Send one claimed welcome or departure message to a person who just joined or left a channel' },
          { name: 'Send Topic Image Forward', value: 'sendTopicImageForward', action: 'Send one claimed new topic photo with sender and post links to one configured person' },
          { name: 'Read Channel Membership', value: 'readChannelMembership', action: 'Read who joined or left a channel or group from the admin log without changing anything' },
          { name: 'Send Attendance Report', value: 'sendAttendanceReport', action: 'Send the weekly Live attendance report as the personal account with clickable name mentions' },
          { name: 'Publish Confirmed Media', value: 'publishMedia', action: 'Post or schedule a claimed image or video to configured forum topics' },
          { name: 'Send Membership Direct Part', value: 'sendMembershipDirectPart', action: 'Send one configured text or custom emoji for a verified claimed membership event' },
          { name: 'Inspect Image Reaction Scope', value: 'inspectImageReactionScope', action: 'Verify configured group topic and custom emojis without reacting' },
          { name: 'React to Scheduled Image', value: 'reactToScheduledImage', action: 'Add three configured reactions to a claimed new image inside the India time window' },
          { name: 'Read Topic History', value: 'readTopicHistory', action: 'Read a page of allowed topic history within inclusive India dates' },
          { name: 'Send Approved Reply', value: 'sendApprovedReply', action: 'Send one reply after an upstream owner approval claim' },
          { name: 'Send User Written Reply', value: 'sendDirectReply', action: 'Send literal operator text after an upstream delivery claim' },
          { name: 'Send User Selected Reaction', value: 'sendDirectReaction', action: 'Apply the exact emoji supplied with a message URL by an authorized operator' },
          { name: 'Inspect Reaction Copy', value: 'inspectReactionCopy', action: 'Read and verify an operator reaction and its destination without changing anything' },
          { name: 'Copy User Reaction', value: 'copyUserReaction', action: 'Copy the verified operator reaction to the explicitly selected review message' },
        ] },
        { displayName: 'Only connect after the owner approval claim succeeds. Disable Retry On Fail. Keep failed claims closed for manual reconciliation.', name: 'approvalNotice', type: 'notice', default: '', displayOptions: { show: sendOnly } },
        parameter('Draft Key', 'draftKey'), parameter('Approved At', 'approvedAt'),
        parameter('Approval Owner ID', 'ownerId'), parameter('Approval Claim Token', 'approvalClaimToken'),
        parameter('Approval Validated Upstream', 'approvalValidated', 'boolean', false),
        parameter('Approved HTML Body', 'bodyHTML'), parameter('Source Text Snapshot', 'sourceText'),
        parameter('Source Message ID', 'messageId', 'number', 0), parameter('Topic ID', 'topicId', 'number', 0),
        ...[
          ['History Topic ID', 'historyTopicId', 'number', 0],
          ['Start Date (YYYY-MM-DD, India)', 'startDate', 'string', ''],
          ['End Date Inclusive (YYYY-MM-DD, India)', 'endDate', 'string', ''],
          ['Offset ID (0 for first page)', 'offsetId', 'number', 0],
        ].map(([displayName, name, type, defaultValue]) => ({ displayName, name, type, default: defaultValue,
          required: true, displayOptions: { show: { operation: ['readTopicHistory'] } } })),
        {displayName:'Complete Topic Report',name:'historyFullReport',type:'boolean',default:false,displayOptions:{show:{operation:['readTopicHistory']}},description:'Read the full date range (up to 20 pages) and count Telegram albums as one post. Requires offset 0. Does not send messages.'},
      ],
    };
    this.description.properties.push(
      {displayName:'User Export Scope JSON',name:'userExportScopeJSON',type:'string',default:'',required:true,noDataExpression:true,displayOptions:{show:{operation:['exportUserHistory']}}},
      {displayName:'Original Private Operator Update JSON',name:'userExportUpdateJSON',type:'string',default:'',required:true,displayOptions:{show:{operation:['exportUserHistory']}}},
      {displayName:'Membership Record Scope JSON',name:'membershipRecordScopeJSON',type:'string',default:'',required:true,noDataExpression:true,displayOptions:{show:{operation:['inspectMembershipRecordScope','sendMembershipRecord']}}},
      ...[['Claimed Membership Record JSON','membershipRecordJSON'],['Membership Record Claim JSON','membershipRecordClaimJSON'],['Membership Record Execution ID','membershipRecordExecutionId']].map(([displayName,name])=>({displayName,name,type:'string',default:'',required:true,displayOptions:{show:{operation:['sendMembershipRecord']}}}))
    );
    this.description.properties.push(...[
      {displayName:'Media Scope JSON',name:'mediaScopeJSON',type:'string',default:'',required:true,noDataExpression:true,displayOptions:{show:{operation:['publishMedia']}}},
      {displayName:'Claimed Media Delivery JSON',name:'mediaDeliveryJSON',type:'string',default:'',required:true,displayOptions:{show:{operation:['publishMedia']}}},
      {displayName:'Media Claim Execution ID',name:'mediaClaimExecutionId',type:'string',default:'',required:true,displayOptions:{show:{operation:['publishMedia']}}}
    ]);
    this.description.properties.push(...[
      ['Reaction Group ID','topicReactionGroupId','string',''],['Reaction Topic ID','topicReactionTopicId','number',0],
      ['Custom Emoji Pool IDs','topicReactionEmojiPool','string',''],['Reaction Activation ISO','topicReactionActivatedAt','string','']
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,noDataExpression:true,displayOptions:{show:{operation:['inspectTopicReactionScope','reactToTopicPost']}}})));
    this.description.properties.push(...[
      ['Original Topic Update JSON','topicReactionUpdateJSON','string',''],['Selected Three Emoji IDs JSON','topicReactionSelectedJSON','string',''],
      ['Topic Claim Validated','topicReactionClaimValidated','boolean',false],['Topic Claim Execution ID','topicReactionClaimExecutionId','string',''],
      ['Topic Claim Request Key','topicReactionClaimRequestKey','string',''],['Persisted Selected Emoji IDs','topicReactionClaimEmojiIds','string','']
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,displayOptions:{show:{operation:['reactToTopicPost']}}})));
    this.description.properties.push(...[
      ['Topic State Group ID','topicStateGroupId','string',''],['Topic State Topic ID','topicStateTopicId','number',0]
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,noDataExpression:true,displayOptions:{show:{operation:['inspectTopicState','setTopicState']}}})));
    this.description.properties.push({displayName:'Topic Action',name:'topicStateAction',type:'options',options:[{name:'Open',value:'open'},{name:'Close',value:'close'}],default:'open',required:true,noDataExpression:true,displayOptions:{show:{operation:['setTopicState']}}});
    this.description.properties.push(...[
      ['Membership Channel ID','membershipChannelId',true],['Membership Extra Allowed Channel ID (optional)','membershipExtraChannelId',false],
      ['Since Event ID (0 = all logged, -1 = initialise cursor)','membershipSinceEventId',true],['Ignore Events Before (ISO, optional)','membershipActivatedAt',false]
    ].map(([displayName,name,required])=>({displayName,name,type:'string',default:name==='membershipSinceEventId'?'0':'',required,noDataExpression:name==='membershipChannelId'||name==='membershipExtraChannelId',displayOptions:{show:{operation:name==='membershipExtraChannelId'?['readChannelMembership','readMessageTemplate','sendChannelMemberDirect']:['readChannelMembership']}}})));
    this.description.properties.push(
      {displayName:'Template Group ID',name:'templateGroupId',type:'string',default:'',required:true,noDataExpression:true,displayOptions:{show:{operation:['readMessageTemplate']}}},
      {displayName:'Template Message IDs JSON',name:'templateMessageIds',type:'string',default:'[]',required:true,displayOptions:{show:{operation:['readMessageTemplate']}}},
      {displayName:'Channel DM Scope JSON',name:'channelDmScopeJSON',type:'string',default:'',required:true,noDataExpression:true,displayOptions:{show:{operation:['sendChannelMemberDirect']}}},
      {displayName:'Membership Event JSON',name:'channelDmEventJSON',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendChannelMemberDirect']}}},
      {displayName:'Message Part',name:'channelDmPart',type:'options',options:[{name:'Text',value:'text'},{name:'Custom Emoji',value:'emoji'}],default:'text',required:true,noDataExpression:true,displayOptions:{show:{operation:['sendChannelMemberDirect']}}},
      {displayName:'Claim Validated',name:'channelDmClaimValidated',type:'boolean',default:false,required:true,displayOptions:{show:{operation:['sendChannelMemberDirect']}}},
      {displayName:'Claim Request Key',name:'channelDmClaimRequestKey',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendChannelMemberDirect']}}},
      {displayName:'Claim Recipient ID',name:'channelDmClaimRecipientId',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendChannelMemberDirect']}}},
      {displayName:'Claim Execution ID',name:'channelDmClaimExecutionId',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendChannelMemberDirect']}}}
    );
    this.description.properties.push(
      {displayName:'Topic Image Forward Scope JSON',name:'topicFwdScopeJSON',type:'string',default:'',required:true,noDataExpression:true,displayOptions:{show:{operation:['sendTopicImageForward']}}},
      {displayName:'Original Topic Update JSON',name:'topicFwdUpdateJSON',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendTopicImageForward']}}},
      {displayName:'Claim Validated',name:'topicFwdClaimValidated',type:'boolean',default:false,required:true,displayOptions:{show:{operation:['sendTopicImageForward']}}},
      {displayName:'Claim Request Key',name:'topicFwdClaimRequestKey',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendTopicImageForward']}}},
      {displayName:'Claim Execution ID',name:'topicFwdClaimExecutionId',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendTopicImageForward']}}}
    );
    this.description.properties.push(
      {displayName:'Attendance Report JSON',name:'attendanceReportJSON',type:'string',default:'',required:true,displayOptions:{show:{operation:['sendAttendanceReport']}}},
      {displayName:'Attendance Extra Allowed Group ID (optional)',name:'attendanceExtraGroupId',type:'string',default:'',required:false,noDataExpression:true,displayOptions:{show:{operation:['sendAttendanceReport']}}}
    );
    this.description.properties.push(...[
      ['Live Attendance Group ID','liveAttendanceGroupId','string',true],['Live Attendance Extra Review Group ID (optional)','liveAttendanceReviewGroupId','string',false]
    ].map(([displayName,name,type,required])=>({displayName,name,type,default:'',required,noDataExpression:true,displayOptions:{show:{operation:['pollLiveAttendance']}}})));
    this.description.properties.push(...[
      ['Membership Group ID','membershipGroupId','string',''],['Membership Activation ISO','membershipActivatedAt','string',''],
      ['Welcome Text and Entities JSON','membershipWelcomeJSON','string',''],['Departure Text and Entities JSON','membershipLeftJSON','string',''],
      ['Welcome Custom Emoji JSON','membershipWelcomeEmojiJSON','string',''],['Departure Custom Emoji JSON','membershipLeftEmojiJSON','string','']
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,noDataExpression:true,displayOptions:{show:{operation:['sendMembershipDirectPart']}}})));
    this.description.properties.push(...[
      ['Original Membership Update JSON','membershipUpdateJSON','string',''],['Membership Claim Validated','membershipClaimValidated','boolean',false],
      ['Membership Claim Execution ID','membershipClaimExecutionId','string',''],['Membership Claim Request Key','membershipClaimRequestKey','string',''],
      ['Membership Claim Recipient ID','membershipClaimRecipientId','string','']
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,displayOptions:{show:{operation:['sendMembershipDirectPart']}}})));
    this.description.properties.push({displayName:'Message Part',name:'membershipPart',type:'options',options:[{name:'Text',value:'text'},{name:'Custom Emoji',value:'emoji'}],default:'text',required:true,noDataExpression:true,displayOptions:{show:{operation:['sendMembershipDirectPart']}}});
    this.description.properties.push(...[
      ['Image Group ID','imageGroupId','string',''],['Image Topic ID','imageTopicId','number',0],['Three Custom Emoji IDs','imageEmojiIds','string',''],['Start Hour India','imageStartHour','number',4],['End Hour India Exclusive','imageEndHour','number',10],['Activation Time ISO','imageActivatedAt','string','']
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,noDataExpression:true,displayOptions:{show:{operation:['inspectImageReactionScope','reactToScheduledImage']}}})));
    this.description.properties.push(...[
      ['Original Telegram Update JSON','imageUpdateJSON','string',''],['Image Claim Validated','imageClaimValidated','boolean',false],['Image Claim Execution ID','imageClaimExecutionId','string',''],['Image Claim Request Key','imageClaimRequestKey','string','']
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,displayOptions:{show:{operation:['reactToScheduledImage']}}})));
    this.description.properties.push(...[
      ['Allowed Operator IDs','allowedOperatorIds','string',''],['Review Group ID','reviewChatId','string',''],['Bot ID','botId','string',''],
      ['Authenticated Telegram Update JSON','updateJSON','string',''],['Delivery Claim Validated','claimValidated','boolean',false],
      ['Claim Execution ID','claimExecutionId','string',''],['Claim Request Key','claimRequestKey','string',''],['Claim Operator ID','claimOperatorId','string',''],
      ['Claim Literal Body','claimBody','string',''],['Claim Target URL','claimUrl','string','']
    ].map(([displayName,name,type,defaultValue])=>({displayName,name,type,default:defaultValue,required:true,
      noDataExpression:['allowedOperatorIds','reviewChatId','botId'].includes(name),displayOptions:{show:{operation:['sendDirectReply','sendDirectReaction']}}})));
    this.description.properties.push(...[
      ['Reaction Source Message URL','reactionSourceUrl'],['Reaction Target Message URL','reactionTargetUrl'],
      ['Allowed Reaction Group ID','reactionGroupId'],['Source Operator IDs','reactionOperatorIds']
    ].map(([displayName,name])=>({displayName,name,type:'string',default:'',required:true,noDataExpression:true,displayOptions:{show:{operation:['inspectReactionCopy','copyUserReaction']}}})));
  }
  async execute() {
    const operation = this.getNodeParameter('operation', 0);
    if (this.getInputData().length !== 1) throw new Error('NNA_SINGLE_ITEM_REQUIRED');
    const credentials = await this.getCredentials('nnaTelegramSender');
    const parameters = {};
    if(operation==='exportUserHistory'){
      parameters.scope=JSON.parse(this.getNodeParameter('userExportScopeJSON',0));
      parameters.update=JSON.parse(this.getNodeParameter('userExportUpdateJSON',0));
    }
    if(['inspectMembershipRecordScope','sendMembershipRecord'].includes(operation))parameters.scope=JSON.parse(this.getNodeParameter('membershipRecordScopeJSON',0));
    if(operation==='sendMembershipRecord'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(this.getNodeParameter('membershipRecordExecutionId',0))!==String(this.getExecutionId()))throw Error('NNA_CLAIM_EXECUTION_MISMATCH');
      parameters.record=JSON.parse(this.getNodeParameter('membershipRecordJSON',0));parameters.claim=JSON.parse(this.getNodeParameter('membershipRecordClaimJSON',0));
    }
    if(operation==='readMessageTemplate'){for(const name of ['templateGroupId','templateMessageIds','membershipExtraChannelId'])parameters[name]=this.getNodeParameter(name,0,'');}
    if(operation==='sendChannelMemberDirect'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(this.getNodeParameter('channelDmClaimExecutionId',0))!==String(this.getExecutionId()))throw Error('NNA_CLAIM_EXECUTION_MISMATCH');
      parameters.scope=JSON.parse(this.getNodeParameter('channelDmScopeJSON',0));parameters.event=JSON.parse(this.getNodeParameter('channelDmEventJSON',0));
      parameters.part=this.getNodeParameter('channelDmPart',0);parameters.claimValidated=this.getNodeParameter('channelDmClaimValidated',0);
      parameters.claimRequestKey=this.getNodeParameter('channelDmClaimRequestKey',0);parameters.claimRecipientId=this.getNodeParameter('channelDmClaimRecipientId',0);
      parameters.membershipExtraChannelId=this.getNodeParameter('membershipExtraChannelId',0,'');
    }
    if(operation==='sendTopicImageForward'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(this.getNodeParameter('topicFwdClaimExecutionId',0))!==String(this.getExecutionId()))throw Error('NNA_CLAIM_EXECUTION_MISMATCH');
      parameters.scope=JSON.parse(this.getNodeParameter('topicFwdScopeJSON',0));parameters.update=JSON.parse(this.getNodeParameter('topicFwdUpdateJSON',0));
      parameters.claimValidated=this.getNodeParameter('topicFwdClaimValidated',0);parameters.claimRequestKey=this.getNodeParameter('topicFwdClaimRequestKey',0);
    }
    if(operation==='readChannelMembership')for(const name of ['membershipChannelId','membershipExtraChannelId','membershipSinceEventId','membershipActivatedAt'])parameters[name]=this.getNodeParameter(name,0,'');
    if(operation==='sendAttendanceReport'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      parameters.report=JSON.parse(this.getNodeParameter('attendanceReportJSON',0));parameters.attendanceExtraGroupId=this.getNodeParameter('attendanceExtraGroupId',0,'');
    }
    if(operation==='pollLiveAttendance')for(const name of ['liveAttendanceGroupId','liveAttendanceReviewGroupId'])parameters[name]=this.getNodeParameter(name,0,'');
    if(['inspectTopicState','setTopicState'].includes(operation)){for(const name of ['topicStateGroupId','topicStateTopicId'])parameters[name]=this.getNodeParameter(name,0);if(operation==='setTopicState')parameters.topicStateAction=this.getNodeParameter('topicStateAction',0);}
    if(['inspectTopicReactionScope','reactToTopicPost'].includes(operation))for(const name of ['topicReactionGroupId','topicReactionTopicId','topicReactionEmojiPool','topicReactionActivatedAt'])parameters[name]=this.getNodeParameter(name,0);
    if(operation==='reactToTopicPost'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(this.getNodeParameter('topicReactionClaimExecutionId',0))!==String(this.getExecutionId()))throw Error('NNA_CLAIM_EXECUTION_MISMATCH');
      parameters.update=JSON.parse(this.getNodeParameter('topicReactionUpdateJSON',0));parameters.selectedEmojiIds=JSON.parse(this.getNodeParameter('topicReactionSelectedJSON',0));
      parameters.claimValidated=this.getNodeParameter('topicReactionClaimValidated',0);parameters.claimRequestKey=this.getNodeParameter('topicReactionClaimRequestKey',0);parameters.claimEmojiIds=this.getNodeParameter('topicReactionClaimEmojiIds',0);
    }
    if(operation==='publishMedia'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(this.getNodeParameter('mediaClaimExecutionId',0))!==String(this.getExecutionId()))throw Error('NNA_CLAIM_EXECUTION_MISMATCH');
      parameters.config=JSON.parse(this.getNodeParameter('mediaScopeJSON',0));parameters.delivery=JSON.parse(this.getNodeParameter('mediaDeliveryJSON',0));
    }
    if(operation==='sendMembershipDirectPart'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(this.getNodeParameter('membershipClaimExecutionId',0))!==String(this.getExecutionId()))throw Error('NNA_CLAIM_EXECUTION_MISMATCH');
      for(const name of ['membershipGroupId','membershipActivatedAt','membershipWelcomeJSON','membershipLeftJSON','membershipWelcomeEmojiJSON','membershipLeftEmojiJSON'])parameters[name]=this.getNodeParameter(name,0);
      parameters.update=JSON.parse(this.getNodeParameter('membershipUpdateJSON',0));parameters.claimValidated=this.getNodeParameter('membershipClaimValidated',0);parameters.claimRequestKey=this.getNodeParameter('membershipClaimRequestKey',0);parameters.claimRecipientId=this.getNodeParameter('membershipClaimRecipientId',0);parameters.part=this.getNodeParameter('membershipPart',0);
    }
    if(['inspectImageReactionScope','reactToScheduledImage'].includes(operation))for(const name of ['imageGroupId','imageTopicId','imageEmojiIds','imageStartHour','imageEndHour','imageActivatedAt'])parameters[name]=this.getNodeParameter(name,0);
    if(operation==='reactToScheduledImage'){
      if(this.getNode().retryOnFail)throw Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(this.getNodeParameter('imageClaimExecutionId',0))!==String(this.getExecutionId()))throw Error('NNA_CLAIM_EXECUTION_MISMATCH');
      parameters.update=JSON.parse(this.getNodeParameter('imageUpdateJSON',0));parameters.claimValidated=this.getNodeParameter('imageClaimValidated',0);parameters.claimRequestKey=this.getNodeParameter('imageClaimRequestKey',0);
    }
    if(['inspectReactionCopy','copyUserReaction'].includes(operation)) {
      for(const name of ['reactionSourceUrl','reactionTargetUrl','reactionGroupId','reactionOperatorIds'])parameters[name]=this.getNodeParameter(name,0);
      if(this.getNode().retryOnFail)throw new Error('NNA_DISABLE_RETRY_ON_FAIL');
    }
    if(['sendDirectReply','sendDirectReaction'].includes(operation)) {
      for(const name of ['allowedOperatorIds','reviewChatId','botId','claimValidated','claimExecutionId','claimRequestKey','claimOperatorId','claimBody','claimUrl'])parameters[name]=this.getNodeParameter(name,0);
      parameters.update=JSON.parse(this.getNodeParameter('updateJSON',0));
      if(this.getNode().retryOnFail)throw new Error('NNA_DISABLE_RETRY_ON_FAIL');
      if(String(parameters.claimExecutionId)!==String(this.getExecutionId()))throw new Error('NNA_CLAIM_EXECUTION_MISMATCH');
    }
    if (operation === 'readTopicHistory') for (const name of ['historyTopicId', 'startDate', 'endDate', 'offsetId']) parameters[name] = this.getNodeParameter(name, 0);
    if (operation === 'readTopicHistory') parameters.historyFullReport = this.getNodeParameter('historyFullReport', 0, false);
    if (operation === 'sendApprovedReply') for (const name of ['draftKey', 'approvedAt', 'ownerId', 'approvalClaimToken', 'approvalValidated', 'bodyHTML', 'sourceText', 'messageId', 'topicId']) parameters[name] = this.getNodeParameter(name, 0);
    if (operation === 'sendApprovedReply') {
      if (this.getNode().retryOnFail) throw new Error('NNA_DISABLE_RETRY_ON_FAIL');
      if (String(parameters.approvalClaimToken) !== String(this.getExecutionId())) throw new Error('NNA_CLAIM_EXECUTION_MISMATCH');
    }
    const result = await runOperation(operation, credentials, parameters);
    if(operation==='exportUserHistory'){
      const {fileText,...metadata}=result;
      const data=await this.helpers.prepareBinaryData(Buffer.from(fileText,'utf8'),result.fileName,'text/plain');
      return [[{json:metadata,binary:{data},pairedItem:{item:0}}]];
    }
    return [[{ json: result, pairedItem: { item: 0 } }]];
  }
}
module.exports = { NnaTelegramSender };
