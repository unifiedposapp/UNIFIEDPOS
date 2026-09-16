// ─── Dependency-free Markdown -> PDF generator for the Unified POS manual ────
// Reads docs/User-Manual.md and writes packages/web/public/User-Manual.pdf, a
// real, one-click-downloadable PDF "book" (cover + table of contents + chapters
// + page numbers). Uses only Node built-ins and the PDF base-14 Helvetica fonts,
// so no npm install is required and the output opens in any PDF reader.
//
// Run from the repo root:  node scripts/generate-manual-pdf.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { drawScreenMockup, FIGURES } from './pdf-figures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const SRC = resolve(repoRoot, 'docs', 'User-Manual.md');
const OUT = resolve(repoRoot, 'packages', 'web', 'public', 'User-Manual.pdf');

// ─── Page geometry (US Letter, points) ───────────────────────────────────────
const PAGE_W = 612;
const PAGE_H = 792;
const M = 64;                 // left/right margin
const RIGHT = PAGE_W - M;     // right edge of the text column
const CONTENT_W = RIGHT - M;  // 484pt text width
const CONTENT_TOP = 692;      // first baseline of body content
const CONTENT_BOTTOM = 96;    // do not draw body text below this
const HEADER_Y = 744;
const FOOTER_Y = 52;

// ─── Colors (RGB 0..1) ───────────────────────────────────────────────────────
const C_TITLE = '0.09 0.15 0.35';
const C_HEAD = '0.11 0.19 0.44';
const C_SUB = '0.35 0.38 0.43';
const C_BODY = '0.08 0.08 0.09';
const C_NOTE = '0.20 0.27 0.42';
const C_ACCENT = '0.70 0.53 0.14';
const C_RULE = '0.80 0.82 0.86';

// ─── Helvetica glyph widths (units/1000) for ASCII 32..126 ───────────────────
const WIDTHS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, '[': 278, '\\': 278, ']': 278,
  '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584,
};
const charW = (ch) => (WIDTHS[ch] !== undefined ? WIDTHS[ch] : 556);
const textW = (str, size, bold = false) => {
  let w = 0;
  for (const ch of str) w += charW(ch);
  return (w / 1000) * size * (bold ? 1.04 : 1);
};

