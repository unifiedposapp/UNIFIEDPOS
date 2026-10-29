/**
 * Custom report builder (§31 reporting).
 *
 * Every competitor lets an operator build a report without a developer, and
 * every one of them has had a SQL-injection incident doing it. The safe pattern
 * (used here) is a closed vocabulary: a fixed set of sources, each with an
 * explicit column list; grouping, filtering, sorting and CSV rendering all
 * operate on those declared columns only, over rows the route already fetched
 * with a Prisma `select`. There is no string SQL anywhere, so a report
 * definition cannot reach a table it was not granted.
 *
 * Pure: no Prisma, no I/O. The route maps `source` → a Prisma query and hands
 * the rows in.
 */

export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

export interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  /** Numeric columns are summable; the builder never sums a string. */
  summable?: boolean;
}

export interface SourceDef {
  label: string;
  columns: ColumnDef[];
}

/**
 * The closed vocabulary. Adding a source means adding a fetch in the route AND
 * declaring it here — the builder refuses anything it has not been told about.
 */
export const REPORT_SOURCES: Record<string, SourceDef> = {
  SALES: {
    label: 'Sales (paid orders)',
    columns: [
      { key: 'orderNumber', label: 'Order', type: 'string' },
      { key: 'channel', label: 'Channel', type: 'string' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'currency', label: 'Currency', type: 'string' },
      { key: 'subtotal', label: 'Subtotal', type: 'number', summable: true },
      { key: 'discountAmount', label: 'Discount', type: 'number', summable: true },
      { key: 'taxAmount', label: 'Tax', type: 'number', summable: true },
      { key: 'tipAmount', label: 'Tips', type: 'number', summable: true },
      { key: 'totalAmount', label: 'Total', type: 'number', summable: true },
      { key: 'createdAt', label: 'Created', type: 'date' },
    ],
  },
  ORDERS: {
    label: 'Order lines',
    columns: [
      { key: 'orderNumber', label: 'Order', type: 'string' },
      { key: 'productName', label: 'Product', type: 'string' },
      { key: 'quantity', label: 'Qty', type: 'number', summable: true },
      { key: 'uom', label: 'Unit', type: 'string' },
      { key: 'unitPrice', label: 'Unit price', type: 'number', summable: true },
      { key: 'discountAmt', label: 'Discount', type: 'number', summable: true },
      { key: 'totalAmount', label: 'Line total', type: 'number', summable: true },
    ],
  },
  PRODUCTS: {
    label: 'Products',
    columns: [
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'sku', label: 'SKU', type: 'string' },
      { key: 'barcode', label: 'Barcode', type: 'string' },
      { key: 'unitOfMeasure', label: 'Unit', type: 'string' },
      { key: 'price', label: 'Price', type: 'number', summable: true },
      { key: 'costPrice', label: 'Cost', type: 'number', summable: true },
      { key: 'isActive', label: 'Active', type: 'boolean' },
    ],
  },
  INVENTORY: {
    label: 'Inventory balances',
    columns: [
      { key: 'productName', label: 'Product', type: 'string' },
      { key: 'locationName', label: 'Location', type: 'string' },
      { key: 'quantity', label: 'On hand', type: 'number', summable: true },
      { key: 'reorderPoint', label: 'Reorder point', type: 'number', summable: false },
    ],
  },
  PAYMENTS: {
    label: 'Payments',
    columns: [
      { key: 'method', label: 'Method', type: 'string' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'provider', label: 'Provider', type: 'string' },
      { key: 'amount', label: 'Amount', type: 'number', summable: true },
      { key: 'tipAmount', label: 'Tip', type: 'number', summable: true },
      { key: 'createdAt', label: 'Created', type: 'date' },
    ],
  },
  LABOR: {
    label: 'Labour (time entries)',
    columns: [
      { key: 'employeeName', label: 'Employee', type: 'string' },
      { key: 'hours', label: 'Hours', type: 'number', summable: true },
      { key: 'date', label: 'Date', type: 'date' },
    ],
  },
  TIPS: {
    label: 'Tips',
    columns: [
      { key: 'employeeName', label: 'Employee', type: 'string' },
      { key: 'amount', label: 'Amount', type: 'number', summable: true },
      { key: 'type', label: 'Type', type: 'string' },
      { key: 'createdAt', label: 'Created', type: 'date' },
    ],
  },
  CUSTOMERS: {
    label: 'Customers',
    columns: [
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'email', label: 'Email', type: 'string' },
      { key: 'totalSpent', label: 'Lifetime spend', type: 'number', summable: true },
      { key: 'lifetimePoints', label: 'Lifetime points', type: 'number', summable: true },
      { key: 'createdAt', label: 'Joined', type: 'date' },
    ],
  },
  LOYALTY: {
    label: 'Loyalty transactions',
    columns: [
      { key: 'customerName', label: 'Customer', type: 'string' },
      { key: 'points', label: 'Points', type: 'number', summable: true },
      { key: 'reason', label: 'Reason', type: 'string' },
      { key: 'createdAt', label: 'Created', type: 'date' },
    ],
  },
};

