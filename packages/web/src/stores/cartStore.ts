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
  /** Decimal on a weighed line: 0.375 kg is a quantity, not a rounding error. */
  quantity: number;
  discount: number;
  modifiers?: Modifier[];
  notes?: string;
  // ── Weighed selling + age restriction (§6) ──
  uom?: string;
  weighed?: boolean;
  ageRestricted?: boolean;
  minAge?: number | null;
}

interface AddableProduct {
  id: string;
  name: string;
  price: number;
  variantId?: string;
  variantName?: string;
  unitOfMeasure?: string;
  isWeighed?: boolean;
  ageRestricted?: boolean;
  minAge?: number | null;
}

interface CartState {
  items: CartItem[];
  customerId?: string;
  discount: number;
  discountType?: 'PERCENTAGE' | 'FIXED';
  tip: number;
  notes?: string;
  addItem: (product: AddableProduct, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateDiscount: (productId: string, discount: number) => void;
  setDiscount: (discount: number, type?: 'PERCENTAGE' | 'FIXED') => void;
  setTip: (tip: number) => void;
  setCustomer: (customerId?: string) => void;
  setNotes: (notes?: string) => void;
  restoreCart: (items: Partial<CartItem>[], customerId?: string) => void;
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

  addItem: (product: AddableProduct, quantity?: number) => {
    // A weighed line arrives with an exact amount from the scale; an each line
    // increments by one. Both are "add", but only one of them is countable.
    const isWeighed = Boolean(product.isWeighed);
    const amount = isWeighed ? Math.round((Number(quantity) || 0) * 1000) / 1000 : Math.max(1, Math.round(Number(quantity) || 1));

    set((state) => {
      const existing = state.items.find((i) => i.productId === product.id && i.variantId === product.variantId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === product.id && i.variantId === product.variantId
              ? { ...i, quantity: Math.round((Number(i.quantity) + amount) * 1000) / 1000 }
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
            quantity: amount,
            discount: 0,
            modifiers: [],
            notes: '',
            uom: product.unitOfMeasure || (isWeighed ? 'KG' : 'EACH'),
            weighed: isWeighed,
            ageRestricted: Boolean(product.ageRestricted),
            minAge: product.minAge ?? null,
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

  // Recall a parked cart (retail suspended cart) into the live POS basket.
  // Values arrive as JSON, so every field is normalised before use.
  restoreCart: (items, customerId) => {
    set({
      items: items
        .filter((i) => i && i.productId)
        .map((i) => ({
          productId: String(i.productId),
          variantId: i.variantId,
          name: String(i.name || 'Item'),
          variantName: i.variantName,
          price: Number(i.price) || 0,
          // A parked weighed line keeps its decimals; an each line stays whole.
          quantity: i.weighed ? Number(i.quantity) || 0.001 : Math.max(1, Number(i.quantity) || 1),
          discount: Number(i.discount) || 0,
          modifiers: Array.isArray(i.modifiers) ? i.modifiers : [],
          notes: i.notes || '',
          uom: i.uom,
          weighed: i.weighed,
          ageRestricted: i.ageRestricted,
          minAge: i.minAge ?? null,
        })),
      customerId,
      discount: 0,
      discountType: undefined,
      tip: 0,
      notes: undefined,
    });
  },

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
