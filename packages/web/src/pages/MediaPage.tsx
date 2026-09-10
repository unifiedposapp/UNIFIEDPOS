import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Image as ImageIcon, Upload, Trash2, Bell, BellOff, CheckCircle2 } from 'lucide-react';
import { enableWebPush, disableWebPush, isPushSupported } from '../services/webPush';

export default function MediaPage() {
  const [assets, setAssets] = useState<any[]>([]);
  const [backend, setBackend] = useState<any>(null);
  const [folder, setFolder] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const params: Record<string, string> = {};
    if (folder) params.folder = folder;
    const [m, b] = await Promise.all([api.getMedia(params), api.getMediaBackend()]);
    setAssets(m.data || []);
    setBackend(b.data || null);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [folder]);

  const onFile = async (file: File) => {
    setError('');
    if (file.size > 10 * 1024 * 1024) { setError('File too large (max 10MB)'); return; }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.uploadMedia({ name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl, folder: folder || undefined });
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this media asset?')) return;
    await api.deleteMediaAsset(id);
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Media Library</h1>
        <p className="text-gray-500">
          Product images and brand assets — stored in{' '}
          <span className="font-medium">{backend?.backend === 'S3' ? `S3 (${backend.bucket})` : 'the database'}</span>
        </p>
      </div>

      <WebPushCard />

      <div className="flex flex-wrap items-center gap-3">
        <input placeholder="Filter by folder" value={folder} onChange={(e) => setFolder(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 cursor-pointer">
          <Upload size={18} /> {uploading ? 'Uploading…' : 'Upload'}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded">{error}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {assets.map((a) => (
          <div key={a.id} className="bg-white rounded-lg border overflow-hidden group">
            <div className="aspect-square bg-gray-50 flex items-center justify-center">
              {a.url && a.mimeType?.startsWith('image/') ? (
                <img src={a.url} alt={a.name || ''} className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="text-gray-300" size={40} />
              )}
            </div>
            <div className="p-2">
              <div className="text-xs font-medium truncate">{a.name || 'Untitled'}</div>
              <div className="text-[11px] text-gray-400">{Math.round(a.size / 1024)} KB · {a.storage}</div>
              <button onClick={() => remove(a.id)} className="mt-1 text-red-400 hover:text-red-600 flex items-center gap-1 text-xs">
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        ))}
        {assets.length === 0 && <div className="col-span-full p-8 text-center text-gray-500">No media assets yet</div>}
      </div>
    </div>
  );
}

// ─── Web Push enrollment ─────────────────────────────────────────────────────
function WebPushCard() {
  const [config, setConfig] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getPushConfig().then((r) => setConfig(r.data)).catch(() => {}); }, []);

  const enable = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await enableWebPush();
      if (res.subscribed) setMsg('Push notifications enabled on this device.');
      else if (res.reason === 'denied') setMsg('Notification permission was denied.');
      else if (res.reason === 'server-disabled') setMsg('Web push is not configured on the server (set VAPID keys).');
      else setMsg('Push is not supported in this browser.');
    } catch (e: any) { setMsg(e.message || 'Could not enable push.'); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMsg('');
    await disableWebPush();
    setMsg('Push notifications disabled on this device.');
    setBusy(false);
  };

  const test = async () => {
    setBusy(true); setMsg('');
    try {
      const res = await api.sendTestPush({ title: 'UnifiedPOS', body: 'This is a test push notification.' });
      setMsg(res.data?.enabled ? `Test sent to ${res.data.sent} device(s).` : 'Web push is not configured on the server (set VAPID keys).');
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center gap-2 mb-2">
        <Bell size={18} />
        <h2 className="font-semibold">Browser Push Notifications</h2>
        <span className={`ml-auto text-xs px-2 py-1 rounded ${config?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
          {config?.enabled ? 'Server ready' : 'Server not configured'}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-3">
        Receive low-stock, payment and device alerts even when this tab is closed.
        {!isPushSupported() && ' (Not supported in this browser.)'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={enable} disabled={busy || !isPushSupported()} className="flex items-center gap-1 text-sm bg-violet-600 text-white px-3 py-1.5 rounded hover:bg-violet-700 disabled:opacity-50">
          <Bell size={14} /> Enable
        </button>
        <button onClick={test} disabled={busy} className="flex items-center gap-1 text-sm border px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50">
          <CheckCircle2 size={14} /> Send test
        </button>
        <button onClick={disable} disabled={busy} className="flex items-center gap-1 text-sm border px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50">
          <BellOff size={14} /> Disable
        </button>
      </div>
      {msg && <div className="mt-2 text-sm text-gray-600">{msg}</div>}
    </div>
  );
}
