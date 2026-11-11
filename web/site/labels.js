// Display names shared by the playground and the dashboard.
window.TriageLabels = {
  category: {
    billing: 'Billing', bug_report: 'Bug report', account_access: 'Account access', feature_request: 'Feature request',
    sales_inquiry: 'Sales inquiry', how_to: 'How-to', spam: 'Spam', other: 'Other',
  },
  priority: { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' },
  sentiment: { positive: 'Positive', neutral: 'Neutral', negative: 'Negative', angry: 'Angry' },
  skip: {
    spam: 'Spam gets no draft.',
    injection: 'Possible prompt injection: no draft was written and a person should look at this email.',
    auto_reply: 'Automatic replies get no draft.',
  },
  languages: { en: 'English', es: 'Spanish', de: 'German', fr: 'French', pt: 'Portuguese', it: 'Italian', nl: 'Dutch' },
  label: function (group, key) {
    const map = this[group] || {};
    return map[key] || String(key || '').replace(/_/g, ' ');
  },
};
