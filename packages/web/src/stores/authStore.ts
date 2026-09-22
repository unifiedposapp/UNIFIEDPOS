import { create } from 'zustand';
import { api } from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Employee {
  id: string;
  employeeNumber?: string;
}

interface Organization {
  id: string;
  name: string;
  industry: string;
  currency: string;
  taxRate: number;
}

interface AuthState {
  user: User | null;
  employee: Employee | null;
  organization: Organization | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string, employee?: Employee, organization?: Organization) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

/**
 * Reads any persisted session synchronously. Used both to seed the store at
 * module load (so the very first render already knows whether a user is
 * authenticated) and by loadFromStorage. Without eager seeding, a hard refresh
 * on a deep route (e.g. /labels) painted one frame as "signed out", tripping
 * the catch-all <Navigate to="/login"> before the hydrate effect could run, and
 * the intended route was lost. Guarded for non-browser (test/SSR) contexts.
 */
interface AuthSnapshot {
  user: User | null;
  employee: Employee | null;
  organization: Organization | null;
  token: string | null;
  isAuthenticated: boolean;
}

function readStoredAuth(): AuthSnapshot {
  const empty: AuthSnapshot = { user: null, employee: null, organization: null, token: null, isAuthenticated: false };
  try {
    if (typeof localStorage === 'undefined') return empty;
    const token = localStorage.getItem('pos_token');
    const userStr = localStorage.getItem('pos_user');
    if (!token || !userStr) return empty;
    const employeeStr = localStorage.getItem('pos_employee');
    const orgStr = localStorage.getItem('pos_organization');
    return {
      user: JSON.parse(userStr),
      token,
      employee: employeeStr ? JSON.parse(employeeStr) : null,
      organization: orgStr ? JSON.parse(orgStr) : null,
      isAuthenticated: true,
    };
  } catch {
    // Corrupt payload: clear it and treat as signed out.
    try {
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_user');
      localStorage.removeItem('pos_employee');
      localStorage.removeItem('pos_organization');
    } catch {
      /* ignore */
    }
    return empty;
  }
}

// Seed eagerly at module evaluation so the first render is already correct.
const boot = readStoredAuth();

export const useAuthStore = create<AuthState>((set) => ({
  user: boot.user,
  employee: boot.employee,
  organization: boot.organization,
  token: boot.token,
  isAuthenticated: boot.isAuthenticated,

  login: (user, token, employee, organization) => {
    localStorage.setItem('pos_token', token);
    localStorage.setItem('pos_user', JSON.stringify(user));
    if (employee) localStorage.setItem('pos_employee', JSON.stringify(employee));
    if (organization) localStorage.setItem('pos_organization', JSON.stringify(organization));
    set({ user, token, employee: employee || null, organization: organization || null, isAuthenticated: true });
  },

  logout: () => {
    // Clear the httpOnly session + CSRF cookies server-side (best-effort), then
    // reset local state. The Bearer token in localStorage is removed too.
    void api.logout().catch(() => { /* ignore — local logout proceeds regardless */ });
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_employee');
    localStorage.removeItem('pos_organization');
    set({ user: null, employee: null, organization: null, token: null, isAuthenticated: false });
  },

  // Re-run the synchronous read and overwrite state. Idempotent, and safe to
  // call from App's mount effect (kept for backwards compatibility / forced
  // re-hydration); the eager `boot` already covers the first-render case.
  loadFromStorage: () => set(readStoredAuth()),
}));
