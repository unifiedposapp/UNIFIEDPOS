import { create } from 'zustand';

interface Modifier {
  id: string;
  name: string;
  priceAdj: number;
}

interface CartItem {
  productId: string;
  variantId?: string;
  name: string;
  variantName?: string;
  price: number;
  quantity: number;
  discount: number;
  modifiers?: Modifier[];
  notes?: string;
}

interface CartState {
  items: CartItem[];
  customerId?: string;
  discount: number;
  discountType?: 'PERCENTAGE' | 'FIXED';
  tip: number;
  notes?: string;
  addItem: (product: { id: string; name: string; price: number; variantId?: string; variantName?: string }) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateDiscount: (productId: string, discount: number) => void;
  setDiscount: (discount: number, type?: 'PERCENTAGE' | 'FIXED') => void;
  setTip: (tip: number) => void;
  setCustomer: (customerId?: string) => void;
  setNotes: (notes?: string) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: undefined,
  discount: 0,
  discountType: undefined,
  tip: 0,
  notes: undefined,

  addItem: (product) => {
    set((state) => {
      const existing = state.items.find((i) => i.productId === product.id && i.variantId === product.variantId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === product.id && i.variantId === product.variantId
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        };
      }
      return {
        items: [
          ...state.items,
          {
            productId: product.id,
            variantId: product.variantId,
            name: product.name,
            variantName: product.variantName,
            price: product.price,
            quantity: 1,
            discount: 0,
            modifiers: [],
            notes: '',
          },
        ],
      };
    });
  },

  removeItem: (productId) => {
    set((state) => ({ items: state.items.filter((i) => i.productId !== productId) }));
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    set((state) => ({
      items: state.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)),
    }));
  },

  updateDiscount: (productId, discount) => {
    set((state) => ({
      items: state.items.map((i) => (i.productId === productId ? { ...i, discount } : i)),
    }));
  },

  setDiscount: (discount, type) => set({ discount, discountType: type }),

  setTip: (tip) => set({ tip }),

  setCustomer: (customerId) => set({ customerId }),

  setNotes: (notes) => set({ notes }),

  clearCart: () => set({ items: [], customerId: undefined, discount: 0, discountType: undefined, tip: 0, notes: undefined }),

  getSubtotal: () => {
    const { items } = get();
    return items.reduce((sum, i) => {
      const modifierTotal = i.modifiers?.reduce((s, m) => s + m.priceAdj, 0) || 0;
      return sum + (i.price + modifierTotal) * i.quantity - i.discount;
    }, 0);
  },

  getTotal: () => {
    const subtotal = get().getSubtotal();
    const { discount, discountType, tip } = get();
    const discountAmount = discountType === 'PERCENTAGE' ? subtotal * (discount / 100) : discount;
    return subtotal - discountAmount + tip;
  },
}));
