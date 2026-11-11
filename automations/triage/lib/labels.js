'use strict';
// Gmail-facing helpers for the triage workflows: label names, reading a Gmail message, preparing the draft.
// Kept apart from triage.js so the Gmail workflow's Code nodes stay small.
// Pure functions, no I/O. Every top-level name must be unique across the files bundled into n8n.

const TRIAGE_CATEGORY_LABEL = {
  new_inquiry: 'New-Inquiry', existing_client: 'Existing-Client', court_notice: 'Court-Notice', opposing_counsel: 'Opposing-Counsel',
  scheduling: 'Scheduling', billing: 'Billing', spam: 'Spam', other: 'Other'
};
function triageLabelNames(r) {
  const names = ['Triage/' + TRIAGE_CATEGORY_LABEL[r.category], 'Triage/P-' + triageLabelPriority(r.priority)];
  if (r.needsHuman) names.push('Triage/Needs-Human');
  if (r.injectionSuspected) names.push('Triage/Injection-Suspected');
  names.push('Triage/Processed');
  return names;
}

function triageAllLabelNames() {
  const names = ['Triage'];
  Object.keys(TRIAGE_CATEGORY_LABEL).forEach((c) => names.push('Triage/' + TRIAGE_CATEGORY_LABEL[c]));
  ['urgent', 'high', 'normal', 'low'].forEach((p) => names.push('Triage/P-' + triageLabelPriority(p)));
  return names.concat(['Triage/Needs-Human', 'Triage/Injection-Suspected', 'Triage/Processed']);
}


function triageLabelPriority(p) { return p.charAt(0).toUpperCase() + p.slice(1); }

function triagePrepareGmail(m, cfg) {
  const f = m.from && m.from.value && m.from.value[0] ? m.from.value[0] : {};
  const address = String(f.address || '').toLowerCase();
  const name = String(f.name || '').replace(/["<>\r\n]/g, '').trim();
  const hdr = m.headers || {};
  const routedTo = [m.to && m.to.text, hdr['delivered-to'], hdr['x-original-to']].map((x) => String(x || '')).join(' ').toLowerCase();
  const forAlias = routedTo.indexOf(cfg.alias.toLowerCase()) >= 0 && address !== '';
  const text = typeof m.text === 'string' ? m.text : '';
  const body = text.trim() ? text : String(m.html || '');
  const source = address === cfg.owner.toLowerCase() ? 'seed' : 'gmail';
  return { forAlias, source, sampleId: source === 'seed' ? 'seed' : '', messageId: 'gm-' + m.id, gmailId: m.id, threadId: m.threadId || m.id, fromAddress: address, from: name ? name + ' <' + address + '>' : address, subject: String(m.subject || ''), body };
}

// Adds what Gmail needs to the result: ids for the thread, the subject of the draft, whether to create one.
function triageCombine(result, prep) {
  const base = String(prep.subject || '').replace(/^\s*((re|aw|sv|fwd?)\s*:\s*)+/i, '').trim() || '(no subject)';
  const hasDraft = typeof result.draftReply === 'string' && result.draftReply.trim() !== '' && Boolean(prep.fromAddress);
  return Object.assign({}, result, { gmailId: prep.gmailId, threadId: prep.threadId, fromAddress: prep.fromAddress, draftSubject: 'Re: ' + base, hasDraft });
}

function triagePickLabelIds(labelItems, results) {
  const byName = {};
  labelItems.forEach((l) => { if (l && l.name && l.id) byName[l.name] = l.id; });
  const missing = [];
  const out = results.map((r) => {
    const ids = [];
    r.labels.forEach((n) => { if (byName[n]) ids.push(byName[n]); else if (missing.indexOf(n) < 0) missing.push(n); });
    return { gmailId: r.gmailId, labelIds: ids, alertSend: r.alert.send, alertSubject: r.alert.subject, alertText: r.alert.text };
  });
  if (missing.length > 0) throw new Error('Missing Gmail labels: ' + missing.join(', ') + '. Run the Create Triage Labels branch once.');
  return out;
}

module.exports = { TRIAGE_CATEGORY_LABEL, triageLabelNames, triageAllLabelNames, triagePrepareGmail, triageCombine, triagePickLabelIds };
