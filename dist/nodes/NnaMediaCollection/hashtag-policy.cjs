'use strict';

// Pure policy component. No Telegram writes and no AI/network calls.
const bank = require('./hashtag-bank.json');
const valid = value => typeof value === 'string' && /^[\p{L}_][\p{L}\p{N}\p{M}_]{0,63}$/u.test(value);
const clean = value => typeof value === 'string' ? value.normalize('NFC').trim().replace(/^#/, '') : '';
const key = value => clean(value).toLocaleLowerCase('en-US');
const aliases = new Map();
for (const [tag, variants] of Object.entries(bank.tags)) {
  for (const spelling of [tag, ...variants]) {
    const existing = aliases.get(key(spelling));
    if (existing && existing !== tag) throw new Error('AMBIGUOUS_ALIAS');
    aliases.set(key(spelling), tag);
  }
}

function selectHashtags(analysis, reusedTags = []) {
  if (!analysis || !Array.isArray(analysis.candidates) || analysis.candidates.length > 100) {
    throw new Error('INVALID_ANALYSIS');
  }
  const currentAliases = new Map(aliases);
  for (const raw of reusedTags.slice(0, 300)) {
    const tag = clean(raw);
    if (valid(tag) && !currentAliases.has(key(tag))) currentAliases.set(key(tag), tag);
  }
  const known = new Map(), novel = new Map(), rejected = [];
  for (const candidate of analysis.candidates) {
    const tag = clean(candidate?.tag);
    if (!valid(tag) || !Number.isFinite(candidate?.confidence)
        || candidate.confidence < bank.minimumConfidence || candidate.confidence > 1
        || typeof candidate.evidence !== 'string' || !candidate.evidence.trim()
        || candidate.evidence.length > 600) {
      rejected.push({tag, reason: 'invalid_or_insufficient_evidence'});
      continue;
    }
    const canonical = currentAliases.get(key(tag));
    if (canonical === 'Demigod' && candidate.explicitClassification !== true) {
      rejected.push({tag, reason: 'explicit_classification_required'});
      continue;
    }
    const normalized = canonical || tag;
    const target = canonical ? known : novel;
    const previous = target.get(key(normalized));
    if (!previous || candidate.confidence > previous.confidence) {
      target.set(key(normalized), {...candidate, tag: normalized});
    }
  }
  for (const subject of [...known.values()]) {
    if (!bank.sharedCategories.subjects.includes(subject.tag)) continue;
    for (const parent of bank.sharedCategories.parents) {
      if (!known.has(key(parent))) known.set(key(parent), {tag: parent, confidence: subject.confidence, evidence: 'User-defined common category for ' + subject.tag + ': ' + subject.evidence});
    }
  }
  const sort = values => [...values].sort((a, b) => b.confidence - a.confidence || a.tag.localeCompare(b.tag, 'en'));
  const rankedKnown = sort(known.values());
  // Keep this collection's common parents whenever a deity subject is retained.
  if ([...known.values()].some(x => bank.sharedCategories.subjects.includes(x.tag))) {
    rankedKnown.sort((a,b) => Number(bank.sharedCategories.parents.includes(b.tag)) - Number(bank.sharedCategories.parents.includes(a.tag)));
  }
  const selectedKnown = rankedKnown.slice(0, bank.targetCount - bank.maxNovel);
  // Never let novel tags exceed 20% of the actual selection, even with a small bank match.
  const novelLimit = Math.min(bank.maxNovel, Math.floor(selectedKnown.length / 4), bank.targetCount - selectedKnown.length);
  const selectedNovel = sort(novel.values()).slice(0, novelLimit);
  selectedKnown.push(...rankedKnown.slice(selectedKnown.length, bank.targetCount - selectedNovel.length));
  const selected = [...selectedKnown, ...selectedNovel];
  return {
    bankVersion: bank.version,
    tags: selected.map(x => '#' + x.tag),
    knownCount: selectedKnown.length,
    novelCount: selectedNovel.length,
    evidence: selected.map(x => ({tag: '#' + x.tag, evidence: x.evidence})),
    needsReview: analysis.needsReview === true || selected.length === 0,
    belowTarget: selected.length < bank.targetCount,
    rejected
  };
}

function composeCaption(originalCaption, entities, tags, limit = 1024) {
  if (typeof originalCaption !== 'string' || !Array.isArray(entities) || !Array.isArray(tags)
      || !Number.isSafeInteger(limit) || limit < 1) throw new Error('INVALID_CAPTION_INPUT');
  for (const e of entities) {
    if (!e || !Number.isSafeInteger(e.offset) || !Number.isSafeInteger(e.length)
        || e.offset < 0 || e.length < 1 || e.offset + e.length > originalCaption.length) {
      throw new Error('INVALID_ENTITY_RANGE');
    }
  }
  // Preserve the original text/entities. Do not silently rewrite user-authored hashtags.
  const existing = new Set([...originalCaption.matchAll(/(?<![\p{L}\p{N}\p{M}_])#([\p{L}_][\p{L}\p{N}\p{M}_]*)/gu)]
    .map(m => key(aliases.get(key(m[1])) || m[1])));
  const added = [];
  for (const raw of tags) {
    const normalized = aliases.get(key(raw)) || clean(raw);
    if (!valid(normalized)) throw new Error('INVALID_HASHTAG');
    if (existing.has(key(normalized))) continue;
    existing.add(key(normalized));
    added.push('#' + normalized);
  }
  const separator = originalCaption.length && added.length ? '\n\n' : '';
  const caption = originalCaption + separator + added.join(' ');
  // JS length is UTF-16, matching Telegram entity offsets. This conservative limit never truncates.
  if (caption.length > limit) {
    return {status: 'needs_edit', caption: originalCaption, captionEntities: entities.map(e => ({...e})), proposedHashtags: added, requiredLength: caption.length, limit};
  }
  return {status: 'ready', caption, captionEntities: entities.map(e => ({...e})), addedHashtags: added};
}

function summaryLines(analysis) {
  const lines = analysis?.summaryLines;
  if (!Array.isArray(lines) || lines.length < 3 || lines.length > 4
      || !lines.every(s => typeof s === 'string' && s.trim().length > 0
        && s.trim().length <= 160 && !/[\r\n#]/.test(s) && !/https?:\/\//i.test(s)
        && /[A-Za-z]/.test(s)
        && (s.match(/\p{L}/gu) || []).every(letter => /\p{Script=Latin}/u.test(letter)))
      || lines.join('\n').length > 600) {
    throw new Error('INVALID_SUMMARY');
  }
  return lines.map(s => s.trim());
}

function composeAnalysisCaption(original, entities, summary, tags, limit = 1024) {
  const lines = summaryLines({summaryLines: summary});
  const base = original + (original ? '\n\n' : '') + lines.join('\n');
  const result = composeCaption(base, entities, tags, limit);
  if (result.status !== 'ready') return {...result, caption: original};
  return result;
}

// Telegram's native inline monospace spans wrap on mobile and copy the whole
// span. Keep one span for all summary lines and one for the entire hashtag batch.
// JS string offsets are UTF-16 code units, as required by Telegram MessageEntity.
function composeAnalysisReport(draft) {
  if (!draft.analysisApproved) return {text: '', entities: []};
  const summary = (draft.summaryLines || []).join('\n');
  const hashtags = (draft.tags || []).join(' ');
  const text = summary + '\n\n' + hashtags;
  const entities = [];
  if (summary) entities.push({type: 'code', offset: 0, length: summary.length});
  if (hashtags) entities.push({type: 'code', offset: summary.length + 2, length: hashtags.length});
  return {text, entities};
}

module.exports = {selectHashtags, composeCaption, summaryLines, composeAnalysisCaption, composeAnalysisReport};
