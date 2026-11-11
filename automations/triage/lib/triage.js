'use strict';
const { lowerText, findPhrase } = require('../../../firm/lib/text');
const { detectUrgency } = require('../../../firm/lib/urgency');
const { TRIAGE_CATEGORY_LABEL, triageLabelNames, triageAllLabelNames, triagePrepareGmail, triageCombine, triagePickLabelIds } = require('./labels');
// Email triage for Dyzania LLP (fictional). Pure functions, no I/O.
// The model reads the email and gives an opinion. These rules decide what happens.
//   - Rules can only make handling MORE careful than the model asked for, never less.
//   - Nothing here is ever sent to a sender automatically: the result is a classification, a queue,
//     an optional DRAFT (a person sends it) and an alert to a person.
//   - Law-firm rules (firm/urgency.json "neverDo"): no legal advice, no deadline stated as fact,
//     no opinion on a case, no promise about outcome or timing, no reply to opposing counsel or a court.
// data = { firm, urgency, rules, kbAmounts } (see lib/data.js). today = 'YYYY-MM-DD' in the firm's timezone.

const TRIAGE_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const TRIAGE_SENTIMENTS = ['positive', 'neutral', 'negative', 'angry'];
const TRIAGE_CONFIDENCE_FLOOR = 0.7;
const TRIAGE_QUEUE_BY_CATEGORY = {
  court_notice: 'records', opposing_counsel: 'matter_attorney', existing_client: 'case_team',
  billing: 'billing', new_inquiry: 'intake', scheduling: 'front_desk', other: 'front_desk', spam: 'none'
};
const TRIAGE_REASON_TEXT = {
  model_flagged: 'The classifier asked for a person',
  fallback: 'The classifier gave no usable answer',
  injection: 'Possible prompt injection',
  empty: 'Empty or unreadable message',
  low_confidence: 'Low classifier confidence',
  urgent: 'Time-sensitive: a person must look now',
  time_check: 'Mentions a hearing or deadline: a person should check',
  court_notice: 'Court notice',
  other_lawyer: 'From another lawyer, an insurer or the other side',
  existing_client: 'Existing client: the case team replies',
  angry: 'Angry sender with high priority',
  non_english: 'Not English: the rule screen reads English only',
  draft_blocked: 'The draft failed a safety check or the draft model was unavailable',
  draft_assistant_flag: 'The draft assistant asked for a person'
};

// ---- helpers ----
function triageRank(p) { return TRIAGE_PRIORITIES.indexOf(p); }
function triageMax(a, b) { return triageRank(a) >= triageRank(b) ? a : b; }
function triageUnique(list) { return Array.from(new Set(list)); }

// A model answer may be an object, a JSON string, a chat-node item ({ output } or { text }), or an error.
function triageParseJson(j) {
  let r = j;
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    if (r.output !== undefined) r = r.output;
    else if (r.text !== undefined) r = r.text;
  }
  if (typeof r === 'string') {
    try { r = JSON.parse(r.replace(/```json|```/g, '').trim()); } catch (e) { r = null; }
  }
  return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
}

// ---- 1. sanitize ----
// Patterns that try to give the assistant instructions. A hit is a flag for a person, never a verdict.
const TRIAGE_INJECTION = [
  { id: 'ignore_instructions', re: /(?:ignore|disregard) (?:all |any |the )?(?:previous|prior|above|earlier|your) (?:instructions|prompts?|rules|guidelines)/i },
  { id: 'reveal_prompt', re: /(?:reveal|print|show|disclose|repeat|output|display) (?:me )?(?:your |the )?(?:full |complete |entire |hidden )?(?:system|initial) ?(?:prompt|instructions|message)/i },
  { id: 'system_override', re: /system (?:override|prompt|message)/i },
  { id: 'role_change', re: /you are (?:now )?(?:no longer|now in|dan\b)/i },
  { id: 'mode_switch', re: /(?:admin|developer|god|jailbreak) mode/i },
  { id: 'markup_tag', re: /<\/?(?:instructions?|system|assistant|prompt|email)>/i },
  { id: 'force_priority', re: /mark (?:this|the|it)(?: message| email)? as (?:urgent|high|low|spam|not spam|priority)/i },
  { id: 'exfiltrate', re: /(?:forward|send) (?:me )?(?:everything|all (?:emails|messages|files|documents))/i },
  { id: 'do_not_escalate', re: /do not (?:escalate|flag|alert)/i },
  { id: 'dan', re: /\bDAN\b/ }
];

