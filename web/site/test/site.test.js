// Checks on the static site: pages, links, shared header and footer, forms against the rules they feed, the facts on
// each page against firm/*.json, the ops status list, and the stylesheet. The endpoints are tested in forms-api.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..', '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html')).sort();

const firm = readJson(path.join(repo, 'firm', 'firm.json'));
const areasFile = readJson(path.join(repo, 'firm', 'practice-areas.json'));
const areaIds = areasFile.areas.map((a) => a.id);
const staff = Object.fromEntries(firm.staff.map((s) => [s.id, s]));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const idsIn = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

function resolveLocal(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return path.join(root, 'index.html');
  const file = path.join(root, clean);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  return path.join(root, `${clean}.html`);
}

test('site has the expected pages', () => {
  assert.deepStrictEqual(pages, ['404.html', 'book.html', 'call.html', 'contact.html', 'index.html', 'ops.html', 'practice-areas.html', 'privacy.html']);
});

for (const page of pages) {
  const html = read(page);

  test(`${page}: has language, title, description, noindex, one h1 and one main`, () => {
    assert.match(html, /<html lang="en"[\s>]/);
    const title = html.match(/<title>([^<]+)<\/title>/);
    assert.ok(title, 'no title');
    assert.ok(title[1] === 'Dyzania LLP' || title[1].endsWith(' | Dyzania LLP'), `title is ${title[1]}`);
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1);
    assert.strictEqual((html.match(/<main[\s>]/g) || []).length, 1);
    assert.match(html, /<a class="skip" href="#main">/);
  });

  test(`${page}: internal links, anchors and scripts exist; no inline handlers`, () => {
    const targets = [...html.matchAll(/(?:href|src)="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((t) => t && !t.startsWith('#') && !/^(https?:|mailto:|tel:|data:)/.test(t));
    for (const target of targets) {
      assert.ok(fs.existsSync(resolveLocal(target)), `${page} links to missing ${target}`);
      const hash = target.split('#')[1];
      if (hash) assert.ok(idsIn(read(path.basename(resolveLocal(target)))).includes(hash), `${page} links to missing section #${hash}`);
    }
    const ids = idsIn(html);
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), `${page} links to missing #${id}`);
    assert.doesNotMatch(html, /\son[a-z]+="/i);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, `${page} has an inline script`);
  });

  test(`${page}: ids are unique and every field has a label`, () => {
    const ids = idsIn(html);
    assert.strictEqual(new Set(ids).size, ids.length, `${page} repeats an id`);
    // A choice that sits inside its own label (the area picker) needs no id.
    const unwrapped = html.replace(/<label\b(?![^>]*\sfor=)[^>]*>[\s\S]*?<\/label>/g, '');
    for (const [, tag, attrs] of unwrapped.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      if (/type="hidden"/.test(attrs)) continue;
      const id = (attrs.match(/\sid="([^"]+)"/) || [])[1];
      assert.ok(id, `${page}: a ${tag} has no id`);
      assert.ok(new RegExp(`for="${id}"`).test(html) || /aria-label=/.test(attrs), `${page}: ${id} has no label`);
    }
    for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) assert.match(tag, /\salt="/, `${page} has an image without alt`);
  });

  test(`${page}: a form that holds personal details never sends it in the address`, () => {
    for (const [, attrs, body] of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
      if (/type="(text|email|tel)"|<textarea/.test(body)) assert.match(attrs, /method="post"/, `${page}: a form with personal fields must use POST`);
    }
  });
}

test('header and footer are the same on every page, apart from the current page marker', () => {
  const header = (html) => html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0].replace(' aria-current="page"', '');
  const footer = (html) => html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  const first = read(pages[0]);
  for (const page of pages) {
    const html = read(page);
    assert.strictEqual(header(html), header(first), `${page} header differs`);
    assert.strictEqual(footer(html), footer(first), `${page} footer differs`);
  }
  for (const [href] of [['/practice-areas'], ['/contact'], ['/call'], ['/ops']]) {
    const page = href.slice(1) + '.html';
    assert.match(read(page), new RegExp(`<a href="${href}" aria-current="page">`), `${page} does not mark itself current`);
  }
});

