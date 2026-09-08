import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { COUNTRIES } from '../data/countries';
import { CURRENCIES } from '../data/currencies';
import { COPYRIGHT } from '../data/legal';
import PhoneInput from '../components/PhoneInput';
import {
  Save, Upload, Image as ImageIcon, Trash2, Palette, MapPin, Store as StoreIcon,
  Globe2, X, FileText, ShieldCheck, Receipt, Bell,
} from 'lucide-react';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image (matches server limit)

const input =
  'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 outline-none';

// Regional-indicator flag from an ISO alpha-2 code (luxury touch on selectors).
function flagEmoji(code: string): string {
  const cc = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (cc.length !== 2) return '🌐';
  return cc.replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

const SOCIAL_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourbusiness' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourbusiness' },
  { key: 'x', label: 'X (Twitter)', placeholder: 'https://x.com/yourbusiness' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/yourbusiness' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@yourbusiness' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@yourbusiness' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<any>({
    storeName: '', address: '', phone: '', phoneDialCode: '+1', email: '',
    receiptFooter: '', lowStockAlertEnabled: true,
    tagline: '', businessDescription: '', website: '',
    logoUrl: '', faviconUrl: '', coverUrl: '',
    brandPrimaryColor: '#2563eb', brandSecondaryColor: '',
    socialLinks: { facebook: '', instagram: '', x: '', linkedin: '', youtube: '', tiktok: '' },
    streetAddress: '', addressLine2: '', city: '', state: '', postalCode: '',
    country: '', countryCode: 'US', timezone: '', currency: 'USD', taxId: '',
  });
  const [media, setMedia] = useState<any[]>([]);
  const [countrySearch, setCountrySearch] = useState('');
  const [currencySearch, setCurrencySearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  const selected = useMemo(
    () => COUNTRIES.find((c) => c.code === settings.countryCode) || COUNTRIES[0],
    [settings.countryCode]
  );

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countrySearch]);

  // Full ISO 4217 catalog, searchable — every active world currency is selectable.
  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter((c) =>
      c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [currencySearch]);

  const set = (key: string, value: any) => setSettings((s: any) => ({ ...s, [key]: value }));
  const setSocial = (key: string, value: string) =>
    setSettings((s: any) => ({ ...s, socialLinks: { ...s.socialLinks, [key]: value } }));

  const chooseCountry = (code: string) => {
    const c = COUNTRIES.find((x) => x.code === code);
    setSettings((s: any) => ({
      ...s,
      countryCode: code,
      country: c?.name || s.country,
      currency: c?.currency || s.currency,
      phoneDialCode: c?.dialCode || s.phoneDialCode,
    }));
  };

  async function loadSettings() {
    try {
      const res = await api.getSettings();
      const s = res.data;
      setSettings({
        storeName: s.storeName || '', address: s.address || '', phone: s.phone || '', phoneDialCode: s.phoneDialCode || '+1', email: s.email || '',
        receiptFooter: s.receiptFooter || '', lowStockAlertEnabled: s.lowStockAlertEnabled ?? true,
        tagline: s.tagline || '', businessDescription: s.businessDescription || '', website: s.website || '',
        logoUrl: s.logoUrl || '', faviconUrl: s.faviconUrl || '', coverUrl: s.coverUrl || '',
        brandPrimaryColor: s.brandPrimaryColor || '#2563eb', brandSecondaryColor: s.brandSecondaryColor || '',
        socialLinks: { facebook: '', instagram: '', x: '', linkedin: '', youtube: '', tiktok: '', ...(s.socialLinks || {}) },
        streetAddress: s.streetAddress || '', addressLine2: s.addressLine2 || '', city: s.city || '', state: s.state || '', postalCode: s.postalCode || '',
        country: s.country || '', countryCode: s.countryCode || 'US', timezone: s.timezone || '',
        currency: s.currency || 'USD', taxId: s.taxId || '',
      });
      setMedia(Array.isArray(s.media) ? s.media : []);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function onPickImage(field: 'logoUrl' | 'faviconUrl' | 'coverUrl', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { alert('Image too large (max 5 MB)'); return; }
    try {
      const dataUrl = await fileToDataUrl(file);
      set(field, dataUrl);
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    }
  }

  async function onUploadMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) { alert('File too large (max 5 MB)'); return; }
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await api.uploadSettingsMedia({ name: file.name, dataUrl });
      setMedia(res.data?.media || []);
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onDeleteMedia(id: string) {
    if (!confirm('Remove this media from the library?')) return;
    try {
      const res = await api.deleteSettingsMedia(id);
      setMedia(res.data?.media || []);
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings(settings);
      alert('Settings saved!');
    } catch {
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading settings...</div>;
  }

  return (
    <div className="p-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Settings</h1>
        <p className="text-gray-500 mb-6 text-sm">Customize & brand your business, manage media, and set your worldwide address.</p>

        <form onSubmit={handleSave} className="space-y-6">
          {/* ── Branding ── */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Palette size={20} className="text-primary-600" /> Branding</h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
              <ImageUpload label="Logo" value={settings.logoUrl} onChange={(e) => onPickImage('logoUrl', e)} onClear={() => set('logoUrl', '')} hint="Square works best" />
              <ImageUpload label="Favicon" value={settings.faviconUrl} onChange={(e) => onPickImage('faviconUrl', e)} onClear={() => set('faviconUrl', '')} hint="32×32 icon" />
              <ImageUpload label="Cover / Banner" value={settings.coverUrl} onChange={(e) => onPickImage('coverUrl', e)} onClear={() => set('coverUrl', '')} hint="Wide graphic" />
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tagline</label>
                <input className={input} value={settings.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Your brand slogan" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Business description</label>
                <textarea className={input} rows={2} value={settings.businessDescription} onChange={(e) => set('businessDescription', e.target.value)} placeholder="Tell customers about your business" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Website</label>
                <input className={input} value={settings.website} onChange={(e) => set('website', e.target.value)} placeholder="https://yourbusiness.com" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Primary brand color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(settings.brandPrimaryColor) ? settings.brandPrimaryColor : '#2563eb'} onChange={(e) => set('brandPrimaryColor', e.target.value)} className="h-10 w-14 rounded border cursor-pointer" />
                    <input className={input} value={settings.brandPrimaryColor} onChange={(e) => set('brandPrimaryColor', e.target.value)} placeholder="#2563eb" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Secondary brand color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(settings.brandSecondaryColor) ? settings.brandSecondaryColor : '#0f172a'} onChange={(e) => set('brandSecondaryColor', e.target.value)} className="h-10 w-14 rounded border cursor-pointer" />
                    <input className={input} value={settings.brandSecondaryColor} onChange={(e) => set('brandSecondaryColor', e.target.value)} placeholder="#0f172a" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold mb-2">Social links</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SOCIAL_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                    <input className={input} value={settings.socialLinks?.[f.key] || ''} onChange={(e) => setSocial(f.key, e.target.value)} placeholder={f.placeholder} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Store Information ── */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><StoreIcon size={20} className="text-primary-600" /> Store Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Store Name</label>
                <input className={input} value={settings.storeName} onChange={(e) => set('storeName', e.target.value)} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input type="email" className={input} value={settings.email} onChange={(e) => set('email', e.target.value)} placeholder="contact@yourbusiness.com" />
              </div>
              <PhoneInput
                id="storePhone"
                label="Phone"
                dialCode={settings.phoneDialCode || '+1'}
                phoneNumber={settings.phone}
                onChange={(dc, num) => setSettings((s: any) => ({ ...s, phoneDialCode: dc, phone: num }))}
                hint="Choose your country dial code — it follows your business address country and can also be set independently."
              />
            </div>
          </div>

          {/* ── Business Address (worldwide) ── */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><MapPin size={20} className="text-primary-600" /> Business Address</h2>
            <p className="text-xs text-gray-500 mb-4 flex items-center gap-1.5">
              <Globe2 size={13} /> Available in all {COUNTRIES.length} countries &amp; territories.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Street address</label>
                <input className={input} value={settings.streetAddress} onChange={(e) => set('streetAddress', e.target.value)} placeholder="123 Business Rd" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Address line 2 <span className="text-gray-400 font-normal">(optional)</span></label>
                <input className={input} value={settings.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} placeholder="Apartment, suite, unit, building, floor" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">City</label>
                  <input className={input} value={settings.city} onChange={(e) => set('city', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">State / Province / Region</label>
                  <input className={input} value={settings.state} onChange={(e) => set('state', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Postal / ZIP code</label>
                  <input className={input} value={settings.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tax ID / VAT / Registration No.</label>
                  <input className={input} value={settings.taxId} onChange={(e) => set('taxId', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Country / Territory</label>
                <input className={input + ' mb-2'} value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)} placeholder={`Search ${COUNTRIES.length} countries...`} />
                <select className={input} value={settings.countryCode} onChange={(e) => chooseCountry(e.target.value)}>
                  {filteredCountries.map((c) => (
                    <option key={c.code} value={c.code}>{flagEmoji(c.code)} {c.name} ({c.code}) — {c.currency}</option>
                  ))}
                  {!filteredCountries.some((c) => c.code === settings.countryCode) && (
                    <option value={settings.countryCode}>{flagEmoji(selected.code)} {selected.name} ({selected.code})</option>
                  )}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Selected: <span className="font-medium text-gray-700">{flagEmoji(selected.code)} {selected.name}</span> · Currency {selected.currency} · Dial {selected.dialCode}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Currency</label>
                  <input className={input + ' mb-2'} value={currencySearch} onChange={(e) => setCurrencySearch(e.target.value)} placeholder={`Search ${CURRENCIES.length} ISO 4217 currencies...`} />
                  <select className={input} value={settings.currency} onChange={(e) => set('currency', e.target.value)}>
                    {filteredCurrencies.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}{c.symbol ? ` (${c.symbol})` : ''}</option>
                    ))}
                    {!filteredCurrencies.some((c) => c.code === settings.currency) && settings.currency && (
                      <option value={settings.currency}>{settings.currency}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Timezone</label>
                  <input className={input} value={settings.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Africa/Lagos" />
                </div>
              </div>
            </div>
          </div>

          {/* ── Media Library ── */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-1 flex items-center gap-2"><ImageIcon size={20} className="text-primary-600" /> Media Library</h2>
            <p className="text-xs text-gray-500 mb-4">Upload graphics, product photos, banners and other media (PNG, JPG, GIF, WEBP, SVG, PDF · max 5 MB each · up to 24 items).</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 cursor-pointer">
              <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload media'}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={onUploadMedia} disabled={uploading} />
            </label>

            {media.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-4">
                {media.map((m) => (
                  <div key={m.id} className="border rounded-lg overflow-hidden bg-gray-50">
                    <div className="h-24 flex items-center justify-center bg-white">
                      {String(m.type || '').startsWith('image/')
                        ? <img src={m.dataUrl} alt={m.name} className="max-h-24 max-w-full object-contain" />
                        : <FileText size={28} className="text-gray-400" />}
                    </div>
                    <div className="p-2 flex items-center justify-between gap-1">
                      <span className="text-[11px] text-gray-600 truncate" title={m.name}>{m.name}</span>
                      <button type="button" onClick={() => onDeleteMedia(m.id)} className="text-red-500 hover:text-red-700 shrink-0"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {media.length === 0 && <p className="text-sm text-gray-400 mt-3">No media uploaded yet.</p>}
          </div>

          {/* ── Receipt ── */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Receipt size={20} className="text-primary-600" /> Receipt</h2>
            <div>
              <label className="block text-sm font-medium mb-1">Receipt footer message</label>
              <textarea className={input} rows={2} value={settings.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} placeholder="Thank you for your purchase!" />
            </div>
          </div>

          {/* ── Notifications ── */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Bell size={20} className="text-primary-600" /> Notifications</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={settings.lowStockAlertEnabled} onChange={(e) => set('lowStockAlertEnabled', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              <span className="text-sm font-medium">Enable low stock alerts</span>
            </label>
          </div>

          {/* ── Legal ── */}
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><ShieldCheck size={20} className="text-primary-600" /> Legal</h2>
            <div className="flex flex-wrap gap-4 text-sm mb-3">
              <Link to="/legal/privacy" className="text-primary-600 hover:text-primary-700 font-medium">Privacy Policy</Link>
              <Link to="/legal/terms" className="text-primary-600 hover:text-primary-700 font-medium">Terms of Use</Link>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{COPYRIGHT}</p>
          </div>

          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50">
            <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ImageUpload({ label, value, onChange, onClear, hint }: {
  label: string; value: string; hint?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="border rounded-lg p-3 flex flex-col items-center gap-2 bg-gray-50">
        <div className="h-20 w-full flex items-center justify-center bg-white rounded border overflow-hidden">
          {value
            ? <img src={value} alt={label} className="max-h-20 max-w-full object-contain" />
            : <ImageIcon size={24} className="text-gray-300" />}
        </div>
        <div className="flex items-center gap-2 w-full">
          <label className="flex-1 text-center text-xs px-2 py-1.5 bg-white border rounded cursor-pointer hover:bg-gray-100">
            <Upload size={12} className="inline mr-1" />{value ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" onChange={onChange} />
          </label>
          {value && (
            <button type="button" onClick={onClear} className="text-xs px-2 py-1.5 border rounded text-red-600 hover:bg-red-50">
              <X size={12} />
            </button>
          )}
        </div>
        {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
      </div>
    </div>
  );
}
