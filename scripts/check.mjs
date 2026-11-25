// Checks the site: HTML structure, internal links and anchors, allowed outside links, the one allowed e-mail
// address, words that promise more than the app can, files loaded from elsewhere, and text contrast.
// No dependencies. Usage: node scripts/check.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const PAGES = ['index.html', 'privacy.html', 'support.html'];
const EMAIL = 'appfab.apps@outlook.com';
// The only addresses a page may link to. A page never loads anything from them.
const OUTSIDE = new Set([
  'https://github.com/appfab-apps/solpath/issues',
  'https://www.geonames.org/',
  'https://creativecommons.org/licenses/by/4.0/',
  'https://support.apple.com/en-us/108770',
  'https://www.apple.com/legal/privacy/data/en/location-services/',
  'https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection',
  'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
]);
// No claim about how exact the compass or the camera is, in words or in numbers.
const CLAIMS = [
  /\bexact(?:ly|ness)?\b/i,
  /\bprecis(?:e|ely|ion)\b/i,
  /\bpinpoint\w*/i,
  /\b(?:in)?accura(?:te|tely|cy)\b/i,
  /\b(?:perfect|flawless|guarantee)\w*/i,
  /\d\s*(?:°|degrees?\b)/i,
  /[±]\s*\d/,
  /\bwithin\s+\d/i,
];
// Not in the store yet; the release round lifts this.
const STORE = [/app\s*store/i, /available (?:now|today)/i, /\bdownload\b/i, /apps\.apple\.com/i];
const VOID = new Set(['meta', 'link', 'br', 'img', 'hr', 'source']);
// What the pages are made of. Anything that can run, submit, embed or play is not on the list.
const TAGS = new Set(
  'html head meta title link body div header nav main section footer a ul li h1 h2 p span em strong br dl dt dd svg g path circle text'.split(' '),
);
const ATTRIBUTES = new Set(
  ('lang charset name content rel href type class id aria-label aria-current role ' +
    'viewbox d cx cy r x y fill stroke stroke-width stroke-linecap stroke-linejoin text-anchor').split(' '),
);

const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);
const files = readdirSync('.', { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => normalize(join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .filter((file) => !file.startsWith('.git/'));
const has = (file) => files.includes(file);
const read = (file) => readFileSync(file, 'utf8');

// Only site files belong here.
const ALLOWED_FILES =
  /^(?:(?:index|privacy|support)\.html|style\.css|mark\.svg|README\.md|\.nojekyll|\.gitattributes|scripts\/check\.mjs|\.github\/workflows\/kontrol\.yml|fonts\/[\w-]+\.(?:ttf|txt))$/;
for (const file of files) if (!ALLOWED_FILES.test(file)) fail(file, 'is not a site file');
for (const page of PAGES) if (!has(page)) fail(page, 'missing');
for (const font of ['Fraunces', 'InstrumentSans']) {
  if (!has(`fonts/${font}-OFL.txt`) || !read(`fonts/${font}-OFL.txt`).includes('SIL Open Font License, Version 1.1')) fail(`fonts/${font}-OFL.txt`, 'licence missing');
}
for (const file of files.filter((f) => f.endsWith('.ttf'))) if (statSync(file).size > 200_000) fail(file, 'larger than 200 kB');

// E-mail addresses: every text file except the font licences' own contents.
const entities = (text) => text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replaceAll('&commat;', '@').replaceAll('%40', '@');
for (const file of files.filter((f) => !f.endsWith('.ttf'))) {
  for (const [address] of entities(read(file)).matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
    if (address !== EMAIL) fail(file, 'contains an e-mail address other than the support address');
  }
}

const ids = new Map();
for (const page of PAGES.filter(has)) {
  const list = [...read(page).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ids.set(page, new Set(list));
  if (list.length !== ids.get(page).size) fail(page, 'the same id twice');
}

for (const page of PAGES.filter(has)) {
  const html = read(page);
  if (!/^<!doctype html>\n/i.test(html)) fail(page, 'no doctype');
  for (const part of ['<html lang="en">', '<meta charset="utf-8">', 'name="viewport"', 'name="description"', '<title>', '<main>', '<nav aria-label=']) {
    if (!html.includes(part)) fail(page, `missing ${part}`);
  }
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) fail(page, 'needs one h1');
  if (/@@|<!--/.test(html)) fail(page, 'placeholder or comment left in');

  // Structure: known tags and attributes only, all closed in order.
  const open = [];
  for (const [, slash, raw, rest] of html.replace(/^<!doctype html>/i, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*)>/g)) {
    const name = raw.toLowerCase();
    if (!TAGS.has(name)) fail(page, `<${name}> is not allowed`);
    for (const [, attribute] of rest.replace(/"[^"]*"/g, '""').matchAll(/\s([\w:-]+)/g)) {
      if (!ATTRIBUTES.has(attribute.toLowerCase())) fail(page, `attribute ${attribute} is not allowed`);
    }
    if (name === 'meta' && /http-equiv/i.test(rest)) fail(page, 'meta http-equiv is not allowed');
    if (name === 'link') {
      const href = rest.match(/\shref="([^"]*)"/)?.[1] ?? '';
      if (!/\srel="(?:icon|stylesheet)"/.test(rest)) fail(page, 'only an icon and a stylesheet may be linked');
      if (!has(href)) fail(page, `loads ${href}, which is not a file of the site`);
    }
    if (VOID.has(name) || rest.endsWith('/')) continue;
    if (!slash) open.push(name);
    else if (open.pop() !== name) {
      fail(page, `unbalanced </${name}>`);
      break;
    }
  }
  if (open.length) fail(page, `not closed: ${open.join(', ')}`);

  // Links.
  for (const [, href] of html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)) {
    if (OUTSIDE.has(href) || href === `mailto:${EMAIL}`) continue;
    if (/^[\w+.-]+:|^\/|^$/.test(href)) {
      fail(page, `link not allowed: ${href}`);
      continue;
    }
    const [file, anchor] = href.split('#');
    const target = file || page;
    if (!PAGES.includes(target) || !has(target)) fail(page, `broken link ${href}`);
    else if (anchor !== undefined && !ids.get(target)?.has(anchor)) fail(page, `broken anchor ${href}`);
  }

  // Words, over everything a reader or a search engine sees (text, title, description, labels).
  const attributes = [...html.matchAll(/\s(?:content|aria-label)="([^"]*)"/g)].map((m) => m[1]).join('\n');
  const text = `${entities(html.replace(/<[^>]*>/g, ' '))}\n${entities(attributes)}`.replaceAll('&amp;', '&').replace(/\s+/g, ' ');
  for (const pattern of [...CLAIMS, ...STORE]) {
    const hit = text.match(pattern);
    if (hit) fail(page, `word not allowed: "${hit[0]}"`);
  }
}

