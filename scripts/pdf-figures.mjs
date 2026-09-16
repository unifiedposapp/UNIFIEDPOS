// ─── Vector "screen mockup" figures for the Unified POS manual PDF ────────────
// Draws faithful, dependency-free illustrations of real app pages (dark ink
// sidebar with grouped nav + gold accents, white top bar, and a page-specific
// content region) using only PDF content-stream operators. These render as
// crisp vectors in any PDF reader and showcase each area of the app's structure
// and design. Palette + nav labels mirror packages/web (tailwind.config.js and
// i18n/translations.ts) so the mockups match the real UI.
//
// If a real screenshot is later dropped at docs/assets/manual/<key>.png, the
// generator can embed it instead; see generator's figure handling.

// ─── Palette (RGB 0..1) from tailwind.config.js ──────────────────────────────
export const P = {
  ink950: '0.039 0.051 0.094', // #0a0d18
  ink900: '0.078 0.098 0.161', // #141929
  ink800: '0.137 0.165 0.255', // #232a41
  ink700: '0.212 0.247 0.369', // #363f5e
  ink500: '0.353 0.416 0.573', // #5a6a92
  ink300: '0.635 0.690 0.812', // #a2b0cf
  ink200: '0.788 0.824 0.902', // #c9d2e6
  ink100: '0.906 0.922 0.957', // #e7ebf4
  ink50: '0.957 0.965 0.984', // #f4f6fb
  gold700: '0.561 0.435 0.227', // #8f6f3a
  gold500: '0.776 0.651 0.392', // #c6a664
  gold400: '0.796 0.690 0.416', // #cbb06a
  gold300: '0.851 0.757 0.537', // #d9c189
  gold200: '0.906 0.847 0.706', // #e7d8b4
  gold100: '0.953 0.925 0.859', // #f3ecdb
  gold50: '0.980 0.969 0.941', // #faf7f0
  white: '1 1 1',
  emerald: '0.204 0.780 0.545',
  rose: '0.945 0.267 0.369',
  sky: '0.376 0.647 0.976',
};

// ─── Low-level operators (top-down box model; yTop is the TOP edge) ───────────
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const f2 = (n) => Number(n).toFixed(2);
// Transliterate symbols the base-14 WinAnsi fonts cannot render, then strip the
// rest, so every figure string is a clean single-byte PDF string.
const ascii = (s) =>
  String(s)
    .replace(/[\u20A6\u20B5]/g, 'N') // naira / cedi -> N
    .replace(/\u25B2/g, '+') // up triangle -> +
    .replace(/\u25BC/g, '-') // down triangle -> -
    .replace(/[\u2713\u2714]/g, '+') // check -> +
    .replace(/\u2022/g, '\u0095') // bullet -> WinAnsi bullet byte
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\u0095\u00B7]/g, '');

// Draw text at baseline (x, yBaseline). font: 'F1' regular, 'F2' bold, 'F3' oblique.
export function T(cmds, str, x, yBaseline, size, color, font = 'F1') {
  cmds.push(`${color} rg`, `BT /${font} ${f2(size)} Tf 1 0 0 1 ${f2(x)} ${f2(yBaseline)} Tm (${esc(ascii(str))}) Tj ET`);
}
// Filled rect from top-left (x, yTop) with width w and height h.
function RF(cmds, x, yTop, w, h, color) {
  cmds.push(`${color} rg ${f2(x)} ${f2(yTop - h)} ${f2(w)} ${f2(h)} re f`);
}
// Stroked rect from top-left.
function RS(cmds, x, yTop, w, h, color, lw = 0.6) {
  cmds.push(`${color} RG ${f2(lw)} w ${f2(x)} ${f2(yTop - h)} ${f2(w)} ${f2(h)} re S`);
}
// Horizontal/vertical line.
function LN(cmds, x1, y1, x2, y2, color, lw = 0.6) {
  cmds.push(`${color} RG ${f2(lw)} w ${f2(x1)} ${f2(y1)} m ${f2(x2)} ${f2(y2)} l S`);
}
// Polyline through points [[x,y],...] (PDF coords, y up).
function POLY(cmds, pts, color, lw = 1.1) {
  if (!pts.length) return;
  const d = pts.map((p, i) => `${f2(p[0])} ${f2(p[1])} ${i === 0 ? 'm' : 'l'}`).join(' ');
  cmds.push(`${color} RG ${f2(lw)} w ${d} S`);
}
// A filled circle-ish dot (small square rotated is overkill; use a tiny rect).
function DOT(cmds, cx, cy, r, color) {
  cmds.push(`${color} rg ${f2(cx - r)} ${f2(cy - r)} ${f2(r * 2)} ${f2(r * 2)} re f`);
}

