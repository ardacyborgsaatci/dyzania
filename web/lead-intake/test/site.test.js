const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const index = read('index.html');
const ids = new Set([...index.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function resolveLocal(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (clean === '' || clean === '/') return path.join(root, 'index.html');
  const file = path.join(root, clean);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  return path.join(root, `${clean}.html`);
}

test('site is one page plus privacy and 404', () => {
  assert.deepStrictEqual([...pages].sort(), ['404.html', 'index.html', 'privacy.html']);
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
      .filter((t) => t && !/^(https?:|mailto:|data:)/.test(t));
    for (const target of targets) {
      if (target.startsWith('#')) continue; // in-page links are checked in their own test
      assert.ok(fs.existsSync(resolveLocal(target.startsWith('/') ? target : `/${target}`)), `${page} links to missing ${target}`);
      const hash = target.split('#')[1];
      if (hash) assert.ok(ids.has(hash), `${page} links to missing section #${hash}`);
    }
  });
}

test('every in-page link on the home page points at a section that exists', () => {
  for (const [, id] of index.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.has(id), `index.html links to missing #${id}`);
  }
});

test('redirects from the old pages land on real sections', () => {
  const { redirects } = JSON.parse(read('vercel.json'));
  assert.ok(redirects.length >= 4);
  for (const { destination } of redirects) {
    const hash = destination.split('#')[1];
    assert.ok(hash && ids.has(hash), `redirect to #${hash} has no matching section`);
  }
});

test('icons named on the page are on disk', () => {
  const names = [...index.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]);
  const diagram = [...index.matchAll(/"icon":"([^"]+)"/g)].map((m) => m[1].replace(':', '-'));
  for (const name of new Set([...names, ...diagram])) {
    assert.ok(fs.existsSync(path.join(root, 'assets', 'icons', `${name}.svg`)), `icon ${name}.svg is missing`);
  }
});

test('lead form keeps the field names the API expects', () => {
  for (const field of ['name', 'email', 'company', 'companySize', 'budget', 'timeline', 'message', 'website', 'consent']) {
    assert.match(index, new RegExp(`name="${field}"`), `form field ${field} is missing`);
  }
  assert.match(index, /action="\/api\/lead"/);
});

test('form dropdown values match the API validation', () => {
  const { OPTIONS } = require('../lib/validate');
  for (const [field, values] of Object.entries(OPTIONS)) {
    const select = index.match(new RegExp(`<select id="${field}"[\\s\\S]*?</select>`))[0];
    const options = [...select.matchAll(/<option value="([^"]+)"[^>]*>/g)].map((m) => m[1]).filter(Boolean);
    assert.deepStrictEqual(options, values, `${field} options differ from validate.js`);
  }
});