test('the footer carries the firm facts and every disclaimer, spelled as in firm.json', () => {
  const footer = read('index.html').match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  assert.ok(footer.includes(esc(firm.address)));
  assert.ok(footer.includes(firm.phone));
  assert.ok(footer.includes('Monday to Friday, 8:30 AM to 5:30 PM'));
  assert.ok(footer.includes(firm.emails.general));
  assert.ok(footer.includes(firm.emails.privacy));
  for (const key of ['notLegalAdvice', 'noConfidential', 'emergency', 'fictional']) assert.ok(footer.includes(esc(firm.language[key])), `footer lacks ${key}`);
  assert.deepStrictEqual(firm.officeHours, { days: ['mon', 'tue', 'wed', 'thu', 'fri'], open: '08:30', close: '17:30' });
});

test('every email and phone number on the site is one of the firm\'s own', () => {
  const emails = new Set(Object.values(firm.emails));
  const phone = firm.phone;
  for (const page of pages) {
    const html = read(page);
    for (const [, address] of html.matchAll(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi)) assert.ok(emails.has(address), `${page} shows ${address}`);
    for (const [, number] of html.matchAll(/\b(\d{3}-\d{4})\b/g)) assert.strictEqual(number, phone, `${page} shows ${number}`);
    for (const [, href] of html.matchAll(/href="tel:(\d+)"/g)) assert.strictEqual(href, phone.replace(/\D/g, ''));
  }
});

test('practice areas page shows each area\'s facts from firm data, and the pages that link to it use real ids', () => {
  const html = read('practice-areas.html');
  const body = text(html);
  for (const a of areasFile.areas) {
    assert.ok(idsIn(html).includes(a.id), `no section for ${a.id}`);
    const section = html.match(new RegExp(`<article class="card" id="${a.id}"[\\s\\S]*?</article>`))[0];
    const t = text(section);
    assert.ok(t.includes(a.name) && t.includes(a.summary), `${a.id}: name or summary`);
    assert.ok(t.includes(`${a.consult.minutes} minutes`), `${a.id}: minutes`);
    if (a.consult.feeUsd) {
      assert.ok(t.includes(`$${a.consult.feeUsd} for this first consultation`), `${a.id}: fee`);
      assert.strictEqual(a.consult.creditedToRetainer, true);
      assert.ok(t.includes('credited toward the retainer if you hire the firm'));
    } else {
      assert.ok(t.includes('No charge for this first consultation.'), `${a.id}: no-charge wording`);
    }
    if (a.feeModel === 'contingency') assert.ok(t.includes('no attorney fee unless there is a recovery') && t.includes('engagement letter'), `${a.id}: contingency wording`);
    else assert.doesNotMatch(t, /contingency/i, `${a.id} must not mention contingency`);
    for (const id of a.attorneys) assert.ok(t.includes(staff[id].name), `${a.id}: attorney ${id}`);
    for (const item of a.bring) assert.ok(t.includes(item), `${a.id}: bring "${item}"`);
    assert.ok(html.includes(`href="/book?area=${a.id}"`), `${a.id}: no booking link`);
  }
  for (const o of areasFile.outOfScope) assert.ok(body.includes(o.name), `out-of-scope ${o.id} not listed`);
  assert.ok(body.includes(areasFile.referralNote));
  for (const page of pages) {
    for (const [, id] of read(page).matchAll(/href="\/(?:practice-areas#|book\?area=)([a-z]+)"/g)) assert.ok(areaIds.includes(id), `${page} links to unknown area ${id}`);
  }
});

