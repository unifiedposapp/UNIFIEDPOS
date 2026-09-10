import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Printer, ArrowLeft, CheckCircle, Usb } from 'lucide-react';
import { hardware } from '../services/hardware';
import { currencySymbol as symbolForCurrency } from '../data/currencies';
import type { ReceiptData as EscposReceipt } from '../services/escpos';

interface ReceiptData {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeEmail: string;
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
  locationName: string;
  registerName: string;
  cashierName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: Array<{
    name: string;
    variant: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
  }>;
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  total: number;
  payments: Array<{
    method: string;
    amount: number;
    status: string;
  }>;
  paid: number;
  change: number;
  receiptFooter: string;
  currency: string;
}

export default function ReceiptPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [escposBusy, setEscposBusy] = useState(false);
  const [escposMsg, setEscposMsg] = useState('');

  useEffect(() => {
    loadReceipt();
  }, [orderId]);

  const loadReceipt = async () => {
    if (!orderId) return;
    try {
      const res = await api.getReceipt(orderId);
      if (res.success) {
        setReceipt(res.data);
      }
    } catch (error) {
      console.error('Failed to load receipt:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Map the API receipt payload into the ESC/POS builder's shape.
  const toEscpos = (r: ReceiptData): EscposReceipt => ({
    storeName: r.storeName,
    addressLine: r.storeAddress,
    phone: r.storePhone,
    orderNumber: r.orderNumber,
    cashier: r.cashierName,
    register: r.registerName,
    location: r.locationName,
    createdAt: r.orderDate,
    currencySymbol: symbolForCurrency(r.currency || hardware.settings.currencyCode || 'USD'),
    items: r.items.map((i) => ({
      name: i.variant ? `${i.name} (${i.variant})` : i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.total,
      notes: i.discount > 0 ? [`Discount -${i.discount.toFixed(2)}`] : undefined,
    })),
    subtotal: r.subtotal,
    discount: r.discount,
    tax: r.tax,
    tip: r.tip,
    total: r.total,
    payments: r.payments.map((p, idx) => ({
      method: p.method,
      amount: p.amount,
      // Attach the change due to the first cash tender.
      change: idx === 0 && r.change > 0 ? r.change : undefined,
    })),
    footer: r.receiptFooter || undefined,
  });

  // Send the receipt to a paired thermal printer (WebSerial) and kick the
  // drawer for cash sales. Falls back to a console simulator when unsupported.
  const handleEscposPrint = async () => {
    if (!receipt) return;
    setEscposBusy(true);
    setEscposMsg('');
    try {
      if (!hardware.isConnected && hardware.isSupported) {
        const ok = await hardware.connect();
        if (!ok) {
          setEscposMsg('No printer paired. Connect one on the Hardware page.');
          return;
        }
      }
      const tenderWasCash = receipt.payments.some((p) => p.method.toUpperCase().includes('CASH'));
      await hardware.completeSale(toEscpos(receipt), tenderWasCash);
      setEscposMsg(
        hardware.isConnected
          ? 'Sent to printer.'
          : 'No serial printer available — logged to console (simulator).',
      );
    } catch (err: any) {
      console.error('ESC/POS print failed:', err);
      setEscposMsg(err?.message || 'Print failed.');
    } finally {
      setEscposBusy(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: receipt?.currency || 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading receipt...</p>
        </div>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-gray-600">Receipt not found</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Action Bar */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={20} />
          Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={handleEscposPrint}
            disabled={escposBusy}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            title="Print to a paired ESC/POS thermal receipt printer"
          >
            <Usb size={18} />
            {escposBusy ? 'Sending…' : 'Register Printer'}
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Printer size={18} />
            Print Receipt
          </button>
        </div>
      </div>
      {escposMsg && (
        <div className="mb-4 text-sm text-gray-600 print:hidden">{escposMsg}</div>
      )}

      {/* Receipt Content */}
      <div className="bg-white rounded-lg shadow-lg p-8 print:shadow-none print:p-0">
        {/* Header */}
        <div className="text-center border-b-2 border-gray-300 pb-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">{receipt.storeName}</h1>
          {receipt.storeAddress && <p className="text-gray-600">{receipt.storeAddress}</p>}
          {receipt.storePhone && <p className="text-gray-600">{receipt.storePhone}</p>}
          {receipt.storeEmail && <p className="text-gray-600">{receipt.storeEmail}</p>}
        </div>

        {/* Order Info */}
        <div className="grid grid-cols-2 gap-4 mb-6 pb-6 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-600">Order Number</p>
            <p className="font-semibold text-lg">{receipt.orderNumber}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Date</p>
            <p className="font-semibold">{formatDate(receipt.orderDate)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Location</p>
            <p className="font-medium">{receipt.locationName}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Register</p>
            <p className="font-medium">{receipt.registerName}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Cashier</p>
            <p className="font-medium">{receipt.cashierName}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Status</p>
            <p className="font-medium flex items-center justify-end gap-1">
              <CheckCircle size={16} className="text-green-600" />
              {receipt.orderStatus}
            </p>
          </div>
        </div>

        {/* Customer Info */}
        {receipt.customerName && receipt.customerName !== 'Walk-in Customer' && (
          <div className="mb-6 pb-6 border-b border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Customer</p>
            <p className="font-medium">{receipt.customerName}</p>
            {receipt.customerEmail && <p className="text-sm text-gray-600">{receipt.customerEmail}</p>}
            {receipt.customerPhone && <p className="text-sm text-gray-600">{receipt.customerPhone}</p>}
          </div>
        )}

        {/* Items */}
        <div className="mb-6">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-gray-300">
                <th className="text-left py-2">Item</th>
                <th className="text-center py-2">Qty</th>
                <th className="text-right py-2">Price</th>
                <th className="text-right py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((item, idx) => (
                <tr key={idx} className="border-b border-gray-200">
                  <td className="py-3">
                    <p className="font-medium">{item.name}</p>
                    {item.variant && <p className="text-sm text-gray-600">{item.variant}</p>}
                    {item.discount > 0 && (
                      <p className="text-sm text-red-600">Discount: -{formatCurrency(item.discount)}</p>
                    )}
                  </td>
                  <td className="text-center py-3">{item.quantity}</td>
                  <td className="text-right py-3">{formatCurrency(item.unitPrice)}</td>
                  <td className="text-right py-3 font-medium">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="border-t-2 border-gray-300 pt-4 mb-6">
          <div className="space-y-2">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal:</span>
              <span>{formatCurrency(receipt.subtotal)}</span>
            </div>
            {receipt.discount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Discount:</span>
                <span>-{formatCurrency(receipt.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Tax:</span>
              <span>{formatCurrency(receipt.tax)}</span>
            </div>
            {receipt.tip > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Tip:</span>
                <span>{formatCurrency(receipt.tip)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold pt-2 border-t border-gray-200">
              <span>Total:</span>
              <span>{formatCurrency(receipt.total)}</span>
            </div>
          </div>
        </div>

        {/* Payments */}
        <div className="mb-6 pb-6 border-b border-gray-200">
          <h3 className="font-semibold mb-3">Payment Information</h3>
          <div className="space-y-2">
            {receipt.payments.map((payment, idx) => (
              <div key={idx} className="flex justify-between">
                <span className="text-gray-600">{payment.method}:</span>
                <span className="font-medium">{formatCurrency(payment.amount)}</span>
              </div>
            ))}
            {receipt.change > 0 && (
              <div className="flex justify-between text-green-600 font-medium pt-2 border-t border-gray-200">
                <span>Change:</span>
                <span>{formatCurrency(receipt.change)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-6 border-t-2 border-gray-300">
          <p className="text-gray-600 whitespace-pre-line">{receipt.receiptFooter}</p>
          <p className="text-sm text-gray-500 mt-4">
            Thank you for your business!
          </p>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:hidden {
            display: none !important;
          }
          .bg-white, .bg-white * {
            visibility: visible;
          }
          .bg-white {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            box-shadow: none;
          }
        }
      `}</style>
    </div>
  );
}
