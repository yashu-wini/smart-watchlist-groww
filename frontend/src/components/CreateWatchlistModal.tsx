import React, { useState } from 'react';
import { createWatchlistApi, type WatchlistSummary } from '../api';

interface CreateWatchlistModalProps {
  onClose: () => void;
  onWatchlistCreated: (newWatchlist: WatchlistSummary) => void;
  onUnauthorized: () => void;
}

export const CreateWatchlistModal: React.FC<CreateWatchlistModalProps> = ({
  onClose,
  onWatchlistCreated,
  onUnauthorized,
}) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError('Watchlist name cannot be empty.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newWl = await createWatchlistApi(cleanName, onUnauthorized);
      onWatchlistCreated(newWl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create watchlist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog-sm" onClick={(e) => e.stopPropagation()} id="create-watchlist-dialog">
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Create Watchlist</h3>
            <p className="modal-subtitle">Organize your monitored stocks</p>
          </div>
          <button className="btn-modal-close" onClick={onClose} id="close-create-watchlist-btn">
            ✕
          </button>
        </div>

        {error && (
          <div className="notice-banner notice-error modal-alert">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label htmlFor="new-watchlist-name">Watchlist Name</label>
              <input
                id="new-watchlist-name"
                type="text"
                placeholder="e.g., Tech & Banking, Core Holdings"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={loading}
              id="cancel-create-watchlist-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !name.trim()}
              id="confirm-create-watchlist-btn"
            >
              {loading ? <span className="button-spinner"></span> : 'Create Watchlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
