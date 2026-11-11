'use strict';
// Runs the exported n8n Code-node snippets against fake inputs, so the multi-file behaviour is tested without n8n.
const test = require('node:test');
const assert = require('node:assert');
const wf = require('../../workflow.json');
const code = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('Build Vision Request makes one request per image and skips non-images', async () => {
  const png = (n) => ({ mimeType: 'image/png', fileName: n });
  const items = [{ json: {}, binary: { invoice_0: png('I01.png'), invoice_1: png('I02.png'), invoice_2: { mimeType: 'application/pdf', fileName: 'x.pdf' } } }];
  const fn = new AsyncFunction('$input', code('Build Vision Request'));
  const out = await fn.call({ helpers: { getBinaryDataBuffer: async () => Buffer.from('x') } }, { all: () => items });
  assert.deepStrictEqual(out.map((o) => o.json.fileName), ['I01.png', 'I02.png']);
  assert.match(out[0].json.requestBody.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
});

test('Build Vision Request fails loudly when nothing is an image', async () => {
  const fn = new AsyncFunction('$input', code('Build Vision Request'));
  await assert.rejects(fn.call({ helpers: {} }, { all: () => [{ json: {}, binary: {} }] }), /No PNG or JPG/);
});

test('Parse reads every item, tags the file name and flags bad ones', async () => {
  const reply = (o) => ({ json: { choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] } });
  const good = { vendor: 'A', invoiceNumber: '1', invoiceDate: '2026-10-01', currency: 'USD', subtotal: 10, tax: 1, total: 11, confidence: 0.95 };
  const items = [reply(good), reply({ ...good, total: 20 }), reply('not json'), { json: { error: 'rate limited' } }];
  const names = ['a.png', 'b.png', 'c.png', 'd.png'];
  const $ = () => ({ itemMatching: (i) => ({ json: { fileName: names[i] } }) });
  const fn = new AsyncFunction('$input', '$', code('Parse and Validate Invoice'));
  const out = (await fn({ all: () => items }, $)).map((o) => o.json);
  assert.deepStrictEqual(out.map((o) => o.fileName), names);
  assert.deepStrictEqual(out.map((o) => o.status), ['Auto-approved', 'Needs review', 'Needs review', 'Needs review']);
  assert.match(out[1].issues, /does not equal total/);
});

test('sheet write fills the misspelled processedAt header and the form accepts several files', () => {
  const sheet = wf.nodes.find((n) => n.name === 'Save to Google Sheet').parameters.columns;
  assert.strictEqual(sheet.value.proccesedAt, '={{ $json.processedAt }}');
  assert.strictEqual(wf.nodes.find((n) => n.name === 'Invoice Upload Form').parameters.formFields.values[0].multipleFiles, true);
});