test('home page names the four areas, the attorneys and the office facts', () => {
  const body = text(read('index.html'));
  for (const a of areasFile.areas) assert.ok(body.includes(a.name) && body.includes(a.summary));
  for (const id of ['dana-hollis', 'marcus-marr', 'elena-voss', 'tomas-reyes']) assert.ok(body.includes(staff[id].name));
  assert.ok(body.includes(firm.address) && body.includes(firm.phone));
  assert.ok(body.includes(firm.tagline));
  assert.ok(body.includes(`firm of ${firm.headcount.total} people`));
  assert.ok(body.includes(firm.language.fictional));
});

test('the booking page offers exactly the practice areas, with the consultation length and fee the booking rules use', () => {
  const html = read('book.html');
  const block = html.match(/<form id="area-form"[\s\S]*?<\/form>/)[0];
  assert.deepStrictEqual([...block.matchAll(/<input type="radio" name="area" value="([^"]+)"/g)].map((m) => m[1]), areaIds);
  for (const a of areasFile.areas) {
    const meta = `${a.consult.minutes} minutes · ${a.consult.feeUsd ? '$' + a.consult.feeUsd + ', credited to your retainer' : 'no charge'}`;
    assert.ok(block.includes(meta), `${a.id}: ${meta}`);
  }
  for (const id of ['step-area', 'step-time', 'step-details', 'result', 'progress']) assert.ok(idsIn(html).includes(id));
  assert.strictEqual((html.match(/<li><span class="n"/g) || []).length, 3);
});

test('the contact form offers the values the intake rules accept', () => {
  const { INTAKE_OPTIONS } = require('../../../automations/intake/lib/intake');
  const html = read('contact.html');
  const optionsOf = (id) => {
    const block = html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0];
    return [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  };
  assert.deepStrictEqual(optionsOf('area').sort(), [...areaIds, 'not_sure', 'other'].sort());
  assert.deepStrictEqual(optionsOf('location').filter(Boolean), INTAKE_OPTIONS.location);
  assert.deepStrictEqual(optionsOf('hearing').filter(Boolean), INTAKE_OPTIONS.hearing);
  assert.deepStrictEqual(optionsOf('howHeard'), INTAKE_OPTIONS.howHeard);
  assert.deepStrictEqual([...html.matchAll(/name="preferredContact" value="([^"]+)"/g)].map((m) => m[1]), INTAKE_OPTIONS.preferredContact);
  for (const field of ['name', 'email', 'phone', 'area', 'description', 'location', 'hearing', 'incidentDate', 'otherSide', 'howHeard', 'consent', 'website', 'preferredContact']) {
    assert.match(html, new RegExp(`name="${field}"`), `field ${field} is missing`);
  }
  // A person must be able to see that the honeypot is not for them, and keyboard and screen reader users must skip it.
  assert.match(html, /<div class="honey" aria-hidden="true">[\s\S]*?name="website"[^>]*tabindex="-1"/);
});

test('the booking details form has the fields the booking endpoint reads', () => {
  const html = read('book.html');
  for (const field of ['name', 'email', 'phone', 'otherSide', 'noOtherSide', 'consent', 'website']) assert.match(html, new RegExp(`name="${field}"`), `field ${field} is missing`);
  assert.match(html, /<div class="honey" aria-hidden="true">[\s\S]*?name="website"[^>]*tabindex="-1"/);
});

const scripts = ['form-kit.js', 'contact.js', 'book.js', 'ops.js', 'call.js'];

test('scripts parse and are each used by a page; the form pages load the kit first', () => {
  for (const file of scripts) assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} has a syntax error`);
  const used = new Set();
  for (const page of pages) for (const [, src] of read(page).matchAll(/<script src="\/([^"]+)"/g)) used.add(src);
  assert.deepStrictEqual([...used].sort(), [...scripts].sort());
  for (const page of ['contact.html', 'book.html']) {
    const order = [...read(page).matchAll(/<script src="\/([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(order[0], 'form-kit.js', `${page} must load the kit first`);
  }
});

test('page scripts are only written with text, never as HTML', () => {
  for (const file of scripts) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, `${file} must only use textContent`);
  }
});

test('every element a script looks up by id exists on its page', () => {
  const mapping = { 'contact.js': 'contact.html', 'book.js': 'book.html', 'ops.js': 'ops.html', 'call.js': 'call.html' };
  for (const [script, page] of Object.entries(mapping)) {
    const ids = new Set(idsIn(read(page)));
    for (const [, id] of read(script).matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(ids.has(id), `${script} looks for #${id}, which ${page} lacks`);
    // Ids built at run time: the per-field checks.
  }
  const contactChecks = ['name', 'email', 'phone', 'area', 'description', 'location', 'hearing', 'incidentDate', 'otherSide', 'howHeard', 'consent'];
  const bookChecks = ['name', 'email', 'phone', 'otherSide', 'consent'];
  const contactIds = new Set(idsIn(read('contact.html')));
  const bookIds = new Set(idsIn(read('book.html')));
  for (const id of contactChecks) { assert.ok(contactIds.has(id), `contact.html lacks #${id}`); assert.match(read('contact.js'), new RegExp(`\\b${id}: function`)); }
  for (const id of bookChecks) { assert.ok(bookIds.has(id), `book.html lacks #${id}`); assert.match(read('book.js'), new RegExp(`\\b${id}: function`)); }
});

