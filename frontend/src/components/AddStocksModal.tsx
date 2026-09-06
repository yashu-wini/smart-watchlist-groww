import React, { useState, useEffect } from 'react';
import { getStockCatalogApi, addStockToWatchlistApi, removeStockFromWatchlistApi, type CatalogStock } from '../api';

interface AddStocksModalProps {
  watchlistId: number;
  watchlistName: string;
  existingStockIds: number[];
  onClose: () => void;
  onStockChanged: () => void;
  onUnauthorized: () => void;
}

export const AddStocksModal: React.FC<AddStocksModalProps> = ({
  watchlistId,
  watchlistName,
  existingStockIds,
  onClose,
  onStockChanged,
  onUnauthorized,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [catalog, setCatalog] = useState<CatalogStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [operatingStockId, setOperatingStockId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set(existingStockIds));

  useEffect(() => {
    setAddedIds(new Set(existingStockIds));
  }, [existingStockIds]);

  useEffect(() => {
    let isMounted = true;
    const loadCatalog = async () => {
      setLoading(true);
      try {
        const data = await getStockCatalogApi(undefined, onUnauthorized);
        if (isMounted) {
          setCatalog(data.stocks);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load stock catalog');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadCatalog();
    return () => {
      isMounted = false;
    };
  }, [onUnauthorized]);

  const filteredStocks = catalog.filter((stock) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      stock.symbol.toLowerCase().includes(q) ||
      stock.companyName.toLowerCase().includes(q) ||
      stock.exchange.toLowerCase().includes(q)
    );
  });

  const handleAddStock = async (stockId: number) => {
    setOperatingStockId(stockId);
    setError(null);
    try {
      await addStockToWatchlistApi(watchlistId, stockId, onUnauthorized);
      setAddedIds((prev) => new Set([...prev, stockId]));
      onStockChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add stock to watchlist');
    } finally {
      setOperatingStockId(null);
    }
  };

  const handleRemoveStock = async (stockId: number) => {
    setOperatingStockId(stockId);
    setError(null);
    try {
      await removeStockFromWatchlistApi(watchlistId, stockId, onUnauthorized);
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(stockId);
        return next;
      });
      onStockChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove stock from watchlist');
    } finally {
      setOperatingStockId(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} id="add-stocks-dialog">
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Manage Stocks</h3>
            <p className="modal-subtitle">Add or remove instruments in <strong>{watchlistName}</strong></p>
          </div>
          <button className="btn-modal-close" onClick={onClose} id="close-modal-btn">
            ✕
          </button>
        </div>

        {error && (
          <div className="notice-banner notice-error modal-alert">
            <span>{error}</span>
          </div>
        )}

        <div className="modal-search-box">
          <input
            id="stock-search-input"
            type="text"
            className="modal-search-input"
            placeholder="Search symbol or company (e.g. TCS, INFY, Reliance)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
        </div>

        <div className="modal-body stock-catalog-list">
          {loading ? (
            <div className="modal-loading-state">
              <span className="button-spinner"></span>
              <span>Loading stock catalog...</span>
            </div>
          ) : filteredStocks.length === 0 ? (
            <div className="modal-empty-state">
              <span>No matching stocks found for "{searchTerm}".</span>
            </div>
          ) : (
            filteredStocks.map((stock) => {
              const isAlreadyAdded = addedIds.has(stock.id);
              const isOperating = operatingStockId === stock.id;

              return (
                <div key={stock.id} className="stock-catalog-item" id={`catalog-item-${stock.id}`}>
                  <div className="stock-catalog-meta">
                    <div className="stock-symbol-row">
                      <span className="stock-catalog-symbol">{stock.symbol}</span>
                      <span className="stock-catalog-exchange">{stock.exchange}</span>
                    </div>
                    <span className="stock-catalog-name">{stock.companyName}</span>
                  </div>

                  <div className="stock-catalog-action">
                    {isAlreadyAdded ? (
                      <div className="added-action-group">
                        <span className="badge-in-watchlist">In Watchlist ✓</span>
                        <button
                          type="button"
                          className="btn-stock-remove-modal"
                          disabled={isOperating}
                          onClick={() => handleRemoveStock(stock.id)}
                          id={`remove-stock-modal-btn-${stock.symbol.toLowerCase()}`}
                        >
                          {isOperating ? <span className="button-spinner"></span> : 'Remove'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-stock-add primary"
                        disabled={isOperating}
                        onClick={() => handleAddStock(stock.id)}
                        id={`add-stock-btn-${stock.symbol.toLowerCase()}`}
                      >
                        {isOperating ? <span className="button-spinner"></span> : '+ Add'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} id="done-add-stocks-btn">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
