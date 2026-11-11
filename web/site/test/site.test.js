const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function resolveLocal(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return path.join(root, 'index.html');
  const file = path.join(root, clean);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  return path.join(root, `${clean}.html`);
}

test('site has the expected pages', () => {
  assert.deepStrictEqual([...pages].sort(), ['404.html', 'call.html', 'dashboard.html', 'index.html', 'ops.html', 'playground.html', 'privacy.html']);
});

for (const page of pages) {
  const html = read(page);

  test(`${page}: has language, title, description and one h1`, () => {
    assert.match(html, /<html lang="en"[\s>]/);
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1);
  });

  test(`${page}: internal links and assets exist`, () => {
    const targets = [...html.matchAll(/(?:href|src)="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((t) => t && !t.startsWith('#') && !/^(https?:|mailto:|data:)/.test(t));
    for (const target of targets) {
      assert.ok(fs.existsSync(resolveLocal(target)), `${page} links to missing ${target}`);
      const hash = target.split('#')[1];
      if (hash) {
        const ids = new Set([...read(path.basename(resolveLocal(target))).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
        assert.ok(ids.has(hash), `${page} links to missing section #${hash}`);
      }
    }
  });

  test(`${page}: in-page links point at real ids, and there are no inline handlers`, () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), `${page} links to missing #${id}`);
    assert.doesNotMatch(html, /\son[a-z]+="/i);
  });
}

test('playground form keeps the field names the API expects', () => {
  const html = read('playground.html');
  for (const field of ['name', 'subject', 'body', 'website']) assert.match(html, new RegExp(`name="${field}"`), `field ${field} is missing`);
});

test('model output is never written as HTML', () => {
  for (const file of ['playground.js', 'dashboard.js', 'ops.js']) {
    const js = read(file);
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, `${file} must only use textContent`);
  }
});

test('scripts parse', () => {
  for (const file of ['contact.js', 'labels.js', 'playground.js', 'dashboard.js', 'ops.js']) {
    assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} has a syntax error`);
  }
});

test('preset samples are well formed and match what the server accepts', () => {
  const samples = JSON.parse(read('data/samples.json'));
  assert.strictEqual(samples.length, 8);
  assert.strictEqual(new Set(samples.map((s) => s.id)).size, 8);
  for (const s of samples) {
    for (const key of ['id', 'label', 'from', 'subject', 'body']) assert.ok(typeof s[key] === 'string' && s[key], `${s.id} lacks ${key}`);
    assert.ok(s.body.length <= 4000);
  }
});

test('evaluation results, when present, have the fields the pages read', () => {
  const file = path.join(root, 'data', 'eval-results.json');
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['categoryAccuracy', 'needsHumanRecall', 'injectionRecall', 'medianLatencyMs', 'perCategory', 'confusion', 'promptVersion', 'total']) {
    assert.ok(data[key] !== undefined, `eval-results.json lacks ${key}`);
  }
  assert.strictEqual(data.confusion.matrix.length, data.confusion.labels.length);
});

test('vercel config keeps clean URLs and a long timeout for the triage function', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.strictEqual(config.cleanUrls, true);
  assert.ok(config.functions['api/triage.js'].maxDuration >= 30);
});

test('home form keeps the field names and dropdown values the lead API expects', () => {
  const { OPTIONS } = require('../lib/lead-validate');
  const html = read('index.html');
  for (const field of ['name', 'email', 'company', 'companySize', 'budget', 'timeline', 'message', 'consent', 'website']) {
    assert.match(html, new RegExp(`name="${field}"`), `field ${field} is missing`);
  }
  for (const [field, values] of Object.entries(OPTIONS)) {
    const block = html.match(new RegExp(`<select id="${field}"[\\s\\S]*?</select>`))[0];
    const found = [...block.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
    assert.deepStrictEqual(found, values, `${field} options differ from the API`);
  }
});

test('ops status list is well formed and does not overclaim', () => {
  const data = JSON.parse(read('data/status.json'));
  assert.match(data.verified, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepStrictEqual(data.automations.map((a) => a.id), ['leads', 'booking', 'support', 'voice', 'invoices']);
  for (const a of data.automations) {
    for (const key of ['team', 'name', 'state', 'stateLabel', 'what', 'evidence', 'next']) assert.ok(typeof a[key] === 'string' && a[key], `${a.id} lacks ${key}`);
    assert.ok(['running', 'building', 'paused'].includes(a.state));
    for (const [, href] of a.links || []) assert.ok(fs.existsSync(resolveLocal(href)), `${a.id} links to missing ${href}`);
  }
  // Automations that are not finished must say so in their own card.
  for (const id of ['booking', 'invoices']) assert.strictEqual(data.automations.find((a) => a.id === id).state, 'building');
});

test('stylesheet uses the Wrenbook brand tokens and no gradients', () => {
  const css = read('styles.css');
  const brand = fs.readFileSync(path.join(root, '..', '..', 'brand', 'tokens.css'), 'utf8').toLowerCase();
  for (const hex of ['#12343b', '#fbf7f0', '#e6dfd2', '#3f5a5f']) {
    assert.ok(css.toLowerCase().includes(hex), `styles.css lacks brand colour ${hex}`);
    assert.ok(brand.includes(hex), `brand tokens lack ${hex}`);
  }
  assert.doesNotMatch(css, /gradient\(/i);
});

test('light-theme text pairs meet WCAG AA contrast', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pairs = [
    ['ink on canvas', '#12343b', '#fbf7f0'], ['muted on canvas', '#3f5a5f', '#fbf7f0'], ['white on ink button', '#ffffff', '#12343b'],
    ['ink on white card', '#12343b', '#ffffff'], ['warn on warn-soft', '#8a5a00', '#fcefd5'], ['danger on danger-soft', '#b3261e', '#fbe4e1'],
    ['info on info-soft', '#2f5f4c', '#e1eee7'], ['ink on wren', '#12343b', '#e08a2b'], ['danger on canvas', '#b3261e', '#fbf7f0'],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
});

test('every page links the voice and ops pages from the nav', () => {
  for (const page of ['index.html', 'ops.html', 'playground.html', 'dashboard.html', 'call.html']) {
    const html = read(page);
    assert.match(html, /href="\/ops"/);
    assert.match(html, /href="\/call"/);
  }
});
