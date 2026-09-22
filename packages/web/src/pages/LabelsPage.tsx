import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as JsBarcodeModule from 'jsbarcode';
import { api } from '../api/client';
import { buildLabelBatch, type LabelData } from '../services/escpos';
import { hardware } from '../services/hardware';
import { Tags, Printer, Search, Check, X, Save, Usb, Info } from 'lucide-react';

// ─── Barcode label sheets ────────────────────────────────────────────────────
// Print real shelf labels from the catalog. Codes come from the server: a
// product that already carries a manufacturer code prints that one; a product
// without one gets a deterministic EAN-13 from the GS1 in-store range, which
// can be saved back onto the catalog so a reprint is byte-identical.
//
// Two output paths, because shops have both: a laser/inkjet sheet on A4
// (browser print, CSS grid sized in millimetres) and a roll of thermal labels
// (ESC/POS bytes straight to the connected printer).

const JsBarcode: any = (JsBarcodeModule as any).default ?? JsBarcodeModule;

interface LabelRow {
  productId: string;
  name: string;
  sku: string | null;
  barcode: string;
  symbology: 'EAN13' | 'CODE128';
  price: number;
  costPrice: number | null;
  currency: string;
  taxPercent: number | null;
  categoryName: string | null;
  productType: string;
}

const TEMPLATES = {
  SMALL: { label: 'Small 70 × 38 mm', columns: 'repeat(3, 1fr)', cell: 'min-h-[38mm]', perRow: 3 },
  MEDIA: { label: 'Medium 70 × 50 mm', columns: 'repeat(2, 1fr)', cell: 'min-h-[50mm]', perRow: 2 },
  LARGE: { label: 'Large 105 × 74 mm', columns: 'repeat(2, 1fr)', cell: 'min-h-[74mm]', perRow: 2 },
} as const;
type TemplateKey = keyof typeof TEMPLATES;

const ESCPOS_SIZES = { SMALL: 'SMALL', MEDIA: 'MEDIUM', LARGE: 'LARGE' } as const;

