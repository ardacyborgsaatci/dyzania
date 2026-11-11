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

test('site has the four expected pages', () => {
  assert.deepStrictEqual([...pages].sort(), ['404.html', 'dashboard.html', 'index.html', 'playground.html']);
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
  for (const file of ['playground.js', 'dashboard.js']) {
    const js = read(file);
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, `${file} must only use textContent`);
  }
});

test('scripts parse', () => {
  for (const file of ['site.js', 'labels.js', 'playground.js', 'dashboard.js']) {
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