test('client checks use the same name and email rules as the server', () => {
  const server = fs.readFileSync(path.join(repo, 'automations', 'intake', 'lib', 'intake.js'), 'utf8');
  const nameRule = "/^[\\p{L}\\p{M}0-9 .,'’-]+$/u";
  const emailRule = '/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/';
  for (const source of [server, read('contact.js'), read('book.js')]) {
    assert.ok(source.includes(nameRule), 'name rule differs');
    assert.ok(source.includes(emailRule), 'email rule differs');
  }
});

test('the voice page only loads a server over https, or the local one', () => {
  const site = readJson(path.join(root, 'data', 'site.json'));
  assert.ok(site.voiceUrl === '' || /^https:\/\//.test(site.voiceUrl), 'voiceUrl must be empty or https');
  const js = read('call.js');
  assert.match(js, /\^https:/);
  assert.match(js, /localhost:8000/);
});

test('ops status list is well formed, matches the evidence files, and does not overclaim', () => {
  const data = readJson(path.join(root, 'data', 'status.json'));
  assert.match(data.verified, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepStrictEqual(data.automations.map((a) => a.id), ['intake', 'triage', 'booking', 'notices', 'voice']);
  for (const a of data.automations) {
    for (const key of ['team', 'name', 'state', 'stateLabel', 'what', 'evidence', 'limit', 'next']) assert.ok(typeof a[key] === 'string' && a[key], `${a.id} lacks ${key}`);
    assert.ok(['built', 'running', 'paused', 'building'].includes(a.state), `${a.id}: unknown state ${a.state}`);
    if (a.state === 'built') assert.match(a.stateLabel, /^Built, (not live yet|runs locally)$/, `${a.id}: a built-only automation must say it is not live`);
    for (const [label, href] of a.links || []) { assert.ok(label && fs.existsSync(resolveLocal(href)), `${a.id} links to missing ${href}`); }
  }
  assert.ok(Array.isArray(data.linksToday) && data.linksToday.length > 0 && Array.isArray(data.linksLater) && data.linksLater.length > 0);
  assert.strictEqual(data.rules.length, 5);
  for (const rule of data.rules) assert.strictEqual(rule.length, 2);

  // The numbers quoted on the page are the sizes of the case files they come from.
  const count = {
    intake: readJson(path.join(repo, 'automations', 'intake', 'eval', 'cases.json')).cases.length,
    booking: readJson(path.join(repo, 'automations', 'booking', 'eval', 'cases.json')).cases.length,
    notices: readJson(path.join(repo, 'automations', 'notices', 'eval', 'notices.json')).cases.length,
    triage: readJson(path.join(repo, 'automations', 'triage', 'eval', 'emails.json')).emails.length,
    voice: readJson(path.join(repo, 'voice', 'questions.json')).questions.length,
  };
  const evidence = Object.fromEntries(data.automations.map((a) => [a.id, a.evidence]));
  assert.ok(evidence.intake.includes(`${count.intake} invented leads, ${count.intake} of ${count.intake}`));
  assert.ok(evidence.booking.includes(`${count.booking} invented cases, ${count.booking} of ${count.booking}`));
  assert.ok(evidence.notices.includes(`${count.notices} invented notices`));
  assert.ok(evidence.triage.includes(`${count.triage} invented emails`) && evidence.triage.includes(`${count.triage} of ${count.triage}`));
  assert.ok(evidence.voice.includes(`${count.voice} invented questions`));
});

test('no page, script or data file still speaks for the old Wrenbook company, and none makes an outcome claim', () => {
  const files = [...pages, ...scripts, 'data/status.json', 'data/site.json', 'package.json', 'vercel.json'];
  for (const file of files) {
    const body = read(file);
    assert.doesNotMatch(body, /wrenbook/i, `${file} mentions Wrenbook`);
    assert.doesNotMatch(body, /testimonial|\bwe will win\b|(?<!whether )\byou (?:have|do not have) a (?:strong |good |valid )?case\b|guaranteed? (?:result|outcome|recovery|win)|\bbest (?:lawyer|attorney)s?\b|free case evaluation/i, `${file} makes a claim the firm may not make`);
  }
});

test('vercel config keeps clean URLs and gives the three form functions time to reach n8n', () => {
  const config = readJson(path.join(root, 'vercel.json'));
  assert.strictEqual(config.cleanUrls, true);
  for (const fn of ['api/intake.js', 'api/slots.js', 'api/book.js']) assert.ok(config.functions[fn].maxDuration >= 30, `${fn} needs a longer limit`);
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'api')).sort(), ['book.js', 'intake.js', 'slots.js', 'token.js']);
});