export interface ReportDefinitionInput {
  source: string;
  columns: string[];
  filters?: Record<string, unknown> | null;
  groupBy?: string | null;
  sortBy?: string | null;
  sortDir?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Reject unknown sources/columns/group keys before anything is fetched. */
export function validateDefinition(def: ReportDefinitionInput): ValidationResult {
  const errors: string[] = [];
  const source = REPORT_SOURCES[String(def.source ?? '').toUpperCase()];
  if (!source) {
    return { ok: false, errors: [`Unknown source "${def.source}"`] };
  }

  const allowed = new Set(source.columns.map((c) => c.key));
  const cols = def.columns ?? [];
  if (cols.length === 0) errors.push('At least one column is required');

  for (const c of cols) {
    if (!allowed.has(c)) errors.push(`Unknown column "${c}" for ${def.source}`);
  }

  if (def.groupBy && !allowed.has(def.groupBy)) {
    errors.push(`Unknown groupBy "${def.groupBy}"`);
  }
  if (def.sortBy && !allowed.has(def.sortBy)) {
    errors.push(`Unknown sortBy "${def.sortBy}"`);
  }
  if (def.sortDir && !['asc', 'desc'].includes(String(def.sortDir).toLowerCase())) {
    errors.push('sortDir must be asc or desc');
  }

  // Filters arrive as a FilterSet — operator → { column: value } — so the column
  // names live one level down. Validating the operator keys themselves would
  // reject every filtered report with `Unknown filter column "eq"`.
  const OPERATORS = new Set(['eq', 'ne', 'gte', 'lte', 'in', 'contains']);
  for (const [op, conditions] of Object.entries((def.filters ?? {}) as Record<string, unknown>)) {
    if (!OPERATORS.has(op)) {
      errors.push(`Unknown filter operator "${op}"`);
      continue;
    }
    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
      errors.push(`Filter "${op}" must map column names to values`);
      continue;
    }
    for (const key of Object.keys(conditions as Record<string, unknown>)) {
      if (!allowed.has(key)) errors.push(`Unknown filter column "${key}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Filter operators understood by every source. */
export interface FilterSet {
  eq?: Record<string, unknown>;
  ne?: Record<string, unknown>;
  gte?: Record<string, unknown>;
  lte?: Record<string, unknown>;
  in?: Record<string, unknown[]>;
  contains?: Record<string, unknown>;
}

function matches(row: Record<string, unknown>, filters: FilterSet): boolean {
  for (const [k, v] of Object.entries(filters.eq ?? {})) if (row[k] !== v) return false;
  for (const [k, v] of Object.entries(filters.ne ?? {})) if (row[k] === v) return false;

  for (const [k, v] of Object.entries(filters.gte ?? {})) {
    const a = row[k];
    if (a === null || a === undefined || Number(a) < Number(v)) return false;
  }
  for (const [k, v] of Object.entries(filters.lte ?? {})) {
    const a = row[k];
    if (a === null || a === undefined || Number(a) > Number(v)) return false;
  }
  for (const [k, list] of Object.entries(filters.in ?? {})) {
    if (!(list ?? []).includes(row[k])) return false;
  }
  for (const [k, v] of Object.entries(filters.contains ?? {})) {
    if (!String(row[k] ?? '').toLowerCase().includes(String(v ?? '').toLowerCase())) return false;
  }
  return true;
}

export interface AggregateResult {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  totals: Record<string, number>;
  matchedRows: number;
  truncated: boolean;
}

export interface BuildOptions {
  limit?: number;
  /** Numeric columns to sum when grouping. Defaults to the selected summable ones. */
  sumColumns?: string[];
}

/**
 * Apply filters, grouping, totals, sort and limit.
 *
 * Ungrouped output keeps the source order (the route already sorts by date) and
 * carries grand totals. Grouped output returns one row per distinct group key
 * with summed numeric columns plus `count`.
 */
export function buildReport(def: ReportDefinitionInput, rows: Record<string, unknown>[], options: BuildOptions = {}): AggregateResult {
  const source = REPORT_SOURCES[String(def.source ?? '').toUpperCase()];
  if (!source) return { columns: [], rows: [], totals: {}, matchedRows: 0, truncated: false };

  const selected = source.columns.filter((c) => (def.columns ?? []).includes(c.key));
  const filters = (def.filters ?? {}) as FilterSet;
  const limit = Math.min(Math.max(Number(options.limit) || 5000, 1), 20000);

  const matched = (rows ?? []).filter((r) => matches(r, filters));
  const summable = selected.filter((c) => c.summable).map((c) => c.key);

  if (!def.groupBy) {
    let out = matched.map((r) => {
      const row: Record<string, unknown> = {};
      for (const c of selected) row[c.key] = r[c.key] ?? null;
      return row;
    });

    if (def.sortBy) {
      const dir = String(def.sortDir ?? 'desc').toLowerCase() === 'asc' ? 1 : -1;
      out = out.sort((a, b) => {
        const av = a[def.sortBy as string];
        const bv = b[def.sortBy as string];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }

    const totals: Record<string, number> = {};
    for (const key of options.sumColumns ?? summable) {
      totals[key] = Math.round(matched.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;
    }

    return {
      columns: selected,
      rows: out.slice(0, limit),
      totals,
      matchedRows: matched.length,
      truncated: out.length > limit,
    };
  }

  // Grouped: key → accumulator.
  const groupKey = String(def.groupBy);
  const groupColumn = source.columns.find((c) => c.key === groupKey);
  const groups = new Map<string, { key: unknown; count: number; sums: Record<string, number> }>();

  for (const r of matched) {
    const raw = r[groupKey];
    const label = raw === null || raw === undefined ? '(blank)' : String(raw);
    const g = groups.get(label) ?? { key: raw ?? null, count: 0, sums: {} };
    g.count += 1;
    for (const s of summable) g.sums[s] = (g.sums[s] ?? 0) + (Number(r[s]) || 0);
    groups.set(label, g);
  }

  const outRows = [...groups.values()].map((g) => {
    const row: Record<string, unknown> = { [groupKey]: g.key, count: g.count };
    for (const s of summable) row[s] = Math.round((g.sums[s] ?? 0) * 100) / 100;
    return row;
  });

  const dir = String(def.sortDir ?? 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const sortKey = def.sortBy ?? 'count';
  outRows.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
  });

  const totals: Record<string, number> = {};
  for (const s of summable) {
    totals[s] = Math.round(matched.reduce((s2, r) => s2 + (Number(r[s]) || 0), 0) * 100) / 100;
  }

  const columns: ColumnDef[] = [
    ...(groupColumn ? [groupColumn] : [{ key: groupKey, label: groupKey, type: 'string' as ColumnType }]),
    { key: 'count', label: 'Count', type: 'number', summable: true },
    ...selected.filter((c) => c.key !== groupKey && c.summable),
  ];

  return {
    columns,
    rows: outRows.slice(0, limit),
    totals,
    matchedRows: matched.length,
    truncated: outRows.length > limit,
  };
}

/** RFC 4180 CSV with quoting, so a comma in a product name cannot break a column. */
export function toCsv(columns: ColumnDef[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = (rows ?? []).map((r) => columns.map((c) => escape(r[c.key])).join(','));
  return [header, ...body].join('\r\n');
}
