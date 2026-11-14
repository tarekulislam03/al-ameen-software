import { Platform } from 'react-native';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  dob: string;
  course: string;
  enrollmentDate: string;
  totalFee: number;
  notes: string;
  documentStatus: string;
  createdAt: string;
  paidAmount: number;
  balance: number;
  paymentCount: number;
  paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
  payments?: Payment[];
}

export interface Payment {
  paymentId: string;
  customerId: string;
  date: string;
  amount: number;
  mode: string;
  note: string;
  customerName?: string;
  customerPhone?: string;
}

export interface CacheStatus {
  initialized: boolean;
  lastSyncedAt: string | null;
  syncSource: 'google_sheets' | 'memory';
  sheetsConfigured: boolean;
  customerCount: number;
  paymentCount: number;
}

const getDefaultBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:4000/api';
  }
  return 'http://localhost:4000/api';
};

export const API_BASE_URL = getDefaultBaseUrl();

export interface AuthUser {
  username: string;
}

// Token lives in memory; on web it is also kept in localStorage so a refresh keeps you logged in.
const TOKEN_KEY = 'aam_token';
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function loadStoredToken(): string | null {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    authToken = localStorage.getItem(TOKEN_KEY);
  }
  return authToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => null);
  if (res.status === 401 && authToken && path !== '/auth/login') {
    onUnauthorized?.();
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    apiRequest<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => apiRequest<{ user: AuthUser }>('/auth/me'),
  getHealth: () => apiRequest<{ status: string; cache: CacheStatus }>('/status'),
  syncCache: () => apiRequest<{ message: string; cache: CacheStatus }>('/sync', { method: 'POST' }),

  // Customers
  listCustomers: (params?: { search?: string; documentStatus?: string; paymentStatus?: string }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.documentStatus && params.documentStatus !== 'All') {
      query.set('documentStatus', params.documentStatus);
    }
    if (params?.paymentStatus && params.paymentStatus !== 'All') {
      query.set('paymentStatus', params.paymentStatus);
    }
    const qs = query.toString();
    return apiRequest<Customer[]>(`/customers${qs ? `?${qs}` : ''}`);
  },

  getCustomer: (id: string) => apiRequest<Customer>(`/customers/${encodeURIComponent(id)}`),

  createCustomer: (payload: Partial<Customer>) =>
    apiRequest<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCustomer: (id: string, payload: Partial<Customer>) =>
    apiRequest<Customer>(`/customers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteCustomer: (id: string) =>
    apiRequest<{ message: string; id: string }>(`/customers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Payments
  listPaymentsByCustomer: (customerId: string) =>
    apiRequest<Payment[]>(`/customers/${encodeURIComponent(customerId)}/payments`),

  listAllPayments: () => apiRequest<Payment[]>('/payments'),

  updatePayment: (paymentId: string, payload: { date?: string; amount?: number; mode?: string; note?: string }) =>
    apiRequest<Payment>(`/payments/${encodeURIComponent(paymentId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deletePayment: (paymentId: string) =>
    apiRequest<{ message: string; paymentId: string }>(`/payments/${encodeURIComponent(paymentId)}`, {
      method: 'DELETE',
    }),

  createPayment: (customerId: string, payload: { date?: string; amount: number; mode: string; note?: string }) =>
    apiRequest<Payment>(`/customers/${encodeURIComponent(customerId)}/payments`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, customerId }),
    }),
};