// Required on the pages.
const required = [
  ['support.html', `mailto:${EMAIL}`],
  ['privacy.html', `mailto:${EMAIL}`],
  ['support.html', 'https://github.com/appfab-apps/solpath/issues'],
  ['support.html', 'Never look directly at the sun'],
  ['index.html', '© GeoNames'],
  ['index.html', 'https://creativecommons.org/licenses/by/4.0/'],
];
for (const [page, part] of required) if (has(page) && !read(page).includes(part)) fail(page, `missing: ${part}`);
if (has('privacy.html') && !/Last changed: \d{1,2} [A-Z][a-z]+ 20\d\d</.test(read('privacy.html'))) fail('privacy.html', 'no date');
if (has('support.html') && read('support.html').indexOf(`mailto:${EMAIL}`) > read('support.html').indexOf('/solpath/issues')) fail('support.html', 'e-mail comes before GitHub Issues');

// Nothing from elsewhere in the stylesheet and the icon.
const css = read('style.css');
if (/@import|https?:|\/\//i.test(css)) fail('style.css', 'loads something from another site');
for (const [, url] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) if (!has(url)) fail('style.css', `missing file ${url}`);
const icon = read('mark.svg').replace('xmlns="http://www.w3.org/2000/svg"', '');
if (/https?:|\/\/|href|<script|<style|\son\w+=/i.test(icon)) fail('mark.svg', 'loads or runs something');

// Contrast of the colours in the stylesheet (WCAG): text 4.5, the rest 3.
const token = (name) => css.match(new RegExp(`--${name}: (#[0-9a-fA-F]{6});`))?.[1] ?? fail('style.css', `no colour ${name}`);
const luminance = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
};
const [background, ink, muted, accent, dial, golden] = [token('background'), token('ink'), token('muted'), token('accent'), '#FBF8F1', '#A86C05'];
const pairs = [
  ['text, headings, menu / background', ink, background, 4.5],
  ['secondary text (lead, date, footer) / background', muted, background, 4.5],
  ['links, warning headings / background', accent, background, 4.5],
  ['section lines, focus ring, underline of the list / background', ink, background, 3],
  ['underline of the open page and of the list / background', accent, background, 3],
  ['dial: edge, degree marks / background', ink, background, 3],
  ['dial: path, hours, edge / dial', ink, dial, 3],
  ['dial: sun, ring, ray / dial', accent, dial, 3],
  ['dial: golden hour / dial', golden, dial, 3],
  ['dial: golden hour / path', golden, ink, 3],
];
for (const [what, a, b, least] of pairs) {
  const value = Math.floor(ratio(a, b) * 100) / 100;
  console.log(`${value.toFixed(2)} (${least}) ${what}`);
  if (value < least) fail('style.css', `contrast ${value} below ${least}: ${what}`);
}
// The ornament colour is below 3:1 on purpose; it only draws lines between rows that spacing already separates.
for (const [, rule] of css.matchAll(/([a-z-]+): [^;{}]*var\(--ornament\)/g)) if (rule !== 'border-top') fail('style.css', `ornament colour used for ${rule}`);

if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exit(1);
}
console.log(`OK: ${PAGES.length} pages, ${files.length} files`);