export default function LabelsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [copies, setCopies] = useState('2');
  const [template, setTemplate] = useState<TemplateKey>('SMALL');
  const [showPrice, setShowPrice] = useState(true);
  const [showTax, setShowTax] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [persist, setPersist] = useState(true);
  const [labels, setLabels] = useState<LabelRow[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [prods, cats] = await Promise.all([api.getProducts(), api.getCategories()]);
    setProducts(prods.data || []);
    setCategories(cats.data || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return products.filter(
      (p) =>
        (!term || p.name.toLowerCase().includes(term) || (p.sku || '').toLowerCase().includes(term) || (p.barcode || '').includes(term)) &&
        (!categoryId || p.categoryId === categoryId) &&
        (!missingOnly || !p.barcode)
    );
  }, [products, search, categoryId, missingOnly]);

  const toggleAll = (value: boolean) => setSelected(value ? new Set(filtered.map((p) => p.id)) : new Set());

  const generate = async () => {
    if (!selected.size) {
      setNotice('Pick at least one product first.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const res = await api.buildLabels({
        productIds: [...selected],
        copies: Math.max(1, Number(copies) || 1),
        persistBarcodes: persist,
      });
      setLabels(res.data?.labels || []);
      setMeta(res.data);
      if (res.data?.generatedCodes) setNotice(`${res.data.generatedCodes} product(s) had no code; a stable in-store EAN-13 was generated${res.data.saved ? ' and saved to the catalog' : ''}.`);
    } catch (e: any) {
      setNotice(e?.message || 'Could not build the labels.');
    } finally {
      setBusy(false);
    }
  };

  const toLabelData = useCallback(
    (row: LabelRow): LabelData => ({
      name: row.name,
      price: showPrice ? row.price : null,
      currencySymbol: currencySymbol(row.currency),
      sku: showSku ? row.sku : null,
      barcode: row.barcode,
      storeName: meta?.storeName || undefined,
      category: showTax && row.taxPercent ? `${row.taxPercent}% incl.` : row.categoryName || undefined,
    }),
    [showPrice, showSku, showTax, meta]
  );

  const printThermal = async () => {
    if (!labels?.length) return;
    setBusy(true);
    setNotice('');
    try {
      const bytes = buildLabelBatch(
        labels.map(toLabelData),
        { width: 32, size: ESCPOS_SIZES[template] as any }
      );
      await hardware.write(bytes);
      setNotice(`Sent ${labels.length} label(s) to the connected printer.`);
    } catch (e: any) {
      setNotice(e?.message || 'No thermal printer is connected. Pair one under Hardware first.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink-900">
            <Tags size={22} className="text-gold-500" /> Barcode labels
          </h1>
          <p className="text-sm text-ink-400">Print shelf-edge labels for the catalog — on paper or on the label roll.</p>
        </div>
        <div className="flex gap-2">
          {labels?.length ? (
            <>
              <button onClick={printThermal} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50">
                <Usb size={15} /> Thermal printer
              </button>
              <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800">
                <Printer size={15} /> Print sheet ({labels.length})
              </button>
            </>
          ) : null}
        </div>
      </header>

      {notice && <div className="flex items-start gap-2 rounded-lg border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700 print:hidden"><Info size={15} className="mt-0.5 shrink-0" /> {notice}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] print:hidden">
        {/* Product picker */}
        <div className="rounded-xl border border-ink-100 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 p-3">
            <div className="relative min-w-[200px] flex-1">
              <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-300" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products, SKUs, codes" className="w-full rounded-lg border border-ink-200 py-2 ps-9 pe-3 text-sm outline-none focus:border-ink-400" />
            </div>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-lg border border-ink-200 px-2 py-2 text-sm">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink-600">
              <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> No barcode yet
            </label>
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {filtered.map((p) => {
              const on = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.id)) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                  className={`flex w-full items-center gap-3 border-b border-ink-50 px-3 py-2 text-start text-sm ${on ? 'bg-gold-50/60' : 'hover:bg-ink-50'}`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-gold-500 bg-gold-500 text-white' : 'border-ink-300'}`}>
                    {on && <Check size={13} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-900">{p.name}</span>
                    <span className="block truncate text-xs text-ink-400">
                      {p.sku}
                      {p.barcode ? ` · ${p.barcode}` : ' · no code'} · {Number(p.stock ?? p.inventory?.reduce?.((s: number, i: any) => s + i.quantity, 0) ?? 0)} in stock
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm text-ink-700">{Number(p.price).toFixed(2)}</span>
                </button>
              );
            })}
            {!filtered.length && <div className="p-8 text-center text-sm text-ink-400">No products match that filter.</div>}
          </div>

          <div className="flex items-center gap-3 border-t border-ink-100 p-3 text-xs text-ink-500">
            <button onClick={() => toggleAll(true)} className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-50">
              Select all ({filtered.length})
            </button>
            <button onClick={() => toggleAll(false)} className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 hover:bg-ink-50">
              <X size={12} /> Clear ({selected.size})
            </button>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3 rounded-xl border border-ink-100 bg-white p-4">
          <h2 className="text-sm font-semibold text-ink-900">Label options</h2>
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-ink-400">Template</span>
            <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateKey)} className="w-full rounded-lg border border-ink-200 px-2 py-2">
              {Object.entries(TEMPLATES).map(([key, t]) => (
                <option key={key} value={key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-ink-400">Copies per product</span>
            <input type="number" min="1" max="50" value={copies} onChange={(e) => setCopies(e.target.value)} className="w-full rounded-lg border border-ink-200 px-2 py-2" />
          </label>
          <Checkline checked={showPrice} onChange={setShowPrice} label="Show price" />
          <Checkline checked={showTax} onChange={setShowTax} label="Show tax note" />
          <Checkline checked={showSku} onChange={setShowSku} label="Show SKU" />
          <Checkline checked={persist} onChange={setPersist} label="Save generated codes to the catalog" />

          <button onClick={generate} disabled={busy || !selected.size} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-gold-400 disabled:opacity-50">
            <Tags size={15} /> Build labels
          </button>
          {labels?.length ? (
            <button onClick={() => setLabels(null)} className="w-full rounded-lg border border-ink-200 px-3 py-2 text-xs text-ink-600 hover:bg-ink-50">
              Clear preview
            </button>
          ) : null}
          <p className="text-[11px] leading-relaxed text-ink-400">
            Products that already carry a code print it unchanged. Missing codes come from the GS1 in-store range (prefix 20) with a real check digit, and are
            deterministic — reprinting the same product always yields the same bars.
          </p>
        </div>
      </div>

      {/* The sheet itself: everything outside it is hidden when printing. */}
      {labels?.length ? (
        <div id="label-sheet" className="rounded-xl border border-ink-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-ink-400 print:hidden">
            <span>
              {labels.length} labels · {meta?.currency}
              {meta?.saved ? ' · codes saved' : ''}
            </span>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded border border-ink-200 px-2 py-1 hover:bg-ink-50">
              <Save size={12} /> Print
            </button>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: TEMPLATES[template].columns }}>
            {labels.map((row, idx) => (
              <LabelCard key={`${row.productId}-${idx}`} row={row} template={template} showPrice={showPrice} showTax={showTax} showSku={showSku} />
            ))}
          </div>
        </div>
      ) : null}

      <style>{`
        @media print {
          body { background: #fff; }
          .print\\:hidden { display: none !important; }
          aside, header[class*="fixed"], nav { display: none !important; }
          main { overflow: visible !important; }
          #label-sheet { border: none !important; padding: 0 !important; }
          @page { margin: 8mm; }
        }
      `}</style>
    </div>
  );
}

