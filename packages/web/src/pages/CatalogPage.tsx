import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Package, Tags, Percent, SlidersHorizontal, BadgeDollarSign, Boxes, Layers, Combine, RefreshCw, X, Plus, Trash2,
} from 'lucide-react';
import clsx from 'clsx';

type Tab = 'overview' | 'brands' | 'tax' | 'modifiers' | 'priceLists' | 'bundles' | 'kits' | 'composites' | 'variants';

const money = (n: any) => `$${Number(n || 0).toFixed(2)}`;

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const input = 'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none text-sm';
const btnPrimary = 'px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium flex items-center gap-1';

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [overview, setOverview] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [taxRules, setTaxRules] = useState<any[]>([]);
  const [modifierGroups, setModifierGroups] = useState<any[]>([]);
  const [priceLists, setPriceLists] = useState<any[]>([]);
  const [bundles, setBundles] = useState<any[]>([]);
  const [kits, setKits] = useState<any[]>([]);
  const [composites, setComposites] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [variantProductId, setVariantProductId] = useState('');

  // forms
  const [brandForm, setBrandForm] = useState({ name: '', description: '' });
  const [taxForm, setTaxForm] = useState({ name: '', rate: '' });
  const [groupForm, setGroupForm] = useState({ name: '', minSelect: '0', maxSelect: '0' });
  const [modifierForm, setModifierForm] = useState({ name: '', modifierGroupId: '', priceAdj: '' });
  const [priceListForm, setPriceListForm] = useState({ name: '', type: 'RETAIL', description: '' });
  const [bundleForm, setBundleForm] = useState({ name: '', price: '' });
  const [kitForm, setKitForm] = useState({ name: '', description: '' });
  const [compositeForm, setCompositeForm] = useState({ name: '', description: '' });
  const [variantForm, setVariantForm] = useState({ name: '', value: '', priceAdj: '', sku: '' });

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); setLoading(true); await fn(); }
    catch (e: any) { setError(e.message || 'Request failed'); }
    finally { setLoading(false); }
  }, []);

  const loadProducts = useCallback(async () => {
    const res = await api.getProducts();
    setProducts(res.data?.items || []);
  }, []);

  const loadTab = useCallback(async (t: Tab) => {
    await guard(async () => {
      if (t === 'overview') { setOverview((await api.getCatalogOverview()).data); await loadProducts(); }
      if (t === 'brands') setBrands((await api.getBrands()).data || []);
      if (t === 'tax') setTaxRules((await api.getTaxRules()).data || []);
      if (t === 'modifiers') setModifierGroups((await api.getModifierGroups()).data || []);
      if (t === 'priceLists') { setPriceLists((await api.getPriceLists()).data || []); await loadProducts(); }
      if (t === 'bundles') { setBundles((await api.getBundles()).data || []); await loadProducts(); }
      if (t === 'kits') { setKits((await api.getKits()).data || []); await loadProducts(); }
      if (t === 'composites') setComposites((await api.getComposites()).data || []);
      if (t === 'variants') await loadProducts();
    });
  }, [guard, loadProducts]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  async function loadVariants(productId: string) {
    setVariantProductId(productId);
    if (!productId) { setVariants([]); return; }
    setVariants((await api.getVariants(productId)).data || []);
  }

  const reload = () => loadTab(tab);

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: Package },
    { id: 'brands' as Tab, label: 'Brands', icon: Tags },
    { id: 'tax' as Tab, label: 'Tax Rules', icon: Percent },
    { id: 'modifiers' as Tab, label: 'Modifiers', icon: SlidersHorizontal },
    { id: 'priceLists' as Tab, label: 'Price Lists', icon: BadgeDollarSign },
    { id: 'bundles' as Tab, label: 'Bundles', icon: Boxes },
    { id: 'kits' as Tab, label: 'Kits', icon: Layers },
    { id: 'composites' as Tab, label: 'Composites', icon: Combine },
    { id: 'variants' as Tab, label: 'Variants', icon: Package },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Product Catalog</h1>
          <p className="text-gray-500">Brands, variants, modifiers, price lists, tax rules, bundles, kits &amp; composites (§11)</p>
        </div>
        <button onClick={reload} className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('px-3 py-2 rounded-md text-sm font-medium transition flex items-center gap-1.5',
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && overview && (
        <div className="grid grid-cols-4 gap-4">
          {[
            ['Brands', overview.brands], ['Tax Rules', overview.taxRules], ['Modifier Groups', overview.modifierGroups],
            ['Price Lists', overview.priceLists], ['Bundles', overview.bundles], ['Kits', overview.kits],
            ['Composites', overview.composites], ['Variants', overview.variants],
          ].map(([label, val]) => (
            <div key={label as string} className="bg-white rounded-lg border p-4">
              <p className="text-sm text-gray-500">{label}</p>
              <p className="text-2xl font-bold mt-1">{val as number}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'brands' && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="Add Brand">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createBrand(brandForm); setBrandForm({ name: '', description: '' }); reload(); }); }}>
              <input className={input} placeholder="Name" value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} required />
              <input className={input} placeholder="Description" value={brandForm.description} onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })} />
              <button className={btnPrimary}><Plus size={15} /> Create</button>
            </form>
          </Card>
          <div className="col-span-2">
            <Card title={`Brands (${brands.length})`}>
              <div className="space-y-2">
                {brands.map((b) => (
                  <div key={b.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                    <div>
                      <p className="font-medium text-sm">{b.name}</p>
                      <p className="text-xs text-gray-500">{b.description || '—'} · {b._count?.products || 0} products</p>
                    </div>
                    <button onClick={async () => { await api.deleteBrand(b.id); reload(); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                ))}
                {brands.length === 0 && <p className="text-sm text-gray-400">No brands yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'tax' && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="Add Tax Rule">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createTaxRule({ name: taxForm.name, rate: Number(taxForm.rate) }); setTaxForm({ name: '', rate: '' }); reload(); }); }}>
              <input className={input} placeholder="Name (e.g. Standard VAT)" value={taxForm.name} onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })} required />
              <input className={input} type="number" step="0.01" placeholder="Rate %" value={taxForm.rate} onChange={(e) => setTaxForm({ ...taxForm, rate: e.target.value })} required />
              <button className={btnPrimary}><Plus size={15} /> Create</button>
            </form>
          </Card>
          <div className="col-span-2">
            <Card title={`Tax Rules (${taxRules.length})`}>
              <div className="space-y-2">
                {taxRules.map((t) => (
                  <div key={t.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                    <div>
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-gray-500">{Number(t.rate).toFixed(2)}% · {t._count?.products || 0} products</p>
                    </div>
                    <button onClick={async () => { await api.deleteTaxRule(t.id); reload(); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                ))}
                {taxRules.length === 0 && <p className="text-sm text-gray-400">No tax rules yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'modifiers' && (
        <div className="grid grid-cols-2 gap-4">
          <Card title="Add Modifier Group">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createModifierGroup({ name: groupForm.name, minSelect: Number(groupForm.minSelect), maxSelect: Number(groupForm.maxSelect) }); setGroupForm({ name: '', minSelect: '0', maxSelect: '0' }); reload(); }); }}>
              <input className={input} placeholder="Group name (e.g. Size)" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} required />
              <div className="grid grid-cols-2 gap-3">
                <input className={input} type="number" placeholder="Min select" value={groupForm.minSelect} onChange={(e) => setGroupForm({ ...groupForm, minSelect: e.target.value })} />
                <input className={input} type="number" placeholder="Max select" value={groupForm.maxSelect} onChange={(e) => setGroupForm({ ...groupForm, maxSelect: e.target.value })} />
              </div>
              <button className={btnPrimary}><Plus size={15} /> Create Group</button>
            </form>
          </Card>
          <Card title="Add Modifier">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createModifier({ name: modifierForm.name, modifierGroupId: modifierForm.modifierGroupId || undefined, priceAdj: modifierForm.priceAdj ? Number(modifierForm.priceAdj) : undefined }); setModifierForm({ name: '', modifierGroupId: '', priceAdj: '' }); reload(); }); }}>
              <input className={input} placeholder="Modifier name (e.g. Extra Cheese)" value={modifierForm.name} onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })} required />
              <select className={input} value={modifierForm.modifierGroupId} onChange={(e) => setModifierForm({ ...modifierForm, modifierGroupId: e.target.value })}>
                <option value="">No group</option>
                {modifierGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <input className={input} type="number" step="0.01" placeholder="Price adjustment" value={modifierForm.priceAdj} onChange={(e) => setModifierForm({ ...modifierForm, priceAdj: e.target.value })} />
              <button className={btnPrimary}><Plus size={15} /> Create Modifier</button>
            </form>
          </Card>
          <div className="col-span-2">
            <Card title={`Modifier Groups (${modifierGroups.length})`}>
              <div className="space-y-2">
                {modifierGroups.map((g) => (
                  <div key={g.id} className="border rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{g.name} <span className="text-xs text-gray-500">min {g.minSelect} / max {g.maxSelect}</span></p>
                      <button onClick={async () => { await api.deleteModifierGroup(g.id); reload(); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(g.modifiers || []).map((m: any) => (
                        <span key={m.id} className="text-xs bg-gray-100 rounded px-2 py-1">{m.name}{Number(m.priceAdj) !== 0 ? ` (+${money(m.priceAdj)})` : ''}</span>
                      ))}
                      {(g.modifiers || []).length === 0 && <span className="text-xs text-gray-400">No modifiers</span>}
                    </div>
                  </div>
                ))}
                {modifierGroups.length === 0 && <p className="text-sm text-gray-400">No modifier groups yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'priceLists' && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="Add Price List">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createPriceList(priceListForm); setPriceListForm({ name: '', type: 'RETAIL', description: '' }); reload(); }); }}>
              <input className={input} placeholder="Name" value={priceListForm.name} onChange={(e) => setPriceListForm({ ...priceListForm, name: e.target.value })} required />
              <select className={input} value={priceListForm.type} onChange={(e) => setPriceListForm({ ...priceListForm, type: e.target.value })}>
                {['RETAIL', 'WHOLESALE', 'VIP', 'SEASONAL'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className={btnPrimary}><Plus size={15} /> Create</button>
            </form>
          </Card>
          <div className="col-span-2">
            <Card title={`Price Lists (${priceLists.length})`}>
              <div className="space-y-2">
                {priceLists.map((pl) => (
                  <div key={pl.id} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{pl.name} <span className="text-xs bg-gray-100 rounded px-1.5 py-0.5 ml-1">{pl.type}</span></p>
                      <p className="text-xs text-gray-500">{pl._count?.items || 0} priced items</p>
                    </div>
                    <button onClick={async () => { await api.deletePriceList(pl.id); reload(); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                ))}
                {priceLists.length === 0 && <p className="text-sm text-gray-400">No price lists yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'bundles' && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="Add Bundle">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createBundle({ name: bundleForm.name, price: Number(bundleForm.price) }); setBundleForm({ name: '', price: '' }); reload(); }); }}>
              <input className={input} placeholder="Bundle name" value={bundleForm.name} onChange={(e) => setBundleForm({ ...bundleForm, name: e.target.value })} required />
              <input className={input} type="number" step="0.01" placeholder="Bundle price" value={bundleForm.price} onChange={(e) => setBundleForm({ ...bundleForm, price: e.target.value })} required />
              <button className={btnPrimary}><Plus size={15} /> Create</button>
            </form>
          </Card>
          <div className="col-span-2">
            <Card title={`Bundles (${bundles.length})`}>
              <div className="space-y-2">
                {bundles.map((b) => (
                  <div key={b.id} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{b.name} · {money(b.price)}</p>
                      <p className="text-xs text-gray-500">{(b.items || []).length} items</p>
                    </div>
                    <button onClick={async () => { await api.deleteBundle(b.id); reload(); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                ))}
                {bundles.length === 0 && <p className="text-sm text-gray-400">No bundles yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'kits' && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="Add Kit">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createKit(kitForm); setKitForm({ name: '', description: '' }); reload(); }); }}>
              <input className={input} placeholder="Kit name" value={kitForm.name} onChange={(e) => setKitForm({ ...kitForm, name: e.target.value })} required />
              <input className={input} placeholder="Description" value={kitForm.description} onChange={(e) => setKitForm({ ...kitForm, description: e.target.value })} />
              <button className={btnPrimary}><Plus size={15} /> Create</button>
            </form>
          </Card>
          <div className="col-span-2">
            <Card title={`Kits (${kits.length})`}>
              <div className="space-y-2">
                {kits.map((k) => (
                  <div key={k.id} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{k.name}</p>
                      <p className="text-xs text-gray-500">{k.description || '—'} · {(k.components || []).length} components</p>
                    </div>
                    <button onClick={async () => { await api.deleteKit(k.id); reload(); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                ))}
                {kits.length === 0 && <p className="text-sm text-gray-400">No kits yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'composites' && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="Add Composite Product">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await guard(async () => { await api.createComposite(compositeForm); setCompositeForm({ name: '', description: '' }); reload(); }); }}>
              <input className={input} placeholder="Name (e.g. Build Your Own Pizza)" value={compositeForm.name} onChange={(e) => setCompositeForm({ ...compositeForm, name: e.target.value })} required />
              <input className={input} placeholder="Description" value={compositeForm.description} onChange={(e) => setCompositeForm({ ...compositeForm, description: e.target.value })} />
              <button className={btnPrimary}><Plus size={15} /> Create</button>
            </form>
          </Card>
          <div className="col-span-2">
            <Card title={`Composite Products (${composites.length})`}>
              <div className="space-y-2">
                {composites.map((c) => (
                  <div key={c.id} className="border rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm">{c.name}</p>
                      <button onClick={async () => { await api.deleteComposite(c.id); reload(); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                    </div>
                    <p className="text-xs text-gray-500">{(c.options || []).length} option groups</p>
                  </div>
                ))}
                {composites.length === 0 && <p className="text-sm text-gray-400">No composite products yet.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'variants' && (
        <div className="grid grid-cols-3 gap-4">
          <Card title="Add Variant">
            <div className="space-y-3">
              <select className={input} value={variantProductId} onChange={(e) => loadVariants(e.target.value)}>
                <option value="">Select product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className={input} placeholder="Option name (e.g. Size)" value={variantForm.name} onChange={(e) => setVariantForm({ ...variantForm, name: e.target.value })} />
              <input className={input} placeholder="Value (e.g. Large)" value={variantForm.value} onChange={(e) => setVariantForm({ ...variantForm, value: e.target.value })} />
              <input className={input} type="number" step="0.01" placeholder="Price adjustment" value={variantForm.priceAdj} onChange={(e) => setVariantForm({ ...variantForm, priceAdj: e.target.value })} />
              <input className={input} placeholder="SKU (optional)" value={variantForm.sku} onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })} />
              <button className={btnPrimary} onClick={async () => { if (!variantProductId) { setError('Select a product first'); return; } await guard(async () => { await api.createVariant({ productId: variantProductId, name: variantForm.name, value: variantForm.value, priceAdj: variantForm.priceAdj ? Number(variantForm.priceAdj) : undefined, sku: variantForm.sku || undefined }); setVariantForm({ name: '', value: '', priceAdj: '', sku: '' }); loadVariants(variantProductId); }); }}>
                <Plus size={15} /> Add Variant
              </button>
            </div>
          </Card>
          <div className="col-span-2">
            <Card title={`Variants (${variants.length})`}>
              <div className="space-y-2">
                {variants.map((v) => (
                  <div key={v.id} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{v.name}: {v.value}</p>
                      <p className="text-xs text-gray-500">{Number(v.priceAdj) !== 0 ? `${Number(v.priceAdj) > 0 ? '+' : ''}${money(v.priceAdj)}` : 'no price adj'}{v.sku ? ` · ${v.sku}` : ''}</p>
                    </div>
                    <button onClick={async () => { await api.deleteVariant(v.id); loadVariants(variantProductId); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                ))}
                {variants.length === 0 && <p className="text-sm text-gray-400">{variantProductId ? 'No variants for this product.' : 'Select a product to view variants.'}</p>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