// ─── Shared chrome: sidebar + top bar + page canvas ───────────────────────────
// box = { x, yTop, w, h } in PDF points. spec = { page, nav, group }
function drawChrome(cmds, box, spec) {
  const { x, yTop, w, h } = box;
  // Window frame + page canvas
  RF(cmds, x, yTop, w, h, P.ink50);
  RS(cmds, x, yTop, w, h, P.ink200, 1.0);

  const sideW = Math.round(w * 0.205);
  const topH = Math.round(h * 0.115);

  // Sidebar (dark ink gradient approximated with two bands)
  RF(cmds, x, yTop, sideW, h, P.ink950);
  RF(cmds, x, yTop, sideW, h * 0.55, P.ink900);

  // Brand block
  const bx = x + 8;
  RF(cmds, bx, yTop - 12, 12, 12, P.gold500); // logo tile
  T(cmds, 'UnifiedPOS', bx + 16, yTop - 12, 6.4, P.gold200, 'F2');
  T(cmds, 'BUSINESS OS', bx + 16, yTop - 19, 3.2, P.ink300, 'F1');
  LN(cmds, x + 4, yTop - 26, x + sideW - 4, yTop - 26, P.ink800, 0.5);

  // Nav: group label + item rows; highlight the active page's nav item.
  const navRows = [
    { g: 'SELL', items: ['POS Terminal', 'Orders', 'Restaurant', 'Commerce Hub', 'Payments'] },
    { g: 'MERCHANDISE', items: ['Inventory', 'Catalog', 'Purchasing', 'Suppliers'] },
    { g: 'GROWTH', items: ['Customers', 'Loyalty', 'Marketing', 'AI Insights', 'AI Copilot'] },
    { g: 'WORKFORCE', items: ['Employees', 'Registers', 'Hardware'] },
    { g: 'FINANCE', items: ['Accounting', 'Reports'] },
    { g: 'PLATFORM', items: ['Developer', 'Enterprise', 'System', 'Offline & Sync'] },
    { g: 'ADMIN', items: ['Notifications', 'Audit Log', 'Compliance', 'Settings'] },
  ];
  let ny = yTop - 34;
  const rowH = 8.2;
  const active = (spec.nav || '').toLowerCase();
  outer: for (const grp of navRows) {
    if (ny < yTop - h + 34) break;
    T(cmds, grp.g, bx, ny, 3.3, P.ink500, 'F2');
    ny -= 6.2;
    for (const it of grp.items) {
      if (ny < yTop - h + 30) break outer;
      const isActive = it.toLowerCase() === active;
      if (isActive) {
        RF(cmds, x + 4, ny + 1.5, sideW - 8, 7.6, P.ink800);
        RF(cmds, x + 4, ny + 1.5, 1.4, 7.6, P.gold400);
      }
      DOT(cmds, bx + 1.6, ny - 1.6, 1.1, isActive ? P.gold300 : P.ink500);
      T(cmds, it, bx + 6, ny - 3.4, 4.1, isActive ? P.gold200 : P.ink200, isActive ? 'F2' : 'F1');
      ny -= rowH;
    }
    ny -= 2.4;
  }

  // Sidebar user chip at bottom
  const uy = yTop - h + 20;
  LN(cmds, x + 4, uy + 12, x + sideW - 4, uy + 12, P.ink800, 0.5);
  DOT(cmds, bx + 4, uy + 4, 3.4, P.gold500);
  T(cmds, 'A', bx + 2.6, uy + 2.4, 4.2, P.ink950, 'F2');
  T(cmds, 'Admin', bx + 12, uy + 5.4, 4.2, P.white, 'F2');
  T(cmds, 'OWNER', bx + 12, uy + 0.6, 3.0, P.gold300, 'F1');

  // Top bar (white)
  const cx = x + sideW;
  const cw = w - sideW;
  RF(cmds, cx, yTop, cw, topH, P.white);
  LN(cmds, cx, yTop - topH, x + w, yTop - topH, P.ink100, 0.7);
  DOT(cmds, cx + 9, yTop - topH / 2, 1.7, P.emerald);
  T(cmds, 'Operational', cx + 14, yTop - topH / 2 - 1.6, 3.8, P.ink500, 'F1');
  T(cmds, 'EN  |  ' + (spec.page || ''), cx + cw - 96, yTop - topH / 2 - 1.6, 3.8, P.ink500, 'F1');
  // bell + badge
  RF(cmds, cx + cw - 16, yTop - topH / 2 - 3, 6, 6, P.ink200);
  DOT(cmds, cx + cw - 11, yTop - topH / 2 - 3, 1.8, P.rose);

  // Content region returned for archetype drawing
  return { x: cx + 8, yTop: yTop - topH - 7, w: cw - 16, h: h - topH - 14 };
}