// ─── Text sanitisation: markdown inline + WinAnsi-safe transliteration ───────
function inlineClean(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1');
}
function toWinAnsi(s) {
  return s
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '\u0095') // WinAnsi bullet byte
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\u0095]/g, '');
}
function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, size, maxW, bold = false) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (textW(test, size, bold) <= maxW || !line) line = test;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// ─── Parse the markdown into cover meta + chapters ───────────────────────────
function parseMarkdown(md) {
  const raw = md.replace(/\r\n/g, '\n').split('\n');
  let title = 'Unified POS';
  let subtitle = '';
  const intro = [];
  const chapters = [];
  let current = null;
  let seenTitle = false;
  let inPreamble = true;

  for (const line of raw) {
    const h1 = line.match(/^#\s+(.*)$/);
    const h2 = line.match(/^##\s+(.*)$/);
    const h3 = line.match(/^###\s+(.*)$/);
    if (h1 && !seenTitle) { title = h1[1].trim(); seenTitle = true; continue; }
    if (h2) {
      inPreamble = false;
      current = { title: h2[1].trim(), blocks: [] };
      chapters.push(current);
      continue;
    }
    if (inPreamble) {
      const note = line.match(/^>\s?(.*)$/);
      if (note) { intro.push(note[1].trim()); continue; }
      if (line.trim() && !subtitle) { subtitle = line.trim(); continue; }
      continue;
    }
    if (!current) continue;
    const t = line.trimEnd();
    if (!t.trim()) continue;
    if (h3) { current.blocks.push({ type: 'h3', text: inlineClean(h3[1].trim()) }); continue; }
    const note = t.match(/^>\s?(.*)$/);
    if (note) { current.blocks.push({ type: 'note', text: inlineClean(note[1].trim()) }); continue; }
    if (/^(-{3,}|\*{3,})$/.test(t.trim())) { current.blocks.push({ type: 'rule' }); continue; }
    const bullet = t.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) { current.blocks.push({ type: 'bullet', text: inlineClean(bullet[1].trim()) }); continue; }
    const num = t.match(/^\s*(\d+)\.\s+(.*)$/);
    if (num) { current.blocks.push({ type: 'num', n: num[1], text: inlineClean(num[2].trim()) }); continue; }
    current.blocks.push({ type: 'p', text: inlineClean(t.trim()) });
  }
  return { title, subtitle, intro: intro.join(' '), chapters };
}

// ─── Drawing primitives (append PDF operators to a page command list) ────────
function text(cmds, str, x, y, { font = 'F1', size = 11, color = C_BODY } = {}) {
  const s = esc(toWinAnsi(str));
  cmds.push(`${color} rg`, `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${s}) Tj ET`);
}
function rule(cmds, x1, y, x2, { color = C_RULE, w = 0.8 } = {}) {
  cmds.push(`${color} RG ${w} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
}

// ─── Lay out one chapter into pages; returns pages + first-page index ────────
function layoutChapter(chapter, figure) {
  const pages = [];
  let cmds = [];
  let y = CONTENT_TOP;
  const newPage = () => { pages.push(cmds); cmds = []; y = CONTENT_TOP; };

  // Chapter heading (##)
  cmds.push(`${C_HEAD} rg`);
  text(cmds, chapter.title, M, y, { font: 'F2', size: 18, color: C_HEAD });
  y -= 8;
  rule(cmds, M, y, RIGHT, { color: C_ACCENT, w: 1.4 });
  y -= 22;

  // Optional figure: a faithful vector mockup of the corresponding app screen.
  if (figure) {
    const figW = CONTENT_W;
    const figH = 232;
    if (y - figH - 26 < CONTENT_BOTTOM) newPage();
    const boxTop = y;
    drawScreenMockup(cmds, { x: M, yTop: boxTop, w: figW, h: figH }, figure.spec);
    const capY = boxTop - figH - 13;
    text(
      cmds,
      `Figure ${figure.no}. ${figure.spec.page} - an illustrative view of this area of Unified POS.`,
      M,
      capY,
      { font: 'F3', size: 9, color: C_NOTE },
    );
    y = capY - 20;
  }

  for (const b of chapter.blocks) {
    if (b.type === 'h3') {
      if (y < CONTENT_BOTTOM + 40) newPage();
      y -= 6;
      text(cmds, b.text, M, y, { font: 'F2', size: 13, color: C_HEAD });
      y -= 18;
    } else if (b.type === 'p') {
      const lines = wrap(b.text, 11, CONTENT_W);
      for (const ln of lines) {
        if (y < CONTENT_BOTTOM) newPage();
        text(cmds, ln, M, y, { size: 11, color: C_BODY });
        y -= 15;
      }
      y -= 5;
    } else if (b.type === 'bullet') {
      const lines = wrap(b.text, 11, CONTENT_W - 20);
      lines.forEach((ln, i) => {
        if (y < CONTENT_BOTTOM) newPage();
        if (i === 0) text(cmds, '\u2022', M + 4, y, { size: 11, color: C_ACCENT });
        text(cmds, ln, M + 20, y, { size: 11, color: C_BODY });
        y -= 15;
      });
      y -= 2;
    } else if (b.type === 'num') {
      const label = `${b.n}.`;
      const lines = wrap(b.text, 11, CONTENT_W - 26);
      lines.forEach((ln, i) => {
        if (y < CONTENT_BOTTOM) newPage();
        if (i === 0) text(cmds, label, M + 2, y, { font: 'F2', size: 11, color: C_HEAD });
        text(cmds, ln, M + 26, y, { size: 11, color: C_BODY });
        y -= 15;
      });
      y -= 2;
    } else if (b.type === 'note') {
      const lines = wrap(b.text, 10.5, CONTENT_W - 26);
      const topY = y;
      lines.forEach((ln) => {
        if (y < CONTENT_BOTTOM) newPage();
        text(cmds, ln, M + 20, y, { font: 'F3', size: 10.5, color: C_NOTE });
        y -= 14;
      });
      // left accent bar beside the note
      rule(cmds, M + 6, topY + 3, M + 6, { color: C_ACCENT, w: 0 }); // no-op guard
      cmds.push(`${C_ACCENT} RG 2 w ${M + 6} ${(y + 12).toFixed(2)} m ${M + 6} ${topY.toFixed(2)} l S`);
      cmds.push(`${C_RULE} RG 0.8 w`);
      y -= 6;
    } else if (b.type === 'rule') {
      y -= 4;
      rule(cmds, M, y, RIGHT);
      y -= 10;
    }
  }
  pages.push(cmds);
  return pages;
}

// ─── Build the whole page list (cover, TOC, body) ────────────────────────────
function buildDoc(meta) {
  const bodyPages = [];
  const chapterStart = [];
  let figureNo = 0;
  for (const ch of meta.chapters) {
    chapterStart.push(bodyPages.length);
    const numMatch = ch.title.match(/^(\d+)\./);
    const num = numMatch ? Number(numMatch[1]) : null;
    let figure = null;
    if (num !== null && FIGURES[num]) {
      figureNo += 1;
      figure = { spec: FIGURES[num], no: figureNo };
    }
    bodyPages.push(...layoutChapter(ch, figure));
  }
  meta.figureCount = figureNo;

  // Front matter: 1 cover + TOC pages. TOC is one line per chapter.
  const tocLineH = 19;
  const tocTop = CONTENT_TOP - 40; // leave room for the "Contents" heading
  const tocPerPage = Math.max(1, Math.floor((tocTop - CONTENT_BOTTOM) / tocLineH));
  const tocPages = Math.max(1, Math.ceil(meta.chapters.length / tocPerPage));
  const frontPages = 1 + tocPages;
  const pageOf = (i) => frontPages + 1 + chapterStart[i];

  const doc = []; // array of { cmds, kind }

  // Cover page
  const cover = [];
  cover.push(`${C_ACCENT} RG 2.5 w ${M} 620 m ${RIGHT} 620 l S`);
  const titleLines = wrap(meta.title, 30, CONTENT_W, true);
  let cy = 560;
  for (const ln of titleLines) { text(cover, ln, M, cy, { font: 'F2', size: 30, color: C_TITLE }); cy -= 38; }
  cy -= 4;
  if (meta.subtitle) {
    for (const ln of wrap(meta.subtitle, 13, CONTENT_W)) { text(cover, ln, M, cy, { font: 'F3', size: 13, color: C_SUB }); cy -= 18; }
  }
  cy -= 6;
  text(cover, 'Manual of Use', M, cy, { font: 'F2', size: 14, color: C_ACCENT });
  cy -= 40;
  if (meta.intro) {
    for (const ln of wrap(meta.intro, 10.5, CONTENT_W)) { text(cover, ln, M, cy, { font: 'F3', size: 10.5, color: C_NOTE }); cy -= 15; }
  }
  text(cover, 'Copyright by Unified POS. All Rights Reserved.', M, 120, { size: 9.5, color: C_SUB });
  text(cover, 'A Division of Glorified Technology Solution (GTS).', M, 106, { size: 9.5, color: C_SUB });
  doc.push({ cmds: cover, kind: 'cover' });

  // TOC pages
  for (let p = 0; p < tocPages; p++) {
    const cmds = [];
    if (p === 0) {
      text(cmds, 'Contents', M, CONTENT_TOP, { font: 'F2', size: 20, color: C_HEAD });
      rule(cmds, M, CONTENT_TOP - 8, RIGHT, { color: C_ACCENT, w: 1.4 });
    }
    let y = tocTop;
    const slice = meta.chapters.slice(p * tocPerPage, (p + 1) * tocPerPage);
    slice.forEach((ch, idx) => {
      const i = p * tocPerPage + idx;
      const label = ch.title.replace(/^\d+\.\s*/, '');
      const num = ch.title.match(/^(\d+)\./);
      const prefix = num ? `${num[1]}. ` : '';
      const pg = String(pageOf(i));
      text(cmds, `${prefix}${label}`, M + 4, y, { size: 11.5, color: C_BODY });
      text(cmds, pg, RIGHT - textW(pg, 11.5), y, { font: 'F2', size: 11.5, color: C_HEAD });
      rule(cmds, M + 4, y - 5, RIGHT, { color: C_RULE, w: 0.4 });
      y -= tocLineH;
    });
    doc.push({ cmds, kind: 'toc' });
  }

  // Body pages
  for (const pg of bodyPages) doc.push({ cmds: pg, kind: 'body' });

  // Add header/footer furniture with real document page numbers
  doc.forEach((page, idx) => {
    const docPage = idx + 1;
    if (page.kind === 'cover') return; // cover stays clean
    page.cmds.push(`${C_SUB} rg`);
    text(page.cmds, 'Unified POS - Manual of Use', M, HEADER_Y, { size: 8.5, color: C_SUB });
    rule(page.cmds, M, HEADER_Y - 6, RIGHT, { color: C_RULE, w: 0.6 });
    rule(page.cmds, M, FOOTER_Y + 12, RIGHT, { color: C_RULE, w: 0.6 });
    const label = `Page ${docPage}`;
    text(page.cmds, label, (PAGE_W - textW(label, 9)) / 2, FOOTER_Y, { size: 9, color: C_SUB });
  });

  return doc;
}

// ─── Assemble the PDF byte stream ────────────────────────────────────────────
function renderPdf(doc, meta) {
  const objs = []; // index 0 unused; object N at objs[N]
  const push = (body) => { objs.push(body); return objs.length; };

  // Reserve fixed ids: 1 catalog, 2 pages, 3 F1, 4 F2, 5 F3, 6 info
  const CATALOG = 1, PAGES = 2, F1 = 3, F2 = 4, F3 = 5, INFO = 6;
  const pageCount = doc.length;
  const firstPageObj = 7;
  // page i -> obj (firstPageObj + 2i); content -> obj (firstPageObj + 2i + 1)
  const pageObjId = (i) => firstPageObj + 2 * i;
  const contentObjId = (i) => firstPageObj + 2 * i + 1;
  const totalObjs = firstPageObj + 2 * pageCount - 1;

  // Pre-fill placeholder slots so numbering is stable
  for (let n = 1; n <= totalObjs; n++) objs[n - 1] = null;

  const kids = doc.map((_, i) => `${pageObjId(i)} 0 R`).join(' ');
  objs[CATALOG - 1] = `<< /Type /Catalog /Pages ${PAGES} 0 R >>`;
  objs[PAGES - 1] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>`;
  objs[F1 - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[F2 - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[F3 - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';
  const now = new Date();
  const dateStr = `D:${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}000000Z`;
  objs[INFO - 1] = `<< /Title (Unified POS - Manual of Use) /Author (Unified POS, a division of Glorified Technology Solution) /Subject (${esc(meta.subtitle || 'Manual of Use')}) /Creator (Unified POS) /ModDate (${dateStr}) >>`;

  doc.forEach((page, i) => {
    const stream = page.cmds.join('\n');
    const bytes = Buffer.byteLength(stream, 'latin1');
    objs[pageObjId(i) - 1] =
      `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R /F3 ${F3} 0 R >> >> ` +
      `/Contents ${contentObjId(i)} 0 R >>`;
    objs[contentObjId(i) - 1] = `<< /Length ${bytes} >>\nstream\n${stream}\nendstream`;
  });

  // Serialise with a correct xref table
  const chunks = [];
  let offset = 0;
  const add = (s) => { const b = Buffer.from(s, 'latin1'); chunks.push(b); offset += b.length; };

  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'); // binary comment so readers treat it as binary
  const offsets = [];
  for (let n = 1; n <= totalObjs; n++) {
    offsets[n] = offset;
    add(`${n} 0 obj\n${objs[n - 1]}\nendobj\n`);
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${totalObjs + 1}\n`;
  xref += '0000000000 65535 f\r\n';
  for (let n = 1; n <= totalObjs; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n\r\n`;
  }
  add(xref);
  add(`trailer\n<< /Size ${totalObjs + 1} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const md = readFileSync(SRC, 'utf8');
  const meta = parseMarkdown(md);
  const doc = buildDoc(meta);
  const pdf = renderPdf(doc, meta);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, pdf);
  console.log(`[manual] wrote ${OUT}`);
  console.log(`[manual] chapters=${meta.chapters.length} figures=${meta.figureCount || 0} pages=${doc.length} bytes=${pdf.length}`);
}

main();
