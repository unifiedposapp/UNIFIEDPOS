import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Response-shape contract guardrail ───────────────────────────────────────
// Some list endpoints are PAGINATED: the server returns
//   { success: true, data: { items: [...], total, page, pageSize, ... } }
// — so the array lives at `res.data.items`, NOT `res.data`. Assigning the
// paginated object straight into an array-typed state and then calling
// `.map` / `.filter` on it throws ("... is not a function"), which — because a
// page render error unmounts the whole React tree — shows up as a BLANK WHITE
// PAGE with a healthy-looking URL. That exact bug took down the Barcode Labels
// and Purchasing screens.
//
// These are static source checks (the unit-test env is `node`, no DOM): they
// cannot catch every future variant, but they lock the two shapes that actually
// broke and alert a maintainer whenever the server contract shifts under us.

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..', '..');
const WEB_SRC = path.join(REPO, 'packages', 'web', 'src');

/** Client methods whose endpoint returns the paginated `{ data: { items } }` shape. */
const PAGINATED_METHODS = ['getProducts', 'getCustomers'] as const;
/** React state setters that must receive a real array from those methods. */
const ARRAY_SETTERS = ['setProducts', 'setCustomers'] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

describe('paginated-response shape contract', () => {
  it('server keeps the paginated { data: { items } } shape consumers rely on', () => {
    // inventory.ts → /inventory/products ; customers.ts → /customers
    const inventory = fs.readFileSync(path.join(REPO, 'packages/server/src/routes/inventory.ts'), 'utf8');
    const customers = fs.readFileSync(path.join(REPO, 'packages/server/src/routes/customers.ts'), 'utf8');
    expect(inventory).toMatch(/data:\s*\{\s*items/);
    expect(customers).toMatch(/data:\s*\{\s*items/);
  });

  it('never feeds a bare paginated .data into an array state setter', () => {
    // e.g. `setProducts(prodRes.data || [])` or `setCustomers(res.data.map(...))`
    // — the `.data` must be followed by `.items` / `?.items`.
    const setterRe = new RegExp(`\\b(?:${ARRAY_SETTERS.join('|')})\\(\\s*[A-Za-z_$][\\w$]*\\.data(?!\\s*(?:\\?\\.|\\.)items)`, 'g');
    const violations: string[] = [];
    for (const file of walk(WEB_SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(setterRe)) {
        violations.push(`${path.relative(REPO, file)}:${lineOf(src, m.index ?? 0)}  ${m[0].trim()}`);
      }
    }
    expect(violations, `Paginated .data used as an array (use .data.items):\n${violations.join('\n')}`).toEqual([]);
  });

  it('never dereferences .data off an inline paginated api call without .items', () => {
    // e.g. `(await api.getProducts()).data || []` — must be `.data?.items`.
    const inlineRe = new RegExp(`api\\.(?:${PAGINATED_METHODS.join('|')})\\([^()]*\\)\\)?\\.data(?!\\s*(?:\\?\\.|\\.)items)`, 'g');
    const violations: string[] = [];
    for (const file of walk(WEB_SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(inlineRe)) {
        violations.push(`${path.relative(REPO, file)}:${lineOf(src, m.index ?? 0)}  ${m[0].trim()}`);
      }
    }
    expect(violations, `Inline paginated call read as .data (use .data.items):\n${violations.join('\n')}`).toEqual([]);
  });
});
