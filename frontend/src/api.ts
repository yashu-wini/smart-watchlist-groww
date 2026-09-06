// Centralized API client for Market Watch
const TOKEN_KEY = 'market_watch_token';

export interface User {
  id: number;
  email: string;
}

export interface WatchlistSummary {
  id: number;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MarketData {
  price: number;
  previousClose: number;
  changePercent: number;
  volume: number;
  marketTime: string;
}

export interface AttentionData {
  level: 'NEEDS_ATTENTION' | 'WORTH_WATCHING' | 'NO_MEANINGFUL_CHANGE';
  reason: string;
}

export interface StockIntelligence {
  stockId: number;
  symbol: string;
  companyName: string;
  exchange: string;
  market: MarketData | null;
  attention: AttentionData;
}

export interface WatchlistIntelligence {
  watchlist: {
    id: number;
    name: string;
  };
  summary: {
    needsAttention: number;
    worthWatching: number;
    noMeaningfulChange: number;
  };
  stocks: StockIntelligence[];
}

export interface CheckResponseChange {
  stockId: number;
  symbol: string;
  event: {
    type: string;
    severity: string;
    previousPrice: number;
    currentPrice: number;
    priceChangePercent: number;
    previousVolume: number;
    currentVolume: number;
    volumeChangePercent: number | null;
  };
  attention: {
    level: string;
    reason: string;
  };
}

export interface CheckResponse {
  watchlistId: number;
  previouslyCheckedAt: string | null;
  checkedAt: string;
  changes: CheckResponseChange[];
}

export interface CatalogStock {
  id: number;
  symbol: string;
  companyName: string;
  exchange: string;
}

// Token helper functions
export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Configurable API base URL for deployment environments
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Base authenticated apiFetch helper
export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  onUnauthorized?: () => void
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearStoredToken();
    if (onUnauthorized) {
      onUnauthorized();
    }
    const errBody = await response.json().catch(() => ({ error: 'Authentication required' }));
    throw new Error(errBody.error || 'Authentication required');
  }

  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.error || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

// Authentication API methods
export async function loginApi(email: string, password: string): Promise<{ user: User; token: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({ error: 'Login failed' }));
  if (!res.ok) {
    throw new Error(data.error || 'Invalid email or password');
  }

  setStoredToken(data.token);
  return data;
}

export async function registerApi(email: string, password: string): Promise<{ user: User }> {
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({ error: 'Registration failed' }));
  if (!res.ok) {
    throw new Error(data.error || 'Registration failed');
  }

  return data;
}

export async function getMeApi(onUnauthorized?: () => void): Promise<{ user: User }> {
  return apiFetch<{ user: User }>('/api/auth/me', { method: 'GET' }, onUnauthorized);
}

// Watchlist API methods
export async function getWatchlistsApi(onUnauthorized?: () => void): Promise<{ watchlists: WatchlistSummary[] }> {
  return apiFetch<{ watchlists: WatchlistSummary[] }>('/api/watchlists', { method: 'GET' }, onUnauthorized);
}

export async function createWatchlistApi(name: string, onUnauthorized?: () => void): Promise<WatchlistSummary> {
  return apiFetch<WatchlistSummary>('/api/watchlists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }, onUnauthorized);
}

export async function deleteWatchlistApi(id: number, onUnauthorized?: () => void): Promise<void> {
  await apiFetch<void>(`/api/watchlists/${id}`, { method: 'DELETE' }, onUnauthorized);
}

export async function getWatchlistIntelligenceApi(id: number, onUnauthorized?: () => void): Promise<WatchlistIntelligence> {
  return apiFetch<WatchlistIntelligence>(`/api/watchlists/${id}/intelligence`, { method: 'GET' }, onUnauthorized);
}

export async function checkWatchlistApi(id: number, onUnauthorized?: () => void): Promise<CheckResponse> {
  return apiFetch<CheckResponse>(`/api/watchlists/${id}/check`, { method: 'POST' }, onUnauthorized);
}

export async function addStockToWatchlistApi(watchlistId: number, stockId: number, onUnauthorized?: () => void): Promise<void> {
  await apiFetch<void>(`/api/watchlists/${watchlistId}/stocks`, {
    method: 'POST',
    body: JSON.stringify({ stockId }),
  }, onUnauthorized);
}

export async function removeStockFromWatchlistApi(watchlistId: number, stockId: number, onUnauthorized?: () => void): Promise<void> {
  await apiFetch<void>(`/api/watchlists/${watchlistId}/stocks/${stockId}`, {
    method: 'DELETE',
  }, onUnauthorized);
}

// Stock Catalog & Simulation API methods
export async function getStockCatalogApi(search?: string, onUnauthorized?: () => void): Promise<{ stocks: CatalogStock[] }> {
  const query = search ? `?q=${encodeURIComponent(search)}` : '';
  try {
    return await apiFetch<{ stocks: CatalogStock[] }>(`/api/stocks${query}`, { method: 'GET' }, onUnauthorized);
  } catch {
    // Fallback seed catalog in case stock list route is standard
    const defaultCatalog: CatalogStock[] = [
      { id: 1, symbol: 'TCS', companyName: 'Tata Consultancy Services', exchange: 'NSE' },
      { id: 2, symbol: 'INFY', companyName: 'Infosys', exchange: 'NSE' },
      { id: 3, symbol: 'RELIANCE', companyName: 'Reliance Industries', exchange: 'NSE' },
      { id: 4, symbol: 'HDFCBANK', companyName: 'HDFC Bank', exchange: 'NSE' },
      { id: 5, symbol: 'ICICIBANK', companyName: 'ICICI Bank', exchange: 'NSE' },
      { id: 6, symbol: 'SBIN', companyName: 'State Bank of India', exchange: 'NSE' },
      { id: 7, symbol: 'TATAMOTORS', companyName: 'Tata Motors', exchange: 'NSE' },
      { id: 8, symbol: 'WIPRO', companyName: 'Wipro', exchange: 'NSE' },
    ];
    if (search) {
      const sLower = search.toLowerCase();
      return {
        stocks: defaultCatalog.filter(
          (s) => s.symbol.toLowerCase().includes(sLower) || s.companyName.toLowerCase().includes(sLower)
        ),
      };
    }
    return { stocks: defaultCatalog };
  }
}

export async function simulateScenarioApi(
  stockId: number,
  scenario: 'STABLE' | 'PRICE_MOVE' | 'VOLUME_SPIKE',
  onUnauthorized?: () => void
): Promise<void> {
  await apiFetch<void>('/api/market/simulate', {
    method: 'POST',
    body: JSON.stringify({ stockId, scenario }),
  }, onUnauthorized);
}