// ─── Small widgets used by archetypes ─────────────────────────────────────────
function pageTitle(cmds, c, title, sub) {
  T(cmds, title, c.x, c.yTop - 6, 8.2, P.ink800, 'F2');
  if (sub) T(cmds, sub, c.x, c.yTop - 13, 4.2, P.ink500, 'F1');
  // gold underline accent
  RF(cmds, c.x, c.yTop - 16.5, 22, 1.3, P.gold400);
  return c.yTop - 24;
}
function statCard(cmds, x, yTop, w, h, label, value, delta, accent) {
  RF(cmds, x, yTop, w, h, P.white);
  RS(cmds, x, yTop, w, h, P.ink100, 0.6);
  RF(cmds, x, yTop, 2.2, h, accent || P.gold400);
  T(cmds, label, x + 7, yTop - 8, 3.7, P.ink500, 'F1');
  T(cmds, value, x + 7, yTop - 18, 8.4, P.ink800, 'F2');
  if (delta) T(cmds, delta, x + 7, yTop - 25, 3.6, P.emerald, 'F2');
}
function barChart(cmds, x, yTop, w, h, title, values, color) {
  RF(cmds, x, yTop, w, h, P.white);
  RS(cmds, x, yTop, w, h, P.ink100, 0.6);
  T(cmds, title, x + 6, yTop - 8, 4.3, P.ink700, 'F2');
  const baseY = yTop - h + 8;
  const plotH = h - 20;
  const n = values.length;
  const gap = 3;
  const bw = (w - 12 - gap * (n - 1)) / n;
  const max = Math.max(...values, 1);
  values.forEach((v, i) => {
    const bh = (v / max) * plotH;
    const bxx = x + 6 + i * (bw + gap);
    RF(cmds, bxx, baseY, bw, bh, i === n - 1 ? P.gold400 : color || P.ink200);
  });
  LN(cmds, x + 6, baseY, x + w - 6, baseY, P.ink100, 0.5);
}
function lineChart(cmds, x, yTop, w, h, title, values, color) {
  RF(cmds, x, yTop, w, h, P.white);
  RS(cmds, x, yTop, w, h, P.ink100, 0.6);
  T(cmds, title, x + 6, yTop - 8, 4.3, P.ink700, 'F2');
  const padT = 16, padB = 8, padL = 6, padR = 6;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [
    x + padL + (plotW * i) / Math.max(1, values.length - 1),
    yTop - padT - ((v - min) / Math.max(1, max - min)) * plotH,
  ]);
  // area fill (light) then line
  const area = pts.concat([[pts[pts.length - 1][0], yTop - padT - plotH], [pts[0][0], yTop - padT - plotH]]);
  const d = area.map((p, i) => `${f2(p[0])} ${f2(p[1])} ${i === 0 ? 'm' : 'l'}`).join(' ');
  cmds.push(`${P.gold50} rg ${d} h f`);
  POLY(cmds, pts, color || P.gold500, 1.2);
}
function table(cmds, x, yTop, w, h, columns, rows) {
  RF(cmds, x, yTop, w, h, P.white);
  RS(cmds, x, yTop, w, h, P.ink100, 0.6);
  // header
  RF(cmds, x, yTop, w, 10, P.ink50);
  LN(cmds, x, yTop - 10, x + w, yTop - 10, P.ink100, 0.6);
  const colW = columns.map((c) => ((c.w || 1) * (w - 8)) / columns.reduce((a, b) => a + (b.w || 1), 0));
  let cxp = x + 4;
  columns.forEach((col, i) => {
    T(cmds, col.label, cxp, yTop - 7, 3.8, P.ink700, 'F2');
    cxp += colW[i];
  });
  // rows
  const rowH = 9;
  const maxRows = Math.floor((h - 12) / rowH);
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    const ry = yTop - 10 - r * rowH;
    if (r % 2 === 1) RF(cmds, x + 0.4, ry, w - 0.8, rowH, P.ink50);
    LN(cmds, x, ry, x + w, ry, P.ink100, 0.4);
    let rx = x + 4;
    rows[r].forEach((cell, i) => {
      if (cell && cell.pill) {
        const pw = Math.min(colW[i] - 4, 4 + String(cell.text).length * 2.2);
        RF(cmds, rx, ry - 2.2, pw, 6, cell.color || P.gold100);
        T(cmds, cell.text, rx + 2, ry - 6.4, 3.3, P.ink700, 'F2');
      } else {
        T(cmds, String(cell && cell.text !== undefined ? cell.text : cell), rx, ry - 6.4, 3.7, i === 0 ? P.ink800 : P.ink500, i === 0 ? 'F2' : 'F1');
      }
      rx += colW[i];
    });
  }
}
function chip(cmds, x, yTop, label, fill, text) {
  const w = 6 + label.length * 2.5;
  RF(cmds, x, yTop, w, 8, fill);
  RS(cmds, x, yTop, w, 8, P.ink100, 0.4);
  T(cmds, label, x + 3, yTop - 5.7, 3.6, text || P.ink700, 'F2');
  return w;
}

// ─── Archetypes ───────────────────────────────────────────────────────────────
function archLogin(cmds, box, spec) {
  // Split brand panel: left dark ink with brand, right white sign-in card.
  RF(cmds, box.x, box.yTop, box.w, box.h, P.ink950);
  RF(cmds, box.x, box.yTop, box.w * 0.46, box.h, P.ink900);
  RF(cmds, box.x + box.w * 0.10, box.yTop - box.h * 0.30, 14, 14, P.gold500);
  T(cmds, 'Unified POS', box.x + box.w * 0.10, box.yTop - box.h * 0.42, 9, P.gold200, 'F2');
  T(cmds, 'The complete Business Operating System', box.x + box.w * 0.10, box.yTop - box.h * 0.52, 4, P.ink300, 'F1');
  ['Sell in person & online', 'Inventory across locations', 'Loyalty, marketing & AI'].forEach((s, i) => {
    const yy = box.yTop - box.h * 0.62 - i * 8;
    DOT(cmds, box.x + box.w * 0.105, yy + 1.5, 1.2, P.gold400);
    T(cmds, s, box.x + box.w * 0.105 + 5, yy - 1.5, 3.9, P.ink200, 'F1');
  });
  // Sign-in card
  const cw = box.w * 0.40, chh = box.h * 0.66;
  const cx = box.x + box.w * 0.54, cy = box.yTop - (box.h - chh) / 2;
  RF(cmds, cx, cy, cw, chh, P.white);
  RS(cmds, cx, cy, cw, chh, P.ink100, 0.8);
  T(cmds, 'Sign in to your account', cx + 10, cy - 14, 5.4, P.ink800, 'F2');
  T(cmds, 'Email', cx + 10, cy - 27, 3.6, P.ink500, 'F2');
  RF(cmds, cx + 10, cy - 30, cw - 20, 9, P.ink50); RS(cmds, cx + 10, cy - 30, cw - 20, 9, P.ink200, 0.5);
  T(cmds, 'admin@pos.com', cx + 13, cy - 36.5, 3.8, P.ink700, 'F1');
  T(cmds, 'Password', cx + 10, cy - 46, 3.6, P.ink500, 'F2');
  RF(cmds, cx + 10, cy - 49, cw - 20, 9, P.ink50); RS(cmds, cx + 10, cy - 49, cw - 20, 9, P.ink200, 0.5);
  T(cmds, '••••••••••', cx + 13, cy - 55.5, 3.8, P.ink700, 'F1');
  RF(cmds, cx + 10, cy - 66, cw - 20, 10, P.gold500);
  T(cmds, 'Sign In', cx + cw / 2 - 8, cy - 73, 4.4, P.ink950, 'F2');
  T(cmds, 'Forgot password?   Create account', cx + 10, cy - 82, 3.4, P.ink500, 'F1');
}