function LabelCard({ row, template, showPrice, showTax, showSku }: { row: LabelRow; template: TemplateKey; showPrice: boolean; showTax: boolean; showSku: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, row.barcode, {
        format: row.symbology === 'EAN13' ? 'EAN13' : 'CODE128',
        width: template === 'LARGE' ? 2 : 1.6,
        height: template === 'LARGE' ? 60 : template === 'MEDIA' ? 46 : 36,
        displayValue: false,
        margin: 0,
        lineColor: '#111827',
      });
      setInvalid(false);
    } catch {
      // An EAN-13 field holding letters (a vendor typed something odd) cannot
      // be encoded; say so instead of drawing a wrong bar.
      setInvalid(true);
    }
  }, [row.barcode, row.symbology, template]);

  return (
    <div className={`flex flex-col items-center justify-between break-inside-avoid rounded border border-ink-200 p-2 text-center ${TEMPLATES[template].cell}`}>
      <div className="w-full">
        <div className="truncate text-[13px] font-semibold leading-tight">{row.name}</div>
        {row.categoryName && <div className="truncate text-[10px] text-ink-400">{row.categoryName}</div>}
      </div>
      {showPrice ? (
        <div className="font-display text-xl font-bold leading-none">
          {money(row.price, row.currency)}
          {showTax && row.taxPercent ? <span className="ms-1 align-super text-[9px] font-normal text-ink-400">incl {row.taxPercent}%</span> : null}
        </div>
      ) : (
        <div />
      )}
      <div className="w-full">
        {invalid ? (
          <div className="py-2 text-[10px] text-rose-600">Code not encodable: {row.barcode}</div>
        ) : (
          <svg ref={svgRef} className="mx-auto max-w-full" role="img" aria-label={`Barcode ${row.barcode}`} />
        )}
        <div className="mt-0.5 font-mono text-[10px] tracking-tight">{row.barcode}</div>
        {showSku && row.sku && <div className="text-[9px] text-ink-400">SKU {row.sku}</div>}
      </div>
    </div>
  );
}

function Checkline({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', NGN: '₦', INR: '₹' };
function currencySymbol(code: string) {
  return SYMBOLS[code] || `${code} `;
}
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0);
  } catch {
    return `${(Number(value) || 0).toFixed(2)} ${currency}`;
  }
}
