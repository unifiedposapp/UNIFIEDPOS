import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { FileText, Filter } from 'lucide-react';

interface AuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actor: {
    user: {
      name: string;
      email: string;
    };
  } | null;
  newValue: any;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Order Created',
  ORDER_CANCELLED: 'Order Cancelled',
  ORDER_PAID: 'Order Paid',
  ORDER_COMPLETED: 'Order Completed',
  REFUND_CREATED: 'Refund Created',
  PRODUCT_CREATED: 'Product Created',
  PRODUCT_UPDATED: 'Product Updated',
  PRODUCT_DELETED: 'Product Deleted',
  CUSTOMER_CREATED: 'Customer Created',
  REGISTER_OPENED: 'Register Opened',
  REGISTER_CLOSED: 'Register Closed',
  DISCOUNT_APPLIED: 'Discount Applied',
  PRICE_CHANGED: 'Price Changed',
  INVENTORY_ADJUSTED: 'Inventory Adjusted',
};

export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      const res = await api.getAuditEvents();
      if (res.success) {
        setEvents(res.data.items || []);
      }
    } catch (error) {
      console.error('Failed to load audit events:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter((e) => {
    if (!filter) return true;
    const action = ACTION_LABELS[e.action] || e.action;
    return (
      action.toLowerCase().includes(filter.toLowerCase()) ||
      e.resourceType.toLowerCase().includes(filter.toLowerCase()) ||
      e.actor?.user.name.toLowerCase().includes(filter.toLowerCase())
    );
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading audit log...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileText size={32} />
          Audit Log
        </h1>
        <p className="text-gray-600 mt-1">Track all sensitive actions in the system</p>
      </div>

      {/* Filter */}
      <div className="mb-6">
        <div className="relative">
          <Filter size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Filter by action, resource type, or user..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Timestamp
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Action
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Resource
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredEvents.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  No audit events found
                </td>
              </tr>
            ) : (
              filteredEvents.map((event) => (
                <tr key={event.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(event.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                      {ACTION_LABELS[event.action] || event.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {event.resourceType}
                    {event.resourceId && (
                      <span className="text-gray-500 ml-1 text-xs">
                        ({event.resourceId.substring(0, 8)}...)
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {event.actor?.user.name || 'System'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                    {event.newValue ? JSON.stringify(event.newValue) : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        Showing {filteredEvents.length} of {events.length} events
      </div>
    </div>
  );
}