function archDashboard(cmds, c, spec) {
  let y = pageTitle(cmds, c, spec.page, spec.sub || 'Live business overview');
  const cw = (c.w - 12) / 4;
  (spec.stats || []).slice(0, 4).forEach((s, i) => statCard(cmds, c.x + i * (cw + 4), y, cw, 30, s[0], s[1], s[2], s[3]));
  y -= 36;
  const chartH = Math.max(40, c.yTop - c.h - y + 34);
  const leftW = c.w * 0.58;
  lineChart(cmds, c.x, y, leftW, chartH, spec.lineTitle || 'Sales trend', spec.line || [12, 18, 15, 24, 22, 30, 28, 38], P.gold500);
  barChart(cmds, c.x + leftW + 6, y, c.w - leftW - 6, chartH, spec.barTitle || 'Top categories', spec.bars || [8, 14, 10, 18, 12, 20], P.ink200);
}

function archRegister(cmds, c, spec) {
  let y = pageTitle(cmds, c, spec.page, spec.sub || 'Register 1 · Main Store');
  const gridW = c.w * 0.60, cartW = c.w - gridW - 6;
  // category chips
  let cxx = c.x;
  (spec.cats || ['All', 'Drinks', 'Food', 'Sides', 'Dessert']).forEach((cat, i) => {
    const w = chip(cmds, cxx, y, cat, i === 0 ? P.gold100 : P.white, P.ink700);
    cxx += w + 4;
  });
  y -= 13;
  // product grid
  const cols = 4, tileH = 22, gap = 4;
  const tileW = (gridW - gap * (cols - 1)) / cols;
  const prods = spec.products || ['Espresso', 'Latte', 'Cappuccino', 'Mocha', 'Croissant', 'Bagel', 'Salad', 'Soup', 'Tea', 'Juice', 'Cookie', 'Water'];
  const rowsN = Math.min(3, Math.ceil(prods.length / cols));
  for (let r = 0; r < rowsN; r++) {
    for (let col = 0; col < cols; col++) {
      const idx = r * cols + col;
      if (idx >= prods.length) break;
      const tx = c.x + col * (tileW + gap), ty = y - r * (tileH + gap);
      RF(cmds, tx, ty, tileW, tileH, P.white);
      RS(cmds, tx, ty, tileW, tileH, P.ink100, 0.5);
      RF(cmds, tx + 3, ty - 4, tileW - 6, 8, P.ink50);
      T(cmds, prods[idx], tx + 3, ty - 16, 3.6, P.ink700, 'F2');
      T(cmds, '$' + (2 + idx * 0.5).toFixed(2), tx + 3, ty - 20.5, 3.3, P.gold700, 'F1');
    }
  }
  // cart panel
  const cartX = c.x + gridW + 6;
  const cartTop = y + 13;
  const cartH = c.yTop - cartTop - (c.yTop - c.h) + 4;
  RF(cmds, cartX, cartTop, cartW, cartH, P.white);
  RS(cmds, cartX, cartTop, cartW, cartH, P.ink100, 0.7);
  T(cmds, 'Current Order', cartX + 5, cartTop - 8, 4.3, P.ink800, 'F2');
  LN(cmds, cartX + 4, cartTop - 11, cartX + cartW - 4, cartTop - 11, P.ink100, 0.5);
  const items = spec.cart || [['Latte', '2', '$9.00'], ['Croissant', '1', '$3.50'], ['Espresso', '3', '$7.50']];
  let iy = cartTop - 18;
  items.forEach((it) => {
    T(cmds, it[0], cartX + 5, iy, 3.6, P.ink700, 'F2');
    T(cmds, 'x' + it[1], cartX + cartW * 0.52, iy, 3.4, P.ink500, 'F1');
    T(cmds, it[2], cartX + cartW - 5 - it[2].length * 2.1, iy, 3.6, P.ink800, 'F1');
    iy -= 7.5;
  });
  // totals
  const ty = cartTop - cartH + 34;
  LN(cmds, cartX + 4, ty + 12, cartX + cartW - 4, ty + 12, P.ink100, 0.5);
  [['Subtotal', '$20.00'], ['Tax (7.5%)', '$1.50'], ['Total', '$21.50']].forEach((r, i) => {
    const bold = r[0] === 'Total';
    T(cmds, r[0], cartX + 5, ty + 6 - i * 7, bold ? 4.2 : 3.5, bold ? P.ink800 : P.ink500, bold ? 'F2' : 'F1');
    T(cmds, r[1], cartX + cartW - 5 - r[1].length * (bold ? 2.5 : 2.1), ty + 6 - i * 7, bold ? 4.2 : 3.5, bold ? P.ink800 : P.ink500, bold ? 'F2' : 'F1');
  });
  RF(cmds, cartX + 5, ty - 18, cartW - 10, 11, P.gold500);
  T(cmds, 'Take Payment', cartX + cartW / 2 - 14, ty - 25.5, 4.2, P.ink950, 'F2');
}

function archTable(cmds, c, spec) {
  let y = pageTitle(cmds, c, spec.page, spec.sub);
  // toolbar: search + action button
  RF(cmds, c.x, y, c.w * 0.42, 9, P.white); RS(cmds, c.x, y, c.w * 0.42, 9, P.ink200, 0.5);
  T(cmds, 'Search…', c.x + 4, y - 6, 3.6, P.ink300, 'F1');
  RF(cmds, c.x + c.w - 42, y, 42, 9, P.gold500);
  T(cmds, spec.action || 'New', c.x + c.w - 40, y - 6, 3.7, P.ink950, 'F2');
  y -= 14;
  const th = c.yTop - c.h - y + 2;
  table(cmds, c.x, y, c.w, Math.max(30, th), spec.columns, spec.rows);
}

