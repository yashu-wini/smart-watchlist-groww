import React, { useState } from 'react';
import { deleteWatchlistApi } from '../api';

interface DeleteWatchlistModalProps {
  watchlistId: number;
  watchlistName: string;
  onClose: () => void;
  onWatchlistDeleted: (deletedId: number) => void;
  onUnauthorized: () => void;
}

export const DeleteWatchlistModal: React.FC<DeleteWatchlistModalProps> = ({
  watchlistId,
  watchlistName,
  onClose,
  onWatchlistDeleted,
  onUnauthorized,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      await deleteWatchlistApi(watchlistId, onUnauthorized);
      onWatchlistDeleted(watchlistId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete watchlist');
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog-sm" onClick={(e) => e.stopPropagation()} id="delete-watchlist-dialog">
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Delete Watchlist</h3>
            <p className="modal-subtitle">Confirm deletion</p>
          </div>
          <button className="btn-modal-close" onClick={onClose} id="close-delete-dialog-btn">
            ✕
          </button>
        </div>

        {error && (
          <div className="notice-banner notice-error modal-alert">
            <span>{error}</span>
          </div>
        )}

        <div className="modal-body">
          <p className="delete-confirm-text">
            Are you sure you want to delete <strong>"{watchlistName}"</strong>? This will remove all tracked instruments and checkpoints in this watchlist.
          </p>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={loading}
            id="cancel-delete-watchlist-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleDelete}
            disabled={loading}
            id="confirm-delete-watchlist-btn"
          >
            {loading ? <span className="button-spinner"></span> : 'Delete Watchlist'}
          </button>
        </div>
      </div>
    </div>
  );
};
