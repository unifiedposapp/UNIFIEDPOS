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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  employee: null,
  organization: null,
  token: null,
  isAuthenticated: false,

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

  loadFromStorage: () => {
    const token = localStorage.getItem('pos_token');
    const userStr = localStorage.getItem('pos_user');
    const employeeStr = localStorage.getItem('pos_employee');
    const orgStr = localStorage.getItem('pos_organization');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        const employee = employeeStr ? JSON.parse(employeeStr) : null;
        const organization = orgStr ? JSON.parse(orgStr) : null;
        set({ user, token, employee, organization, isAuthenticated: true });
      } catch {
        localStorage.removeItem('pos_token');
        localStorage.removeItem('pos_user');
        localStorage.removeItem('pos_employee');
        localStorage.removeItem('pos_organization');
      }
    }
  },
}));