function archCards(cmds, c, spec) {
  let y = pageTitle(cmds, c, spec.page, spec.sub);
  const cols = spec.cols || 3, gap = 5;
  const cardW = (c.w - gap * (cols - 1)) / cols;
  const cardH = spec.cardH || 34;
  (spec.cards || []).forEach((card, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = c.x + col * (cardW + gap), yy = y - row * (cardH + gap);
    if (yy - cardH < c.yTop - c.h) return;
    RF(cmds, x, yy, cardW, cardH, P.white);
    RS(cmds, x, yy, cardW, cardH, P.ink100, 0.6);
    RF(cmds, x, yy, cardW, 2.4, card.accent || P.gold400);
    T(cmds, card.title, x + 5, yy - 11, 4.4, P.ink800, 'F2');
    T(cmds, card.metric || '', x + 5, yy - 19, 6.2, P.ink700, 'F2');
    if (card.note) T(cmds, card.note, x + 5, yy - 26, 3.4, P.ink500, 'F1');
    if (card.pill) {
      const pw = 6 + card.pill.length * 2.2;
      RF(cmds, x + cardW - pw - 5, yy - 12, pw, 7, P.gold100);
      T(cmds, card.pill, x + cardW - pw - 3, yy - 17, 3.3, P.ink700, 'F2');
    }
  });
}

function archDevices(cmds, c, spec) {
  let y = pageTitle(cmds, c, spec.page, spec.sub || 'Detected system & paired devices');
  // capability chips
  let cxx = c.x;
  (spec.caps || ['Serial', 'WebUSB', 'Bluetooth']).forEach((cap) => {
    const w = chip(cmds, cxx, y, '✓ ' + cap, P.gold50, P.gold700);
    cxx += w + 4;
  });
  RF(cmds, c.x + c.w - 60, y, 60, 9, P.ink800);
  T(cmds, 'Auto-detect', c.x + c.w - 57, y - 6, 3.7, P.white, 'F2');
  y -= 14;
  // device rows
  const devices = spec.devices || [
    ['EPSON TM-T20', 'Printer', 'USB · Serial', 'Connected'],
    ['Zebra DS2208', 'Scanner', 'USB-HID', 'Connected'],
    ['Cash Drawer', 'Drawer', 'RJ11 · Pin 2', 'Ready'],
    ['Customer Display', 'Display', 'Bluetooth', 'Paired'],
  ];
  const rowH = 13;
  devices.forEach((d, i) => {
    const yy = y - i * (rowH + 3);
    if (yy - rowH < c.yTop - c.h) return;
    RF(cmds, c.x, yy, c.w, rowH, P.white);
    RS(cmds, c.x, yy, c.w, rowH, P.ink100, 0.5);
    RF(cmds, c.x + 4, yy - 3.5, 6, 6, P.ink100);
    T(cmds, d[0], c.x + 14, yy - 5.5, 4.1, P.ink800, 'F2');
    T(cmds, d[1], c.x + 14, yy - 10.5, 3.3, P.ink500, 'F1');
    T(cmds, d[2], c.x + c.w * 0.46, yy - 8, 3.6, P.ink500, 'F1');
    const connected = /connect|ready/i.test(d[3]);
    const pw = 8 + d[3].length * 2.2;
    RF(cmds, c.x + c.w - pw - 6, yy - 9, pw, 7, connected ? P.gold100 : P.ink100);
    T(cmds, d[3], c.x + c.w - pw - 3, yy - 7, 3.3, connected ? P.gold700 : P.ink500, 'F2');
  });
}

function archChat(cmds, c, spec) {
  let y = pageTitle(cmds, c, spec.page, spec.sub || 'Ask your business anything');
  const leftW = c.w * 0.56;
  // insight cards (left)
  const insights = spec.insights || [
    ['Anomaly detected', 'Refunds up 18% on Register 2 this week.'],
    ['Opportunity', 'Bundle Espresso + Croissant to lift AOV ~7%.'],
    ['Forecast', 'Weekend demand projected +22%; pre-stock milk.'],
  ];
  let iy = y;
  insights.forEach((ins) => {
    const hgt = 22;
    RF(cmds, c.x, iy, leftW, hgt, P.white); RS(cmds, c.x, iy, leftW, hgt, P.ink100, 0.6);
    RF(cmds, c.x, iy, 2.2, hgt, P.gold400);
    T(cmds, ins[0], c.x + 7, iy - 8, 4.1, P.ink800, 'F2');
    T(cmds, ins[1], c.x + 7, iy - 15, 3.5, P.ink500, 'F1');
    iy -= hgt + 4;
  });
  // chat panel (right)
  const cx = c.x + leftW + 6, cw = c.w - leftW - 6;
  const cTop = y, cH = c.yTop - c.h - y + 4;
  RF(cmds, cx, cTop, cw, cH, P.white); RS(cmds, cx, cTop, cw, cH, P.ink100, 0.7);
  RF(cmds, cx, cTop, cw, 9, P.ink800);
  T(cmds, 'AI Copilot', cx + 5, cTop - 6, 3.9, P.white, 'F2');
  const msgs = spec.messages || [
    ['user', 'Which products should I restock today?'],
    ['ai', 'Milk, oats and espresso beans are below reorder point. Draft a PO for 3 suppliers?'],
  ];
  let my = cTop - 14;
  msgs.forEach((m) => {
    const isUser = m[0] === 'user';
    const bw = cw - 14;
    const hgt = 14;
    const bx = isUser ? cx + 8 : cx + 6;
    RF(cmds, bx, my, bw, hgt, isUser ? P.gold50 : P.ink50);
    RS(cmds, bx, my, bw, hgt, P.ink100, 0.4);
    T(cmds, m[1].slice(0, 46), bx + 3, my - 6, 3.3, P.ink700, 'F1');
    if (m[1].length > 46) T(cmds, m[1].slice(46, 92), bx + 3, my - 11, 3.3, P.ink700, 'F1');
    my -= hgt + 4;
  });
  RF(cmds, cx + 6, cTop - cH + 12, cw - 22, 8, P.ink50); RS(cmds, cx + 6, cTop - cH + 12, cw - 22, 8, P.ink200, 0.5);
  RF(cmds, cx + cw - 14, cTop - cH + 12, 8, 8, P.gold500);
}

