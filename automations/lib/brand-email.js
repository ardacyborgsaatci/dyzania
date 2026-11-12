// Brand email: the same words as a plain-text message, in the firm's dark style (design system v2, see brand/tokens.css).
// Pure and dependency-free, so the n8n Code nodes can contain this file as it is.
// Paragraphs are split by blank lines; a block where every line starts with "- " becomes a list.
// Every piece of text is HTML-escaped, so a visitor's words cannot inject markup.

// Design system v2 (brand/tokens.css). Mail clients do not load web fonts, so the heading falls back to Georgia.
const BRAND = { bg: '#0b0b0c', card: '#121214', line: '#26262b', ink: '#f5f3ee', muted: '#a8a6a0', brass: '#d4a94f' };
const SERIF = "'Instrument Serif','Iowan Old Style','Palatino Linotype',Georgia,serif";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function block(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length > 0 && lines.every((l) => l.startsWith('- '))) {
    const items = lines.map((l) => '<li style="margin:0 0 6px">' + esc(l.slice(2)) + '</li>').join('');
    return '<ul style="margin:0 0 16px;padding-left:20px;color:' + BRAND.ink + '">' + items + '</ul>';
  }
  return '<p style="margin:0 0 16px;color:' + BRAND.ink + '">' + lines.map(esc).join('<br>') + '</p>';
}

// text: the message as plain text. title (optional): a heading shown above it. Returns a complete HTML document.
function brandEmailHtml(text, title) {
  const blocks = String(text == null ? '' : text)
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== '');
  const heading = title
    ? '<tr><td style="padding:28px 28px 0"><h1 style="margin:0 0 4px;font-family:' + SERIF + ';font-size:26px;font-weight:400;line-height:1.2;color:' + BRAND.ink + '">' + esc(title) + '</h1></td></tr>'
    : '';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="margin:0;padding:24px 16px;background:' + BRAND.bg + ';font-family:Inter,\'Helvetica Neue\',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + BRAND.bg + '"><tr><td align="center">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:' + BRAND.card + ';border:1px solid ' + BRAND.line + ';border-radius:12px">'
    + '<tr><td style="padding:22px 28px;border-bottom:1px solid ' + BRAND.line + '"><span style="font-family:' + SERIF + ';font-size:22px;color:' + BRAND.ink + '">Dyzania LLP</span>'
    + '<span style="display:block;width:28px;height:2px;margin-top:10px;background:' + BRAND.brass + ';font-size:0;line-height:0">&nbsp;</span></td></tr>'
    + heading
    + '<tr><td style="padding:' + (title ? '14px' : '28px') + ' 28px 10px">' + blocks.map(block).join('') + '</td></tr>'
    + '<tr><td style="padding:18px 28px 26px;border-top:1px solid ' + BRAND.line + ';color:' + BRAND.muted + ';font-size:13px">'
    + 'Sent automatically by the Dyzania LLP systems. Please do not reply to this message.</td></tr>'
    + '</table></td></tr></table></body></html>';
}

module.exports = { brandEmailHtml, esc };
