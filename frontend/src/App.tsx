import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import {
  getStoredToken,
  clearStoredToken,
  setStoredToken,
  getMeApi,
  getWatchlistsApi,
  getWatchlistIntelligenceApi,
  checkWatchlistApi,
  removeStockFromWatchlistApi,
  simulateScenarioApi,
  type User,
  type WatchlistSummary,
  type WatchlistIntelligence,
  type CheckResponse,
} from './api';
import { AuthScreen } from './components/AuthScreen';
import { AddStocksModal } from './components/AddStocksModal';
import { CreateWatchlistModal } from './components/CreateWatchlistModal';
import { DeleteWatchlistModal } from './components/DeleteWatchlistModal';

export interface DisplayStockItem {
  stockId: number;
  symbol: string;
  companyName: string;
  exchange: string;
  price: number | null;
  changePercent: number;
  volume: number | null;
  marketTime: string | null;
  attentionLevel: 'NEEDS_ATTENTION' | 'WORTH_WATCHING' | 'NO_MEANINGFUL_CHANGE';
  attentionReason: string;
}

export const App: React.FC = () => {
  // Authentication states
  const [user, setUser] = useState<User | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  // Watchlists states
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [activeWatchlistId, setActiveWatchlistId] = useState<number | null>(null);
  const [loadingWatchlists, setLoadingWatchlists] = useState<boolean>(false);

  // 1. Current Market State (Source: GET /api/watchlists/:id/intelligence)
  // Responsible for: current prices, volumes, watchlist metadata, stock list
  const [currentMarketData, setCurrentMarketData] = useState<WatchlistIntelligence | null>(null);
  const [loadingMarketData, setLoadingMarketData] = useState<boolean>(false);

  // 2. Latest Check Result (Source: POST /api/watchlists/:id/check)
  // Responsible for: changes detected by the user's latest check, attention levels, reasons
  const [latestCheckResult, setLatestCheckResult] = useState<CheckResponse | null>(null);
  const [checkpointTime, setCheckpointTime] = useState<string | null>(null);

  // Operation states
  const [checking, setChecking] = useState<boolean>(false);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Modal & Panel states
  const [showAddStocksModal, setShowAddStocksModal] = useState<boolean>(false);
  const [showCreateWatchlistModal, setShowCreateWatchlistModal] = useState<boolean>(false);
  const [showDeleteWatchlistModal, setShowDeleteWatchlistModal] = useState<boolean>(false);
  const [showDevSimulation, setShowDevSimulation] = useState<boolean>(false);

  // 1. Session Unauthorized handler
  const handleUnauthorized = useCallback(() => {
    clearStoredToken();
    setUser(null);
    setWatchlists([]);
    setActiveWatchlistId(null);
    setCurrentMarketData(null);
    setLatestCheckResult(null);
  }, []);

  // 2. Initial Auth Check on startup
  useEffect(() => {
    const initAuth = async () => {
      const token = getStoredToken();
      if (!token) {
        setIsAuthChecking(false);
        return;
      }

      try {
        const { user: authUser } = await getMeApi(handleUnauthorized);
        setUser(authUser);
      } catch {
        handleUnauthorized();
      } finally {
        setIsAuthChecking(false);
      }
    };

    initAuth();
  }, [handleUnauthorized]);

  // 3. Fetch User Watchlists
  const loadWatchlists = useCallback(async (preferredSelectId?: number) => {
    if (!user) return;
    setLoadingWatchlists(true);
    try {
      const res = await getWatchlistsApi(handleUnauthorized);
      setWatchlists(res.watchlists);

      if (res.watchlists.length > 0) {
        if (preferredSelectId && res.watchlists.some((w) => w.id === preferredSelectId)) {
          setActiveWatchlistId(preferredSelectId);
        } else if (!activeWatchlistId || !res.watchlists.some((w) => w.id === activeWatchlistId)) {
          setActiveWatchlistId(res.watchlists[0].id);
        }
      } else {
        setActiveWatchlistId(null);
        setCurrentMarketData(null);
        setLatestCheckResult(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlists');
    } finally {
      setLoadingWatchlists(false);
    }
  }, [user, activeWatchlistId, handleUnauthorized]);

  // Load watchlists when user authenticates
  useEffect(() => {
    if (user) {
      loadWatchlists();
    }
  }, [user, loadWatchlists]);

  // 4. Fetch Current Market Data for active watchlist (GET /intelligence)
  // MUST NOT clear, replace, or reconstruct latestCheckResult
  const fetchCurrentMarketData = useCallback(async (showLoader = true) => {
    if (!activeWatchlistId) {
      setCurrentMarketData(null);
      return;
    }

    if (showLoader) setLoadingMarketData(true);
    setError(null);

    try {
      const intelligence = await getWatchlistIntelligenceApi(activeWatchlistId, handleUnauthorized);
      setCurrentMarketData(intelligence);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch market data');
    } finally {
      if (showLoader) setLoadingMarketData(false);
    }
  }, [activeWatchlistId, handleUnauthorized]);

  // Trigger market data fetch when active watchlist changes
  useEffect(() => {
    if (activeWatchlistId) {
      setLatestCheckResult(null);
      setCheckpointTime(null);
      fetchCurrentMarketData(true);
    }
  }, [activeWatchlistId, fetchCurrentMarketData]);

  // 5. Auth Success handler
  const handleAuthSuccess = (authUser: User, token: string) => {
    setStoredToken(token);
    setUser(authUser);
    setError(null);
  };

  // 6. Logout handler
  const handleSignOut = () => {
    handleUnauthorized();
  };

  // 7. Checkpoint Check ("Since You Last Checked")
  // Sources attention classifications strictly from POST /check
  const handleCheck = async () => {
    if (!activeWatchlistId) return;
    setChecking(true);
    setError(null);
    try {
      const checkResult = await checkWatchlistApi(activeWatchlistId, handleUnauthorized);
      setLatestCheckResult(checkResult);
      setCheckpointTime(checkResult.checkedAt);

      // Refresh current market data to display latest prices without altering latestCheckResult
      await fetchCurrentMarketData(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to process checkpoint check');
    } finally {
      setChecking(false);
    }
  };

  // 8. Scenario Simulation
  const handleSimulate = async (stockId: number, scenario: 'STABLE' | 'PRICE_MOVE' | 'VOLUME_SPIKE') => {
    setSimulating(true);
    setError(null);
    try {
      await simulateScenarioApi(stockId, scenario, handleUnauthorized);
      await fetchCurrentMarketData(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimulating(false);
    }
  };

  // 9. Remove Stock from Watchlist
  const handleRemoveStock = async (stockId: number) => {
    if (!activeWatchlistId) return;
    try {
      await removeStockFromWatchlistApi(activeWatchlistId, stockId, handleUnauthorized);
      await fetchCurrentMarketData(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove stock');
    }
  };

  // 10. Watchlist Created callback
  const handleWatchlistCreated = (newWatchlist: WatchlistSummary) => {
    setShowCreateWatchlistModal(false);
    setWatchlists((prev) => [...prev, newWatchlist]);
    setActiveWatchlistId(newWatchlist.id);
    setShowAddStocksModal(true);
  };

  // 11. Watchlist Deleted callback
  const handleWatchlistDeleted = (deletedId: number) => {
    setShowDeleteWatchlistModal(false);
    const remaining = watchlists.filter((w) => w.id !== deletedId);
    setWatchlists(remaining);
    if (remaining.length > 0) {
      setActiveWatchlistId(remaining[0].id);
    } else {
      setActiveWatchlistId(null);
      setCurrentMarketData(null);
      setLatestCheckResult(null);
    }
  };

  // Format Helpers
  const formatCurrency = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return '—';
    return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatVolume = (vol: number | null | undefined): string => {
    if (vol === null || vol === undefined) return '—';
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M vol`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K vol`;
    return `${vol.toLocaleString('en-IN')} vol`;
  };

  const formatTime = (timeStr: string | null | undefined): string => {
    if (!timeStr) return '—';
    try {
      const date = new Date(timeStr);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return timeStr;
    }
  };

  // =========================================================================
  // DUAL-SOURCE STATE RECONCILIATION FOR DASHBOARD DISPLAY
  // - ATTENTION CLASSIFICATION & DELTAS <- latestCheckResult (POST /check)
  // - CURRENT PRICES & STOCK METADATA <- currentMarketData (GET /intelligence)
  // =========================================================================
  const allStocksInWatchlist = currentMarketData?.stocks ?? [];

  // Map changes from latest check by stockId
  const checkChangeMap = new Map(
    (latestCheckResult?.changes ?? []).map((change) => [change.stockId, change])
  );

  const displayStocks: DisplayStockItem[] = allStocksInWatchlist.map((stock) => {
    const checkChange = checkChangeMap.get(stock.stockId);

    if (checkChange) {
      // Stock had a meaningful event detected during the user's latest check
      return {
        stockId: stock.stockId,
        symbol: stock.symbol,
        companyName: stock.companyName,
        exchange: stock.exchange,
        price: stock.market?.price ?? checkChange.event.currentPrice,
        changePercent: checkChange.event.priceChangePercent,
        volume: stock.market?.volume ?? checkChange.event.currentVolume,
        marketTime: stock.market?.marketTime ?? null,
        attentionLevel: checkChange.attention.level as 'NEEDS_ATTENTION' | 'WORTH_WATCHING' | 'NO_MEANINGFUL_CHANGE',
        attentionReason: checkChange.attention.reason,
      };
    }

    if (latestCheckResult) {
      // User performed an explicit check, and this stock had NO meaningful change during that check
      return {
        stockId: stock.stockId,
        symbol: stock.symbol,
        companyName: stock.companyName,
        exchange: stock.exchange,
        price: stock.market?.price ?? null,
        changePercent: stock.market?.changePercent ?? 0,
        volume: stock.market?.volume ?? null,
        marketTime: stock.market?.marketTime ?? null,
        attentionLevel: 'NO_MEANINGFUL_CHANGE',
        attentionReason: 'No significant market change detected',
      };
    }

    // Initial page load before user has run a check in this session
    return {
      stockId: stock.stockId,
      symbol: stock.symbol,
      companyName: stock.companyName,
      exchange: stock.exchange,
      price: stock.market?.price ?? null,
      changePercent: stock.market?.changePercent ?? 0,
      volume: stock.market?.volume ?? null,
      marketTime: stock.market?.marketTime ?? null,
      attentionLevel: stock.attention.level,
      attentionReason: stock.attention.reason,
    };
  });

  const needsAttentionList = displayStocks.filter((s) => s.attentionLevel === 'NEEDS_ATTENTION');
  const worthWatchingList = displayStocks.filter((s) => s.attentionLevel === 'WORTH_WATCHING');
  const noMeaningfulChangeList = displayStocks.filter((s) => s.attentionLevel === 'NO_MEANINGFUL_CHANGE');

  // Check if a previous check exists for this watchlist
  const hasEverBeenChecked =
    Boolean(checkpointTime) ||
    Boolean(latestCheckResult) ||
    (allStocksInWatchlist.length > 0 &&
      !allStocksInWatchlist.every((s) => s.attention.reason === 'No previous check available'));

  // Compute signature status text for "Since You Last Checked"
  const getCheckpointHeading = () => {
    if (!hasEverBeenChecked) {
      return "You're seeing your current market snapshot.";
    }
    return "Since you last checked";
  };

  const getCheckpointStatusText = () => {
    if (!hasEverBeenChecked) {
      return "Check now to set your baseline. When you return later, Market Watch will highlight what changed.";
    }

    if (latestCheckResult) {
      if (latestCheckResult.previouslyCheckedAt === null) {
        return "Baseline established. Future price and volume changes will be compared against this checkpoint.";
      }
      const count = latestCheckResult.changes.length;
      if (count === 0) {
        return "You're all caught up.";
      }
      return `${count} meaningful ${count === 1 ? 'change' : 'changes'} since you last checked.`;
    }

    const meaningfulCount = needsAttentionList.length + worthWatchingList.length;
    if (meaningfulCount === 0) {
      return "You're all caught up.";
    }
    return `${meaningfulCount} meaningful ${meaningfulCount === 1 ? 'change' : 'changes'} since you last checked.`;
  };

  // 1. Loading Startup Screen
  if (isAuthChecking) {
    return (
      <div className="auth-loading-screen">
        <div className="panel-spinner"></div>
        <p className="loading-text">Loading Market Watch...</p>
      </div>
    );
  }

  // 2. Unauthenticated Screen
  if (!user) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  // Active watchlist object
  const activeWatchlist = watchlists.find((w) => w.id === activeWatchlistId);

  // 3. Authenticated Dashboard Screen
  return (
    <div className="app-layout">
      {/* Top Header */}
      <header className="app-header" id="app-header">
        <div className="header-container">
          <div className="brand-group">
            <div className="brand-logo-mark">
              <span className="logo-dot"></span>
            </div>
            <div>
              <h1 className="brand-title" id="main-title">Market Watch</h1>
              <p className="brand-tagline" id="main-subtitle">Know what changed since you last checked.</p>
            </div>
          </div>

          <div className="header-meta">
            <div className="live-status-pill" id="live-indicator">
              <span className="status-dot"></span>
              <span className="status-text">Live feed</span>
            </div>
            <span className="sync-time" id="sync-time">
              Synced {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>

            {/* Subtle User Identity & Sign Out */}
            <div className="user-identity-group" id="user-identity-group">
              <div className="user-badge" id="user-email-badge">
                <span className="user-icon">👤</span>
                <span className="user-email">{user.email}</span>
              </div>
              <button
                type="button"
                className="btn-signout"
                onClick={handleSignOut}
                id="signout-btn"
                title="Sign out of your account"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="main-content">
        {/* Error Notification */}
        {error && (
          <div className="notice-banner notice-error" id="error-banner">
            <div className="notice-body">
              <strong>Notice:</strong> {error}
            </div>
            <button className="btn-notice-action" onClick={() => fetchCurrentMarketData(true)} id="retry-btn">
              Retry
            </button>
          </div>
        )}

        {/* Watchlist Header / Control Bar */}
        <section className="watchlist-control-bar" id="watchlist-control-bar">
          <div className="watchlist-selector-wrap">
            {watchlists.length > 0 ? (
              <div className="watchlist-dropdown-group">
                <select
                  className="watchlist-select-dropdown"
                  id="watchlist-select"
                  value={activeWatchlistId ?? ''}
                  onChange={(e) => setActiveWatchlistId(Number(e.target.value))}
                  disabled={loadingWatchlists}
                  aria-label="Select Watchlist"
                >
                  {watchlists.map((wl) => (
                    <option key={wl.id} value={wl.id}>
                      {wl.name}
                    </option>
                  ))}
                </select>
                <span className="watchlist-instrument-count">({allStocksInWatchlist.length} stocks)</span>
              </div>
            ) : (
              <div className="watchlist-selector">
                <span className="watchlist-name">No Watchlists</span>
              </div>
            )}

            <button
              type="button"
              className="btn-text-action btn-new-wl"
              onClick={() => setShowCreateWatchlistModal(true)}
              id="btn-new-watchlist"
            >
              + New Watchlist
            </button>

            {activeWatchlist && (
              <button
                type="button"
                className="btn-text-action btn-delete-wl"
                onClick={() => setShowDeleteWatchlistModal(true)}
                id="btn-delete-watchlist"
                title="Delete this watchlist"
              >
                🗑️ Delete
              </button>
            )}
          </div>

          <div className="watchlist-actions-right">
            {activeWatchlistId && (
              <button
                type="button"
                className="btn-action-primary"
                onClick={() => setShowAddStocksModal(true)}
                id="btn-add-stocks"
              >
                + Add Stocks
              </button>
            )}

            <button
              className="btn-text-action"
              onClick={() => fetchCurrentMarketData(true)}
              disabled={loadingMarketData || checking || !activeWatchlistId}
              id="refresh-btn"
            >
              <span className={loadingMarketData ? 'spin-icon' : ''}>↻</span> Refresh
            </button>
          </div>
        </section>

        {/* 1. STATE: User Has No Watchlists */}
        {watchlists.length === 0 && !loadingWatchlists && (
          <div className="state-empty-panel state-zero-watchlists" id="zero-watchlists-panel">
            <div className="empty-panel-icon">📊</div>
            <h3>No watchlists yet</h3>
            <p>Create your first watchlist to start monitoring market instruments.</p>
            <button
              type="button"
              className="btn-primary btn-empty-cta"
              onClick={() => setShowCreateWatchlistModal(true)}
              id="create-first-watchlist-btn"
            >
              + Create Watchlist
            </button>
          </div>
        )}

        {/* 2. STATE: Active Watchlist Has No Stocks */}
        {watchlists.length > 0 && allStocksInWatchlist.length === 0 && !loadingMarketData && (
          <div className="state-empty-panel" id="empty-stocks-panel">
            <div className="empty-panel-icon">📈</div>
            <h3>Your watchlist is empty</h3>
            <p>Add stocks to start tracking meaningful market changes.</p>
            <button
              type="button"
              className="btn-primary btn-empty-cta"
              onClick={() => setShowAddStocksModal(true)}
              id="add-first-stocks-btn"
            >
              + Add Stocks
            </button>
          </div>
        )}

        {/* Loading Spinner for Market Data */}
        {loadingMarketData && !currentMarketData && (
          <div className="state-empty-panel" id="loading-spinner">
            <div className="panel-spinner"></div>
            <p>Loading market intelligence...</p>
          </div>
        )}

        {/* 3. DASHBOARD CONTENT (When stocks exist) */}
        {allStocksInWatchlist.length > 0 && (
          <>
            {/* Attention Summary Row */}
            <section className="summary-section" id="summary-section">
              <div className="summary-grid">
                <div className="summary-tile tile-attention" id="summary-card-needs-attention">
                  <div className="summary-top">
                    <span className="summary-dot dot-red"></span>
                    <span className="summary-title">Needs Attention</span>
                  </div>
                  <div className="summary-number" id="count-needs-attention">
                    {loadingMarketData && !currentMarketData ? '—' : needsAttentionList.length}
                  </div>
                  <div className="summary-desc">High priority movements</div>
                </div>

                <div className="summary-tile tile-watching" id="summary-card-worth-watching">
                  <div className="summary-top">
                    <span className="summary-dot dot-amber"></span>
                    <span className="summary-title">Worth Watching</span>
                  </div>
                  <div className="summary-number" id="count-worth-watching">
                    {loadingMarketData && !currentMarketData ? '—' : worthWatchingList.length}
                  </div>
                  <div className="summary-desc">Unusual activity & spikes</div>
                </div>

                <div className="summary-tile tile-stable" id="summary-card-no-change">
                  <div className="summary-top">
                    <span className="summary-dot dot-green"></span>
                    <span className="summary-title">Stable</span>
                  </div>
                  <div className="summary-number" id="count-no-change">
                    {loadingMarketData && !currentMarketData ? '—' : noMeaningfulChangeList.length}
                  </div>
                  <div className="summary-desc">No major changes</div>
                </div>
              </div>
            </section>

            {/* "Since You Last Checked" Signature Action Section */}
            <section className="checkpoint-card" id="checkpoint-section">
              <div className="checkpoint-header-row">
                <div className="checkpoint-title-group">
                  <h2 className="checkpoint-heading">{getCheckpointHeading()}</h2>
                  <span className="checkpoint-timestamp" id="checkpoint-timestamp">
                    {hasEverBeenChecked && checkpointTime
                      ? `Last checked: ${formatTime(checkpointTime)}`
                      : hasEverBeenChecked
                      ? 'Baseline active'
                      : 'Pending baseline check'}
                  </span>
                </div>

                <button
                  className="btn-check-action"
                  onClick={handleCheck}
                  disabled={checking || loadingMarketData}
                  id="check-for-changes-btn"
                >
                  {checking ? (
                    <>
                      <span className="button-spinner"></span>
                      <span>Evaluating...</span>
                    </>
                  ) : (
                    <>
                      <span>Check for Changes</span>
                    </>
                  )}
                </button>
              </div>

              <div className="checkpoint-status-text" id="checkpoint-status-text">
                {getCheckpointStatusText()}
              </div>
            </section>

            {/* 1. SECTION: NEEDS ATTENTION (Dominant Visual Hierarchy - from Latest Check) */}
            <section className="priority-section section-needs-attention" id="section-needs-attention">
              <div className="section-header">
                <div className="section-title-wrap">
                  <span className="indicator-icon icon-red">●</span>
                  <h3 className="section-heading">Needs Attention</h3>
                </div>
                <span className="section-subtext">High priority movements requiring attention.</span>
              </div>

              {needsAttentionList.length > 0 ? (
                <div className="stock-cards-stack">
                  {needsAttentionList.map((stock) => {
                    const change = stock.changePercent;
                    const isPositive = change > 0;
                    const isNegative = change < 0;
                    const arrow = isPositive ? '↑' : isNegative ? '↓' : '→';
                    const changeClass = isPositive ? 'text-green' : isNegative ? 'text-red' : 'text-muted';

                    return (
                      <article key={stock.stockId} className="stock-card card-attention-level" id={`stock-card-${stock.stockId}`}>
                        {/* Top Row: Identity, Badge & Delete */}
                        <div className="card-top-row">
                          <div className="stock-meta-left">
                            <div className="symbol-group">
                              <span className="stock-symbol" id={`symbol-${stock.stockId}`}>{stock.symbol}</span>
                              <span className="company-name" id={`company-${stock.stockId}`}>{stock.companyName}</span>
                              <span className="exchange-tag" id={`exchange-${stock.stockId}`}>{stock.exchange}</span>
                            </div>
                          </div>

                          <div className="card-top-actions">
                            <div className="attention-tag tag-red" id={`attention-badge-${stock.stockId}`}>
                              <span className="tag-dot"></span>
                              <span>Needs Attention</span>
                            </div>
                            <button
                              type="button"
                              className="btn-stock-remove"
                              onClick={() => handleRemoveStock(stock.stockId)}
                              id={`remove-stock-${stock.stockId}`}
                              title="Remove from watchlist"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Middle Row: Price & Market Data */}
                        {stock.price !== null ? (
                          <div className="card-market-row">
                            <div className="price-group">
                              <span className="stock-price" id={`price-${stock.stockId}`}>{formatCurrency(stock.price)}</span>
                              <span className={`stock-change ${changeClass}`} id={`change-${stock.stockId}`}>
                                {isPositive ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`} {arrow}
                              </span>
                              <span className="stock-volume" id={`volume-${stock.stockId}`}>{formatVolume(stock.volume)}</span>
                            </div>
                            <span className="market-timestamp" id={`time-${stock.stockId}`}>
                              {formatTime(stock.marketTime)}
                            </span>
                          </div>
                        ) : (
                          <div className="market-unavailable-line" id={`unavailable-${stock.stockId}`}>
                            Market data unavailable for this instrument
                          </div>
                        )}

                        {/* Bottom Row: Human-Readable Reason & Why This Matters */}
                        <div className="card-reason-row" id={`reason-${stock.stockId}`}>
                          <span className="reason-caption">Why this matters:</span>
                          <span className="reason-description">{stock.attentionReason}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="reassuring-box" id="no-attention-notice">
                  <span className="check-icon">✓</span>
                  <span>Nothing requires high priority attention right now.</span>
                </div>
              )}
            </section>

            {/* 2. SECTION: WORTH WATCHING (from Latest Check) */}
            {worthWatchingList.length > 0 && (
              <section className="priority-section section-worth-watching" id="section-worth-watching">
                <div className="section-header">
                  <div className="section-title-wrap">
                    <span className="indicator-icon icon-amber">●</span>
                    <h3 className="section-heading">Worth Watching</h3>
                  </div>
                  <span className="section-subtext">Unusual activity that may be worth monitoring.</span>
                </div>

                <div className="stock-cards-stack">
                  {worthWatchingList.map((stock) => {
                    const change = stock.changePercent;
                    const isPositive = change > 0;
                    const isNegative = change < 0;
                    const arrow = isPositive ? '↑' : isNegative ? '↓' : '→';
                    const changeClass = isPositive ? 'text-green' : isNegative ? 'text-red' : 'text-muted';

                    return (
                      <article key={stock.stockId} className="stock-card card-watching-level" id={`stock-card-${stock.stockId}`}>
                        <div className="card-top-row">
                          <div className="stock-meta-left">
                            <div className="symbol-group">
                              <span className="stock-symbol" id={`symbol-${stock.stockId}`}>{stock.symbol}</span>
                              <span className="company-name" id={`company-${stock.stockId}`}>{stock.companyName}</span>
                              <span className="exchange-tag" id={`exchange-${stock.stockId}`}>{stock.exchange}</span>
                            </div>
                          </div>

                          <div className="card-top-actions">
                            <div className="attention-tag tag-amber" id={`attention-badge-${stock.stockId}`}>
                              <span className="tag-dot"></span>
                              <span>Worth Watching</span>
                            </div>
                            <button
                              type="button"
                              className="btn-stock-remove"
                              onClick={() => handleRemoveStock(stock.stockId)}
                              id={`remove-stock-${stock.stockId}`}
                              title="Remove from watchlist"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {stock.price !== null ? (
                          <div className="card-market-row">
                            <div className="price-group">
                              <span className="stock-price" id={`price-${stock.stockId}`}>{formatCurrency(stock.price)}</span>
                              <span className={`stock-change ${changeClass}`} id={`change-${stock.stockId}`}>
                                {isPositive ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`} {arrow}
                              </span>
                              <span className="stock-volume" id={`volume-${stock.stockId}`}>{formatVolume(stock.volume)}</span>
                            </div>
                            <span className="market-timestamp" id={`time-${stock.stockId}`}>
                              {formatTime(stock.marketTime)}
                            </span>
                          </div>
                        ) : (
                          <div className="market-unavailable-line" id={`unavailable-${stock.stockId}`}>
                            Market data unavailable
                          </div>
                        )}

                        <div className="card-reason-row" id={`reason-${stock.stockId}`}>
                          <span className="reason-caption">Why this matters:</span>
                          <span className="reason-description">{stock.attentionReason}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. SECTION: NO MEANINGFUL CHANGE (Compact, Quiet List Treatment) */}
            {noMeaningfulChangeList.length > 0 && (
              <section className="priority-section section-stable-quiet" id="section-no-meaningful-change">
                <div className="section-header">
                  <div className="section-title-wrap">
                    <span className="indicator-icon icon-muted">●</span>
                    <h3 className="section-heading text-quiet">No meaningful change</h3>
                  </div>
                  <span className="section-subtext">Stable within normal market volatility.</span>
                </div>

                <div className="quiet-table-container">
                  <div className="quiet-table-header">
                    <span className="col-instrument">Instrument</span>
                    <span className="col-price">Price</span>
                    <span className="col-change">Change</span>
                    <span className="col-volume">Volume</span>
                    <span className="col-status">Status</span>
                    <span className="col-action">Action</span>
                  </div>

                  <div className="quiet-table-rows">
                    {noMeaningfulChangeList.map((stock) => {
                      const change = stock.changePercent;
                      const isPositive = change > 0;
                      const isNegative = change < 0;
                      const arrow = isPositive ? '↑' : isNegative ? '↓' : '→';
                      const changeClass = isPositive ? 'text-green' : isNegative ? 'text-red' : 'text-muted';

                      return (
                        <div key={stock.stockId} className="quiet-stock-row" id={`stock-card-${stock.stockId}`}>
                          <div className="col-instrument">
                            <span className="quiet-symbol" id={`symbol-${stock.stockId}`}>{stock.symbol}</span>
                            <span className="quiet-company" id={`company-${stock.stockId}`}>{stock.companyName}</span>
                          </div>

                          <div className="col-price" id={`price-${stock.stockId}`}>
                            {formatCurrency(stock.price)}
                          </div>

                          <div className={`col-change ${changeClass}`} id={`change-${stock.stockId}`}>
                            {stock.price !== null ? `${isPositive ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`} ${arrow}` : '—'}
                          </div>

                          <div className="col-volume" id={`volume-${stock.stockId}`}>
                            {formatVolume(stock.volume)}
                          </div>

                          <div className="col-status">
                            <span className="quiet-status-tag" id={`attention-badge-${stock.stockId}`}>Stable</span>
                          </div>

                          <div className="col-action">
                            <button
                              type="button"
                              className="btn-quiet-remove"
                              onClick={() => handleRemoveStock(stock.stockId)}
                              id={`remove-quiet-stock-${stock.stockId}`}
                              title="Remove from watchlist"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* 4. DEVELOPER SIMULATION CONTROLS (Collapsed by Default) */}
            <section className="demo-simulation-panel" id="evaluator-dock">
              <div
                className="demo-panel-header demo-toggle-header"
                onClick={() => setShowDevSimulation((prev) => !prev)}
                role="button"
                tabIndex={0}
              >
                <div>
                  <h4 className="demo-title">
                    {showDevSimulation ? '▼' : '▶'} Developer Demo Controls
                  </h4>
                  <p className="demo-subtitle">
                    Simulate price moves and volume spikes to test attention triggers. (Collapsed by default)
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-toggle-demo"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDevSimulation((prev) => !prev);
                  }}
                >
                  {showDevSimulation ? 'Hide Controls ▴' : 'Show Controls ▾'}
                </button>
              </div>

              {showDevSimulation && (
                <div className="demo-stocks-list">
                  {allStocksInWatchlist.map((stock) => (
                    <div key={stock.stockId} className="demo-stock-item" id={`dock-stock-${stock.stockId}`}>
                      <span className="demo-stock-symbol">{stock.symbol}</span>
                      <div className="demo-actions-group">
                        <button
                          className="btn-demo-action btn-action-move"
                          disabled={simulating || checking}
                          onClick={() => handleSimulate(stock.stockId, 'PRICE_MOVE')}
                          id={`dock-move-${stock.stockId}`}
                        >
                          +4.5% Price Jump
                        </button>
                        <button
                          className="btn-demo-action btn-action-volume"
                          disabled={simulating || checking}
                          onClick={() => handleSimulate(stock.stockId, 'VOLUME_SPIKE')}
                          id={`dock-volume-${stock.stockId}`}
                        >
                          2.5x Volume Spike
                        </button>
                        <button
                          className="btn-demo-action btn-action-stable"
                          disabled={simulating || checking}
                          onClick={() => handleSimulate(stock.stockId, 'STABLE')}
                          id={`dock-stable-${stock.stockId}`}
                        >
                          Reset Stable
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Modals */}
      {showAddStocksModal && activeWatchlistId && (
        <AddStocksModal
          watchlistId={activeWatchlistId}
          watchlistName={activeWatchlist?.name ?? 'Watchlist'}
          existingStockIds={allStocksInWatchlist.map((s) => s.stockId)}
          onClose={() => setShowAddStocksModal(false)}
          onStockChanged={() => fetchCurrentMarketData(false)}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {showCreateWatchlistModal && (
        <CreateWatchlistModal
          onClose={() => setShowCreateWatchlistModal(false)}
          onWatchlistCreated={handleWatchlistCreated}
          onUnauthorized={handleUnauthorized}
        />
      )}

      {showDeleteWatchlistModal && activeWatchlistId && activeWatchlist && (
        <DeleteWatchlistModal
          watchlistId={activeWatchlistId}
          watchlistName={activeWatchlist.name}
          onClose={() => setShowDeleteWatchlistModal(false)}
          onWatchlistDeleted={handleWatchlistDeleted}
          onUnauthorized={handleUnauthorized}
        />
      )}
    </div>
  );
};

export default App;
