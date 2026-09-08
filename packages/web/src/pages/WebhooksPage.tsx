import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Webhook, Plus, Trash2 } from 'lucide-react';

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ url: '', secret: '', events: [] as string[], description: '' });

  const load = async () => {
    const [whRes, evRes] = await Promise.all([
      api.getWebhooks(),
      api.getWebhookEvents(),
    ]);
    setWebhooks(whRes.data || []);
    setEventTypes(evRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    await api.createWebhook(form);
    setShowForm(false);
    setForm({ url: '', secret: '', events: [], description: '' });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this webhook?')) return;
    await api.deleteWebhook(id);
    load();
  };

  const toggleEvent = (event: string) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter(e => e !== event)
        : [...f.events, event],
    }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhooks & Events</h1>
          <p className="text-gray-500">Manage webhook subscriptions and event integrations</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700">
          <Plus size={18} /> New Webhook
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">New Webhook Subscription</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Webhook URL" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Secret (min 8 chars)" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} className="border rounded px-3 py-2" />
          </div>
          <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="border rounded px-3 py-2 w-full" />

          <div>
            <h4 className="text-sm font-medium mb-2">Subscribe to events:</h4>
            <div className="flex flex-wrap gap-2">
              {eventTypes.map(ev => (
                <button
                  key={ev}
                  onClick={() => toggleEvent(ev)}
                  className={`text-xs px-3 py-1 rounded border ${form.events.includes(ev) ? 'bg-violet-100 border-violet-300 text-violet-800' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                >
                  {ev}
                </button>
              ))}
            </div>
          </div>

          <button onClick={create} className="bg-violet-600 text-white px-4 py-2 rounded hover:bg-violet-700">Create Webhook</button>
        </div>
      )}

      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center gap-2">
          <Webhook size={18} />
          <h2 className="font-semibold">Active Webhooks ({webhooks.length})</h2>
        </div>
        <div className="divide-y">
          {webhooks.map(wh => (
            <div key={wh.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{wh.description || wh.url}</div>
                  <div className="text-sm text-gray-500">{wh.url}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-500">
                    {wh.successCount} ok / {wh.failureCount} fail
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${wh.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {wh.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => remove(wh.id)} className="text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {wh.events?.map((ev: string) => (
                  <span key={ev} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{ev}</span>
                ))}
              </div>
            </div>
          ))}
          {webhooks.length === 0 && (
            <div className="p-8 text-center text-gray-500">No webhooks configured</div>
          )}
        </div>
      </div>
    </div>
  );
}