test('stylesheet uses the brand tokens, no gradients, and the focus, motion and spacing rules', () => {
  const css = read('styles.css');
  const brand = fs.readFileSync(path.join(repo, 'brand', 'tokens.css'), 'utf8').toLowerCase();
  for (const hex of ['#0b0b0c', '#121214', '#a8a6a0', '#d4a94f']) {
    assert.ok(css.toLowerCase().includes(hex), `styles.css lacks brand colour ${hex}`);
    assert.ok(brand.includes(hex), `brand tokens lack ${hex}`);
  }
  assert.doesNotMatch(css, /gradient\(/i);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /scroll-padding-top/);
  assert.match(css, /\.btn \{[^}]*min-height: 48px/);
  assert.match(css, /\.nav a \{[^}]*min-height: 44px/);
});

test('text and boundary pairs on the dark theme meet WCAG contrast', () => {
  const css = read('styles.css');
  const token = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(m, `token --${name} not found`);
    return m[1];
  };
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const text = [
    ['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface-2'], ['ink', 'card'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'card'],
    ['accent-ink', 'accent'], ['accent', 'bg'], ['accent', 'surface'], ['accent', 'card'],
    ['warn', 'warn-soft'], ['danger', 'danger-soft'], ['info', 'info-soft'], ['ink', 'warn-soft'], ['ink', 'danger-soft'], ['ink', 'info-soft'],
    ['danger', 'bg'], ['danger', 'surface'], ['danger', 'surface-2'], ['info', 'bg'],
  ];
  for (const [fg, bg] of text) assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg}: ${ratio(token(fg), token(bg)).toFixed(2)}`);
  // Edges of fields and choices need 3:1 against what they sit on.
  for (const bg of ['bg', 'surface', 'surface-2']) assert.ok(ratio(token('edge'), token(bg)) >= 3, `edge on ${bg}: ${ratio(token('edge'), token(bg)).toFixed(2)}`);
  assert.ok(ratio('#ffffff', token('bg')) >= 4.5);
});