function triageInjectionHits(text) {
  return TRIAGE_INJECTION.filter((p) => p.re.test(text)).map((p) => p.id);
}

function triageSanitize(raw) {
  const r = raw || {};
  const rawFrom = String(r.from || '').trim();
  const m = rawFrom.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const fromAddress = (m ? m[2] : rawFrom).trim().toLowerCase();
  const fromName = m ? m[1].trim() : '';
  const fromDomain = fromAddress.indexOf('@') >= 0 ? fromAddress.split('@').pop() : '';
  const greetName = /^[A-Za-z][A-Za-z'-]+( |$)/.test(fromName) ? fromName.split(' ')[0] : 'there';
  // Zero-width and control characters can hide text from a reader; remove them before anything reads the message.
  const hidden = /[​-‏‪-‮⁠-⁤﻿]/g;
  const ctrl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const subject = String(r.subject || '').replace(hidden, '').replace(ctrl, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const rawBody = String(r.body || '').replace(/\r/g, '').replace(hidden, '').replace(ctrl, ' ');
  let body = rawBody;
  if (/<(html|body|div|p|br|table|span|a)[\s>\/]/i.test(body)) {
    body = body.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ');
    body = body.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  // Two readings of the same message.
  //   body       what the model sees: the new text only, cut at every kind of reply marker, 4000 characters.
  //   screenBody what the rule screen reads: cut only at the Gmail-style "On ... wrote:" line, up to 20000
  //              characters. Outlook's "Original Message" and "From:/Sent:" markers are used for forwards as well as
  //              replies, so a forwarded summons must not be cut away before the rules look for a date.
  const tidy = (t) => t.split('\n').filter((l) => l.charAt(0) !== '>').join('\n').replace(/<\/?email>/gi, '[tag]').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  const cutAt = (t, re) => { const i = t.search(re); return i > 0 ? t.slice(0, i) : t; };
  const sigAt = (t) => { const i = t.indexOf('\n-- \n'); return i > 0 ? t.slice(0, i) : t; };
  const gmailCut = /^On .{5,200} wrote:/m;
  const outlookCut = /^(-{2,} ?Original Message ?-{2,}|From: .+\nSent: )/m;
  const screenBody = tidy(sigAt(cutAt(body, gmailCut))).slice(0, 20000);
  body = tidy(sigAt(cutAt(cutAt(body, gmailCut), outlookCut))).slice(0, 4000);
  const injectionHits = triageUnique(triageInjectionHits(subject + '\n' + rawBody).concat(triageInjectionHits(subject + '\n' + screenBody)));
  return {
    source: String(r.source || 'unknown'), messageId: String(r.messageId || ''), sampleId: String(r.sampleId || ''),
    fromAddress, fromName, fromDomain, greetName, subject, body, screenBody,
    emptyBody: screenBody.length === 0 || !/\p{L}/u.test(screenBody), injectionHits
  };
}

// ---- 2. rule screen ----
const TRIAGE_EN_WORDS = ('the and to of is you my in for that it with was on are have not this be can please would your i a me we they he she if but so what when how do does about').split(' ');
const TRIAGE_ES_WORDS = ('el la los las de que y en un una es por para con mi su hola gracias necesito como puedo tengo ayuda cuanto cita se lo al del muy tengo estoy ayer audiencia abogado').split(' ');

// A crude guess, enough to know whether the English-only rule screen can read the message.
function triageGuessLanguage(text) {
  const words = lowerText(text).split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 3) return 'en';
  let en = 0;
  let es = 0;
  words.forEach((w) => { if (TRIAGE_EN_WORDS.indexOf(w) >= 0) en++; if (TRIAGE_ES_WORDS.indexOf(w) >= 0) es++; });
  if (es >= 2 && es > en) return 'es';
  if (words.length >= 8 && en / words.length < 0.1) return 'other';
  return 'en';
}

function triageScreen(email, data, today) {
  const rules = data.rules;
  const text = email.subject + '\n' + email.screenBody;
  const urgency = detectUrgency({ text }, data.urgency, today);
  const autoReply = rules.autoReply.subjectPatterns.some((p) => new RegExp(p, 'i').test(email.subject)) ||
    rules.autoReply.senderContains.some((s) => email.fromAddress.indexOf(s) >= 0);
  const fromCourt = email.fromDomain !== '' && rules.knownCourtDomains.some((d) => email.fromDomain === d || email.fromDomain.slice(-(d.length + 1)) === '.' + d);
  const lt = lowerText(text);
  const counselCue = rules.counselCues.some((c) => findPhrase(lt, c) !== null) || /^\s*(?:dear )?counsel\b[,:]/im.test(email.screenBody);
  return { urgency, injection: email.injectionHits, language: triageGuessLanguage(email.body || email.subject), autoReply, fromCourt, counselCue };
}

// ---- 3. the model's answer, checked ----
function triageNormalizeModel(j, data) {
  const cats = data.urgency.triageCategories;
  const r = triageParseJson(j);
  const ok = r && cats.indexOf(r.category) >= 0 && TRIAGE_PRIORITIES.indexOf(r.priority) >= 0;
  if (!ok) {
    return { status: 'fallback', category: 'other', priority: 'normal', sentiment: 'neutral', language: 'en', summary: '', confidence: 0, needsHuman: true, humanReason: 'Classifier output was invalid or unavailable', injection: false };
  }
  const conf = Math.min(1, Math.max(0, Number(r.confidence)));
  return {
    status: 'ok',
    category: r.category,
    priority: r.priority,
    sentiment: TRIAGE_SENTIMENTS.indexOf(r.sentiment) >= 0 ? r.sentiment : 'neutral',
    language: typeof r.language === 'string' && /^[A-Za-z]{2,3}$/.test(r.language) ? r.language.toLowerCase() : 'en',
    summary: String(r.summary || '').slice(0, 300),
    confidence: Number.isFinite(conf) ? conf : 0.5,
    needsHuman: r.needsHuman === true,
    humanReason: String(r.humanReason || '').slice(0, 200),
    injection: r.injectionSuspected === true
  };
}

// ---- 4. decide ----
function triageDecide(email, screen, model, data) {
  const injection = screen.injection.length > 0 || model.injection === true;
  const auto = screen.autoReply;
  let category = model.category;
  let categoryBy = 'model';
  if (auto) { category = 'other'; categoryBy = 'rule'; }
  else if (screen.fromCourt) { category = 'court_notice'; categoryBy = 'rule'; }
  else if (screen.counselCue) { category = 'opposing_counsel'; categoryBy = 'rule'; }

  // Priority: the model may raise it. The rules set a floor under it. A model that has been pushed by the
  // email itself (injection) cannot raise a message above normal.
  let priority = model.priority;
  if (injection && triageRank(priority) > triageRank('normal')) priority = 'normal';
  if (category === 'spam') priority = 'low';
  let floor = 'low';
  if (screen.urgency.level === 'urgent') floor = 'urgent';
  else if (screen.urgency.level === 'check') floor = 'high';
  if (category === 'court_notice' || category === 'opposing_counsel') floor = triageMax(floor, 'high');
  if (auto) { priority = 'low'; floor = 'low'; }
  priority = triageMax(priority, floor);

  const language = model.status === 'ok' ? model.language : screen.language;
  const reasons = [];
  if (!auto) {
    if (model.needsHuman) reasons.push('model_flagged');
    if (model.status === 'fallback') reasons.push('fallback');
    if (injection) reasons.push('injection');
    if (email.emptyBody) reasons.push('empty');
    if (model.status === 'ok' && model.confidence < TRIAGE_CONFIDENCE_FLOOR) reasons.push('low_confidence');
    if (priority === 'urgent') reasons.push('urgent');
    else if (screen.urgency.level === 'check') reasons.push('time_check');
    if (category === 'court_notice') reasons.push('court_notice');
    if (category === 'opposing_counsel') reasons.push('other_lawyer');
    if (category === 'existing_client') reasons.push('existing_client');
    if (model.sentiment === 'angry' && triageRank(priority) >= triageRank('high')) reasons.push('angry');
    if (language !== 'en' || screen.language !== 'en') reasons.push('non_english');
  }

  let draftMode = 'standard';
  if (auto || injection || category === 'spam' || email.emptyBody || category === 'opposing_counsel') draftMode = 'none';
  else if (category === 'court_notice') draftMode = screen.fromCourt ? 'none' : 'acknowledgement';
  else if (priority === 'urgent') draftMode = 'acknowledgement';
  // The classifier gave nothing usable: nobody knows what this is (spam, a lawyer, a court), so no draft.
  else if (model.status === 'fallback') draftMode = 'none';

  let queue;
  if (auto || (category === 'spam' && priority !== 'urgent')) queue = 'none';
  else if (priority === 'urgent') queue = 'urgent';
  else queue = TRIAGE_QUEUE_BY_CATEGORY[category];

  let handoff = null;
  if (!injection && !auto) {
    if (category === 'new_inquiry') handoff = 'intake';
    else if (category === 'court_notice') handoff = 'extraction';
  }

  return { category, categoryBy, priority, floor, injection, injectionHits: screen.injection, language, reasons, draftMode, queue, handoff, sentiment: model.sentiment, confidence: model.confidence, summary: model.summary, classificationStatus: model.status, modelReason: model.humanReason };
}

// ---- 5. fixed texts (acknowledgement, holding reply, disclaimer) ----
const TRIAGE_TEXT = {
  en: {
    hello: 'Hello', closing: 'Best regards,',
    thanks: (firm) => 'Thank you for contacting ' + firm.name + '.',
    flagged: 'Your message has been flagged for a member of the team to read. We cannot tell you by email what a date or a paper means for you, and we cannot promise when someone will reply.',
    court: (firm) => 'If this is about a court matter, please email ' + firm.emails.urgent + ' and call the office on ' + firm.phone + '. The office is open Monday to Friday, 8:30 to 17:30.',
    soon: (firm) => 'If you have a hearing or a deadline soon, please call the office on ' + firm.phone + '. The office is open Monday to Friday, 8:30 to 17:30.',
    referral: 'The firm does not handle every kind of matter and may not be able to help with this one. If a time limit may be running, please contact another lawyer quickly. The local bar association\'s lawyer referral service can point you to one.',
    holding: 'A member of the team will read your message and follow up.',
    disclaimer: (firm) => firm.language.notLegalAdvice,
    emergency: (firm) => firm.language.emergency
  },
  es: {
    hello: 'Hola', closing: 'Saludos cordiales,',
    thanks: (firm) => 'Gracias por escribir a ' + firm.name + '.',
    flagged: 'Su mensaje fue marcado para que lo lea una persona del equipo. No podemos decirle por correo qué significa una fecha o un documento para usted, ni prometer cuándo recibirá respuesta.',
    court: (firm) => 'Si se trata de un asunto judicial, escriba a ' + firm.emails.urgent + ' y llame a la oficina al ' + firm.phone + '. La oficina atiende de lunes a viernes, de 8:30 a 17:30.',
    soon: (firm) => 'Si tiene una audiencia o un plazo próximo, llame a la oficina al ' + firm.phone + '. La oficina atiende de lunes a viernes, de 8:30 a 17:30.',
    referral: 'El despacho no atiende todos los tipos de asuntos y es posible que no pueda ayudarle con este. Si puede estar corriendo un plazo, comuníquese pronto con otro abogado. El servicio de referencia de abogados del colegio de abogados local puede indicarle uno.',
    holding: 'Una persona del equipo leerá su mensaje y le dará seguimiento.',
    disclaimer: () => 'Esta es información general, no asesoría legal. No existe una relación abogado-cliente hasta que usted y el despacho firmen una carta de contratación.',
    emergency: () => 'Si usted u otra persona está en peligro inmediato, llame al 911 o al número de emergencias local.'
  }
};

function triageLang(language) { return language === 'es' ? 'es' : 'en'; }
function triageGreeting(t, email) { return t.hello + (email.greetName === 'there' ? '' : ' ' + email.greetName) + ','; }

function triageAckText(decision, flags, email, data) {
  const t = TRIAGE_TEXT[triageLang(decision.language)];
  const firm = data.firm;
  const also = triageUnique(flags.map((f) => f.alsoShow).filter(Boolean));
  const clientish = decision.category === 'existing_client' || decision.category === 'court_notice';
  const parts = [triageGreeting(t, email), t.thanks(firm) + ' ' + t.flagged, clientish ? t.court(firm) : t.soon(firm)];
  if (also.indexOf('emergency') >= 0) parts.push(t.emergency(firm));
  if (also.indexOf('referral') >= 0) parts.push(t.referral);
  parts.push(t.closing + '\n' + firm.name);
  parts.push(t.disclaimer(firm));
  return parts.join('\n\n');
}

function triageHoldingText(decision, email, data) {
  const t = TRIAGE_TEXT[triageLang(decision.language)];
  return [triageGreeting(t, email), t.thanks(data.firm) + ' ' + t.holding, t.closing + '\n' + data.firm.name, t.disclaimer(data.firm)].join('\n\n');
}

function triageWithDisclaimer(reply, decision, data) {
  const t = TRIAGE_TEXT[triageLang(decision.language)];
  return /not legal advice|no es asesor[ií]a legal/i.test(reply) ? reply : reply + '\n\n' + t.disclaimer(data.firm);
}

// ---- 6. check a model-written draft ----
const TRIAGE_NEGATION = /\b(?:cannot|can't|cant|can not|unable|do not|don't|dont|does not|doesn't|never|not able|no one|nobody|without)\b/i;
const TRIAGE_DATE_WORDS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight)\b/i;
const TRIAGE_ATTRIBUTED = /\b(?:you (?:wrote|mention|mentioned|said|say|noted|note|described)|your (?:message|email) (?:says|mentions|states|notes)|as written|as you (?:wrote|described))\b/i;
// Each rule looks at one sentence. 'skipIfNegated' rules ignore sentences like "we cannot tell you whether you have a strong case".
const TRIAGE_DRAFT_RULES = [
  { id: 'outcome_promise', re: /\b(?:we|i|the firm|our attorneys?|our lawyers?) (?:can |will |would |'ll )?(?:guarantee|promise|ensure)\b/i },
  { id: 'outcome_prediction', re: /\b(?:you|your case|the case) (?:will|is going to|are going to) (?:win|prevail|recover|succeed|be awarded|be compensated|be dismissed)\b/i, skipIfNegated: true },
  { id: 'merit_opinion', re: /\byou (?:do )?have (?:a|an) (?:strong|good|solid|valid|winning|promising|excellent|clear) (?:case|claim)\b|\byour (?:case|claim) (?:is|looks|seems|sounds|appears) (?:strong|good|solid|valid|winning|weak|promising)\b/i, skipIfNegated: true },
  { id: 'legal_advice', re: /\byou (?:should|must|need to|ought to|can|could) (?:sue|appeal|settle|accept|reject|decline|ignore|plead|contest|fight|countersue|file (?:a|the|your) (?:lawsuit|claim|suit|motion|response|answer|petition|appeal|complaint))\b/i, skipIfNegated: true },
  { id: 'deadline_as_fact', test: (s) => /\b(?:deadline|due|expires?|statute of limitations|time limit|must (?:respond|file|appear|answer))\b/i.test(s) && TRIAGE_DATE_WORDS.test(s) && !TRIAGE_ATTRIBUTED.test(s) && !TRIAGE_NEGATION.test(s) },
  { id: 'deadline_stated', re: /\b(?:your|the) (?:deadline|statute of limitations|time limit|filing deadline)\b[^.\n]{0,40}\b(?:is|are|was|expires?|ends?|falls?|runs?)\b/i, skipIfNegated: true },
  { id: 'time_promise', re: /\b(?:an? )?(?:attorney|lawyer|partner|someone|a member of (?:the|our) team|we) (?:will|shall|'ll) (?:call|contact|respond|reply|get back|be in touch|reach out|follow up|review)[^.\n]{0,40}\b(?:today|tomorrow|tonight|this (?:morning|afternoon|evening|week)|within \d+|within (?:an|one|two|a few) (?:hour|day|business)|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|noon|end of))\b/i },
  { id: 'accepts_case', re: /\b(?:we|the firm|our attorneys?) (?:will|can|are happy to|would be happy to|'ll|would) (?:take|accept|handle|represent) (?:your|the|this) (?:case|matter)\b|\bwe (?:represent|are representing) you\b|\byou are (?:now )?(?:a client|our client)\b|attorney-client relationship (?:has|is) (?:been )?(?:formed|established|created)/i },
  { id: 'prompt_leak', re: /system prompt|knowledge base|\bkb-\d+|prompt ?version|<\/?(?:email|system|instructions?)>/i }
];

function triageCheckDraft(raw, decision, email, data) {
  const r = triageParseJson(raw);
  const problems = [];
  const reply = (r && typeof r.reply === 'string' ? r.reply.trim() : '')
    .replace(/^([^\n]{1,60},)\n(?!\n)/, '$1\n\n')
    .replace(/([^\n])\n(Best regards,|Saludos cordiales,)/, '$1\n\n$2');
  if (!reply) problems.push('empty_or_unavailable');
  const words = reply ? reply.split(/\s+/).length : 0;
  if (reply && words > 220) problems.push('too_long');
  if (reply && words < 12) problems.push('too_short');
  const domain = data.firm.domain.replace(/\./g, '\\.');
  const urls = reply.match(/https?:\/\/[^\s)>"']+/gi) || [];
  if (urls.some((u) => !new RegExp('^https://' + domain + '(/|$)', 'i').test(u.replace(/[.,;]+$/, '')))) problems.push('unapproved_link');
  const mails = reply.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  if (mails.some((a) => !new RegExp('@' + domain + '$', 'i').test(a))) problems.push('unapproved_address');
  const amounts = (reply.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || []).map((a) => a.replace(/[\s,]/g, ''));
  if (amounts.some((a) => data.kbAmounts.indexOf(a) < 0)) problems.push('invented_amount');
  const phones = reply.match(/\b\d{3}[-. ]\d{4}\b/g) || [];
  if (phones.some((p) => p.replace(/[. ]/, '-') !== data.firm.phone)) problems.push('unapproved_phone');
  reply.split(/(?<=[.!?])\s+|\n+/).forEach((s) => {
    TRIAGE_DRAFT_RULES.forEach((rule) => {
      const hit = rule.test ? rule.test(s) : rule.re.test(s) && !(rule.skipIfNegated && TRIAGE_NEGATION.test(s));
      if (hit) problems.push(rule.id);
    });
  });
  const kb = r && Array.isArray(r.kbArticlesUsed) ? r.kbArticlesUsed.map((x) => String(x)).slice(0, 5) : [];
  const conf = r ? Math.min(1, Math.max(0, Number(r.confidence))) : 0;
  const unique = triageUnique(problems);
  const blocked = unique.length > 0;
  return {
    text: blocked ? triageHoldingText(decision, email, data) : triageWithDisclaimer(reply, decision, data),
    status: blocked ? 'holding_reply' : 'drafted',
    problems: unique, kb, confidence: Number.isFinite(conf) ? conf : 0,
    assistantFlag: !!(r && r.needsHuman === true)
  };
}

// ---- 7. finish: draft, result, alert, labels, log row ----
function triageFlagsOut(flags) {
  return flags.map((f) => ({ id: f.id, label: f.label, level: f.level, reason: f.reason, dateAsWritten: f.date ? f.date.raw : null, alsoShow: f.alsoShow || null }));
}

function triageAlert(r) {
  if (!r.alertWanted) return { send: false, subject: '', text: '' };
  const lines = ['A message needs a person now.', '',
    'Category: ' + r.category.replace(/_/g, ' '), 'Queue: ' + r.queue.replace(/_/g, ' '), 'Priority: ' + r.priority,
    'Why: ' + (r.reasons.map((c) => TRIAGE_REASON_TEXT[c]).join('; ') || 'time-sensitive wording')];
  r.flags.forEach((f) => { lines.push('Flag: ' + f.label + (f.dateAsWritten ? ' (date as written by the sender: ' + f.dateAsWritten + ')' : '') + ' - ' + f.reason); });
  lines.push('Language: ' + r.language, 'Reply: ' + (r.draftStatus === 'none' ? 'no draft (a person replies)' : r.draftStatus === 'acknowledgement' ? 'a fixed acknowledgement is waiting in Gmail Drafts' : 'a draft is waiting in Gmail Drafts'));
  if (r.injectionSuspected) lines.push('Note: the message may be trying to instruct the assistant. Nothing in it was followed.');
  if (r.category === 'spam') lines.push('Note: sorted as spam, but it contains time-sensitive wording. It may be a fake notice, or a real one. Check it before relying on it.');
  lines.push('', 'Open the message in Gmail (reference ' + (r.messageId || 'none') + '). Nothing was sent to the sender. The sender, subject and message text are not in this alert.');
  return { send: true, subject: '[Dyzania triage] URGENT ' + r.category.replace(/_/g, ' ') + ' - ' + (r.messageId || 'message'), text: lines.join('\n') };
}

// Metadata only. No subject, no summary, no names, no address, no message text, no draft text.
function triageLogRow(r) {
  return {
    messageId: r.messageId, receivedAt: r.receivedAt, fromDomain: r.fromDomain,
    category: r.category, priority: r.priority, urgency: r.urgency, flags: r.flags.map((f) => f.id).join(','),
    needsHuman: r.needsHuman, reasons: r.reasons.join(','), injectionSuspected: r.injectionSuspected,
    draftMode: r.draftMode, draftStatus: r.draftStatus, queue: r.queue, handoff: r.handoff || '',
    language: r.language, sentiment: r.sentiment, confidence: r.confidence,
    classificationStatus: r.classificationStatus, status: r.status, latencyMs: r.latencyMs, promptVersion: r.promptVersion
  };
}

// dec = { email, screen, model, decision }. draftRaw = the draft model's output, or null.
function triageFinish(dec, draftRaw, data, ctx) {
  const { email, screen, decision } = dec;
  const flags = triageFlagsOut(screen.urgency.flags);
  let draft = { text: '', status: 'none', problems: [], kb: [], confidence: 0, assistantFlag: false };
  if (decision.draftMode === 'acknowledgement') draft = { text: triageAckText(decision, flags, email, data), status: 'acknowledgement', problems: [], kb: [], confidence: 1, assistantFlag: false };
  else if (decision.draftMode === 'standard') draft = triageCheckDraft(draftRaw, decision, email, data);
  const reasons = decision.reasons.slice();
  if (draft.status === 'holding_reply') reasons.push('draft_blocked');
  if (draft.assistantFlag) reasons.push('draft_assistant_flag');
  const needsHuman = reasons.length > 0;
  const r = {
    source: email.source, messageId: email.messageId, sampleId: email.sampleId, fromDomain: email.fromDomain,
    category: decision.category, priority: decision.priority, urgency: screen.urgency.level, flags,
    sentiment: decision.sentiment, language: decision.language, confidence: decision.confidence, summary: decision.summary,
    needsHuman, reasons, humanReason: reasons.map((c) => TRIAGE_REASON_TEXT[c]).join('; '),
    injectionSuspected: decision.injection, injectionHits: decision.injectionHits,
    draftMode: decision.draftMode, draftStatus: draft.status, draftReply: draft.text, draftProblems: draft.problems,
    kbArticlesUsed: draft.kb, draftConfidence: draft.confidence,
    queue: decision.queue, handoff: decision.handoff, classificationStatus: decision.classificationStatus,
    status: needsHuman ? 'needs_review' : 'sorted',
    alertWanted: decision.priority === 'urgent' && !screen.autoReply,
    receivedAt: ctx.now, latencyMs: ctx.latencyMs || 0, promptVersion: data.rules.promptVersion
  };
  r.alert = triageAlert(r);
  r.labels = triageLabelNames(r);
  r.logRow = triageLogRow(r);
  delete r.alertWanted;
  return r;
}

// The whole pipeline in one call. The n8n nodes run the same functions in the same order.
// modelFn(email) and draftFn(email, decision) stand in for the two model calls; null means "unavailable".
function triageRun(raw, modelFn, draftFn, data, ctx) {
  const email = triageSanitize(raw);
  const screen = triageScreen(email, data, ctx.today);
  const model = triageNormalizeModel(modelFn ? modelFn(email, screen) : null, data);
  const decision = triageDecide(email, screen, model, data);
  const draftRaw = decision.draftMode === 'standard' && draftFn ? draftFn(email, decision) : null;
  return triageFinish({ email, screen, model, decision }, draftRaw, data, { now: ctx.now, latencyMs: 0 });
}

module.exports = {
  TRIAGE_PRIORITIES, TRIAGE_REASON_TEXT, TRIAGE_CATEGORY_LABEL, TRIAGE_QUEUE_BY_CATEGORY, TRIAGE_INJECTION, TRIAGE_DRAFT_RULES,
  triageSanitize, triageGuessLanguage, triageScreen, triageNormalizeModel, triageDecide, triageAckText, triageHoldingText,
  triageCheckDraft, triageFinish, triageRun, triageAlert, triageLabelNames, triageAllLabelNames, triageLogRow,
  triagePrepareGmail, triageCombine, triagePickLabelIds, triageParseJson, triageInjectionHits
};