function archForm(cmds, c, spec) {
  let y = pageTitle(cmds, c, spec.page, spec.sub || 'Business configuration');
  const sections = spec.sections || [
    ['Business profile', [['Business name', 'Unified POS Demo'], ['Industry', 'Retail · Cafe'], ['Country', 'Nigeria']]],
    ['Localization', [['Currency', 'NGN ₦'], ['Language', 'English'], ['Tax rate', '7.5%']]],
  ];
  sections.forEach((sec) => {
    const rowsN = sec[1].length;
    const sh = 14 + rowsN * 12;
    if (y - sh < c.yTop - c.h) return;
    RF(cmds, c.x, y, c.w, sh, P.white); RS(cmds, c.x, y, c.w, sh, P.ink100, 0.6);
    T(cmds, sec[0], c.x + 6, y - 8, 4.3, P.ink800, 'F2');
    LN(cmds, c.x + 5, y - 11, c.x + c.w - 5, y - 11, P.ink100, 0.5);
    sec[1].forEach((fld, i) => {
      const fy = y - 15 - i * 12;
      T(cmds, fld[0], c.x + 6, fy, 3.6, P.ink500, 'F1');
      RF(cmds, c.x + c.w * 0.42, fy + 2.5, c.w * 0.52, 8, P.ink50); RS(cmds, c.x + c.w * 0.42, fy + 2.5, c.w * 0.52, 8, P.ink200, 0.4);
      T(cmds, fld[1], c.x + c.w * 0.42 + 3, fy - 3.2, 3.6, P.ink700, 'F1');
    });
    y -= sh + 5;
  });
  RF(cmds, c.x, y, 40, 10, P.gold500);
  T(cmds, 'Save changes', c.x + 4, y - 7, 3.9, P.ink950, 'F2');
}

const ARCH = {
  login: archLogin,
  dashboard: archDashboard,
  register: archRegister,
  table: archTable,
  cards: archCards,
  devices: archDevices,
  chat: archChat,
  form: archForm,
};

// ─── Public: draw one screen mockup inside box ────────────────────────────────
export function drawScreenMockup(cmds, box, spec) {
  if (spec.arch === 'login') { archLogin(cmds, box, spec); return; }
  const content = drawChrome(cmds, box, spec);
  const fn = ARCH[spec.arch] || archDashboard;
  fn(cmds, content, spec);
}

// ─── Chapter figure map (chapter number -> screen spec) ───────────────────────
// `nav` highlights the matching sidebar item; `page` shows in the top bar.
export const FIGURES = {
  2: { key: 'signin', arch: 'login', page: 'Sign In' },
  3: { key: 'overview', arch: 'dashboard', nav: 'POS Terminal', page: 'Overview', sub: "Today at a glance", stats: [["Today's sales", '₦486,200', '▲ 12.4%'], ['Orders', '214', '▲ 6.1%'], ['Avg order', '₦2,271', '▲ 3.0%'], ['Refunds', '₦8,140', '▼ 2.2%']], lineTitle: 'Sales · last 14 days', barsTitle: 'Top categories' },
  4: { key: 'register', arch: 'register', nav: 'POS Terminal', page: 'POS Terminal' },
  5: { key: 'orders', arch: 'table', nav: 'Orders', page: 'Orders', sub: 'Every sale and its lifecycle', action: 'Export', columns: [{ label: 'Order', w: 1.4 }, { label: 'Customer', w: 1.6 }, { label: 'Channel', w: 1.2 }, { label: 'Total', w: 1 }, { label: 'Status', w: 1.2 }], rows: [['#10482', 'Ada Okafor', 'In-store', '₦8,450', { text: 'PAID', pill: true }], ['#10481', 'Guest', 'Delivery', '₦12,300', { text: 'READY', pill: true }], ['#10480', 'Chidi Eze', 'Online', '₦5,120', { text: 'PAID', pill: true }], ['#10479', 'Amara N.', 'Pickup', '₦3,980', { text: 'REFUNDED', pill: true }], ['#10478', 'Guest', 'In-store', '₦2,150', { text: 'PAID', pill: true }], ['#10477', 'Tunde B.', 'Online', '₦17,640', { text: 'PAID', pill: true }]] },
  6: { key: 'catalog', arch: 'cards', nav: 'Catalog', page: 'Catalog', sub: 'Products, variants & bundles', cols: 4, cardH: 30, cards: [{ title: 'Espresso', metric: '₦1,200', note: 'Simple · Drinks', accent: P.gold400 }, { title: 'Cappuccino', metric: '₦1,800', note: 'Variant · Size', accent: P.gold400 }, { title: 'Croissant', metric: '₦900', note: 'Simple · Food', accent: P.ink200 }, { title: 'Gift Hamper', metric: '₦24,000', note: 'Bundle · 6 items', accent: P.ink200 }, { title: 'Cold Brew', metric: '₦2,100', note: 'Variant · Size', accent: P.gold400 }, { title: 'Avocado Toast', metric: '₦2,600', note: 'Selection', accent: P.ink200 }, { title: 'Fresh Juice', metric: '₦1,500', note: 'Open price', accent: P.ink200 }, { title: 'Cookie Box', metric: '₦3,200', note: 'Bundle · 12', accent: P.ink200 }] },
  7: { key: 'inventory', arch: 'table', nav: 'Inventory', page: 'Inventory', sub: 'Stock across locations', action: 'Adjust', columns: [{ label: 'Product', w: 1.6 }, { label: 'SKU', w: 1.2 }, { label: 'On hand', w: 0.9 }, { label: 'Available', w: 0.9 }, { label: 'Status', w: 1.1 }], rows: [['Espresso beans 1kg', 'ESP-1K', '42', '38', { text: 'OK', pill: true }], ['Whole milk 2L', 'MLK-2L', '6', '6', { text: 'LOW', pill: true, color: P.ink100 }], ['Oat milk 1L', 'OAT-1L', '0', '0', { text: 'OUT', pill: true, color: P.ink100 }], ['Paper cup 12oz', 'CUP-12', '1,240', '1,180', { text: 'OK', pill: true }], ['Croissant', 'CRS-01', '18', '14', { text: 'LOW', pill: true, color: P.ink100 }]] },
  8: { key: 'purchasing', arch: 'table', nav: 'Purchasing', page: 'Purchasing', sub: 'Purchase orders & suppliers', action: 'New PO', columns: [{ label: 'PO', w: 1.2 }, { label: 'Supplier', w: 1.6 }, { label: 'Items', w: 0.8 }, { label: 'Total', w: 1 }, { label: 'Status', w: 1.2 }], rows: [['PO-2291', 'Lagos Roasters', '6', '₦184,000', { text: 'SENT', pill: true }], ['PO-2290', 'DairyFresh Ltd', '4', '₦96,500', { text: 'PARTIAL', pill: true }], ['PO-2289', 'PackPro NG', '9', '₦210,300', { text: 'RECEIVED', pill: true }], ['PO-2288', 'Golden Bakery', '3', '₦48,200', { text: 'DRAFT', pill: true, color: P.ink100 }]] },
  9: { key: 'customers', arch: 'table', nav: 'Customers', page: 'Customers', sub: 'Customer 360 view', action: 'Add', columns: [{ label: 'Name', w: 1.5 }, { label: 'Email', w: 1.8 }, { label: 'Orders', w: 0.8 }, { label: 'Lifetime', w: 1 }, { label: 'Tier', w: 1 }], rows: [['Ada Okafor', 'ada@mail.com', '34', '₦412,800', { text: 'GOLD', pill: true }], ['Chidi Eze', 'chidi@mail.com', '21', '₦206,400', { text: 'SILVER', pill: true, color: P.ink100 }], ['Amara Nwosu', 'amara@mail.com', '12', '₦98,300', { text: 'SILVER', pill: true, color: P.ink100 }], ['Tunde Bakare', 'tunde@mail.com', '48', '₦640,100', { text: 'GOLD', pill: true }]] },
  10: { key: 'loyalty', arch: 'cards', nav: 'Loyalty', page: 'Loyalty & Rewards', sub: 'Programs, points & stored value', cols: 3, cardH: 36, cards: [{ title: 'Active members', metric: '3,842', note: '▲ 214 this month', accent: P.gold400 }, { title: 'Points issued', metric: '1.24M', note: 'Redemption 38%', accent: P.ink200 }, { title: 'Gift card balance', metric: '₦2.86M', note: 'Across 940 cards', accent: P.ink200 }, { title: 'Rewards live', metric: '12', note: '3 tiers configured', accent: P.gold400 }, { title: 'Repeat rate', metric: '46%', note: '▲ 4 pts QoQ', accent: P.gold400 }, { title: 'Stored-value txns', metric: '1,105', note: 'Full ledger kept', accent: P.ink200 }] },
  11: { key: 'marketing', arch: 'dashboard', nav: 'Marketing', page: 'Marketing', sub: 'Campaigns, segments & RFM', stats: [['Campaigns live', '7', '▲ 2'], ['Reach', '18,400', '▲ 9%'], ['Redemptions', '1,240', '▲ 14%'], ['Attributed rev.', '₦3.2M', '▲ 21%']], lineTitle: 'Campaign revenue', barsTitle: 'RFM segments' },
  12: { key: 'commerce', arch: 'cards', nav: 'Commerce Hub', page: 'Commerce Hub', sub: 'Channels & online orders', cols: 3, cardH: 34, cards: [{ title: 'Online store', metric: '₦1.4M', note: 'Live · 62 orders/day', pill: 'LIVE', accent: P.gold400 }, { title: 'Marketplace', metric: '₦820K', note: 'Connected · synced', pill: 'LIVE', accent: P.gold400 }, { title: 'Delivery apps', metric: '₦410K', note: '2 integrations', pill: 'LIVE', accent: P.ink200 }, { title: 'Pickup', metric: '148', note: 'Ready-for-pickup flow', accent: P.ink200 }, { title: 'Shipping', metric: '96', note: 'Labels generated', accent: P.ink200 }, { title: 'Omnichannel stock', metric: 'Synced', note: 'No oversell', pill: 'OK', accent: P.gold400 }] },
  14: { key: 'payments', arch: 'table', nav: 'Payments', page: 'Payments', sub: 'Tenders, gateways & payouts', action: 'Pay link', columns: [{ label: 'Reference', w: 1.4 }, { label: 'Method', w: 1.2 }, { label: 'Amount', w: 1 }, { label: 'Settled', w: 0.9 }, { label: 'Status', w: 1.1 }], rows: [['pay_9f2a', 'Card · Visa', '₦8,450', 'Yes', { text: 'CAPTURED', pill: true }], ['pay_9f2b', 'Cash', '₦2,150', '—', { text: 'PAID', pill: true }], ['pay_9f2c', 'Gift card', '₦5,000', '—', { text: 'PAID', pill: true }], ['pay_9f2d', 'Card · Verve', '₦12,300', 'No', { text: 'PENDING', pill: true, color: P.ink100 }], ['pay_9f2e', 'Transfer', '₦17,640', 'Yes', { text: 'CAPTURED', pill: true }]] },
  15: { key: 'accounting', arch: 'table', nav: 'Accounting', page: 'Accounting', sub: 'Entries & reconciliation', action: 'Export', columns: [{ label: 'Date', w: 1 }, { label: 'Account', w: 1.6 }, { label: 'Ref', w: 1.1 }, { label: 'Debit', w: 0.9 }, { label: 'Credit', w: 0.9 }], rows: [['16 Sep', 'Sales revenue', 'ORD-10482', '—', '₦8,450'], ['16 Sep', 'Card clearing', 'pay_9f2a', '₦8,450', '—'], ['16 Sep', 'VAT payable', 'TAX-0916', '—', '₦634'], ['15 Sep', 'Inventory', 'PO-2289', '₦210,300', '—'], ['15 Sep', 'Accounts payable', 'PO-2289', '—', '₦210,300']] },
  16: { key: 'employees', arch: 'table', nav: 'Employees', page: 'Employees & Roles', sub: 'Staff, permissions & time', action: 'Invite', columns: [{ label: 'Name', w: 1.4 }, { label: 'Role', w: 1.2 }, { label: 'Location', w: 1.3 }, { label: 'Hours', w: 0.8 }, { label: 'Status', w: 1 }], rows: [['Ada Okafor', 'Owner', 'Main Store', '—', { text: 'ACTIVE', pill: true }], ['Tunde Bakare', 'Manager', 'Main Store', '38h', { text: 'ACTIVE', pill: true }], ['Chidi Eze', 'Cashier', 'Branch 2', '32h', { text: 'ACTIVE', pill: true }], ['Amara Nwosu', 'Cashier', 'Main Store', '28h', { text: 'ON LEAVE', pill: true, color: P.ink100 }]] },
  17: { key: 'hardware', arch: 'devices', nav: 'Hardware', page: 'Register Hardware' },
  18: { key: 'sync', arch: 'table', nav: 'Offline & Sync', page: 'Offline & Sync', sub: 'Queue, devices & history', action: 'Force sync', columns: [{ label: 'Seq', w: 0.9 }, { label: 'Device', w: 1.4 }, { label: 'Queued', w: 1 }, { label: 'Type', w: 1.1 }, { label: 'Outcome', w: 1.2 }], rows: [['4,812', 'Register 1', '20:04:59', 'Sale', { text: 'SYNCED', pill: true }], ['4,813', 'Register 2', '20:05:14', 'Refund', { text: 'SYNCED', pill: true }], ['4,814', 'Kiosk A', '20:06:07', 'Sale', { text: 'PENDING', pill: true, color: P.ink100 }], ['4,815', 'Register 1', '20:06:59', 'Adjust', { text: 'SYNCED', pill: true }]] },
  19: { key: 'reports', arch: 'dashboard', nav: 'Reports', page: 'Reports & Analytics', sub: 'Sales, inventory & tax', stats: [['Gross sales', '₦14.2M', '▲ 8.7%'], ['Net sales', '₦12.9M', '▲ 7.2%'], ['COGS', '₦5.1M', '▼ 1.4%'], ['Gross margin', '60.4%', '▲ 2.1%']], lineTitle: 'Revenue by period', barsTitle: 'Sales by location' },
  20: { key: 'ai', arch: 'chat', nav: 'AI Insights', page: 'AI Insights & Copilot' },
  22: { key: 'compliance', arch: 'table', nav: 'Compliance', page: 'Compliance Center', sub: 'Consent, requests & records', action: 'Export', columns: [{ label: 'Subject', w: 1.5 }, { label: 'Type', w: 1.3 }, { label: 'Received', w: 1 }, { label: 'Status', w: 1.1 }], rows: [['ada@mail.com', 'Data export', '14 Sep', { text: 'FULFILLED', pill: true }], ['chidi@mail.com', 'Consent · marketing', '15 Sep', { text: 'GRANTED', pill: true }], ['guest-1029', 'Deletion request', '16 Sep', { text: 'IN REVIEW', pill: true, color: P.ink100 }], ['amara@mail.com', 'Consent · cookies', '16 Sep', { text: 'GRANTED', pill: true }]] },
  23: { key: 'enterprise', arch: 'cards', nav: 'Enterprise', page: 'Enterprise & Multi-Region', sub: 'Locations, regions & coverage', cols: 3, cardH: 34, cards: [{ title: 'Locations', metric: '18', note: 'Under 1 organization', accent: P.gold400 }, { title: 'Regions', metric: '4', note: 'Data residency set', pill: 'LIVE', accent: P.gold400 }, { title: 'Countries', metric: '6', note: 'Local tax & currency', accent: P.ink200 }, { title: 'Warehouses', metric: '5', note: 'Stock synchronized', accent: P.ink200 }, { title: 'Coverage', metric: '99.9%', note: 'Regional uptime', pill: 'OK', accent: P.gold400 }, { title: 'Policies', metric: 'Global', note: 'Local overrides on', accent: P.ink200 }] },
  24: { key: 'developer', arch: 'cards', nav: 'Developer', page: 'Developer Platform', sub: 'API keys, webhooks & OAuth', cols: 2, cardH: 34, cards: [{ title: 'API keys', metric: '3 active', note: 'Public + secret pairs', pill: 'LIVE', accent: P.gold400 }, { title: 'Webhooks', metric: '7 events', note: 'Signature verified', accent: P.ink200 }, { title: 'OAuth apps', metric: '2', note: 'Third-party access', accent: P.ink200 }, { title: 'Integrations', metric: '24', note: 'Payments · accounting · more', pill: 'CATALOG', accent: P.gold400 }] },
  25: { key: 'system', arch: 'dashboard', nav: 'System', page: 'System & Observability', sub: 'Health, metrics & backups', stats: [['Uptime', '99.98%', '30-day'], ['p95 latency', '142ms', '▼ 8ms'], ['Error rate', '0.03%', '▼ 0.01%'], ['Last backup', '2h ago', 'Healthy']], lineTitle: 'Request latency', barsTitle: 'Error budget' },
  26: { key: 'settings', arch: 'form', nav: 'Settings', page: 'Settings' },
};
