import React from 'react';
import './ConfirmSwapModal.css';

/**
 * Confirmation modal for swapping Player A and B
 */
function ConfirmSwapModal({
    isOpen,
    onConfirm,
    onCancel,
    totalFrames,
    totalBatches,
    batchSize
}) {
    if (!isOpen) return null;

    return (
        <div className="confirm-swap-overlay" onClick={onCancel}>
            <div className="confirm-swap-modal" onClick={(e) => e.stopPropagation()}>
                <div className="confirm-swap-header">
                    <span className="confirm-swap-icon">⚠️</span>
                    <h2>Confirm Swap</h2>
                </div>

                <div className="confirm-swap-body">
                    <p className="confirm-swap-message">
                        Are you sure you want to swap <strong>Player A</strong> and <strong>Player B</strong> for all frames?
                    </p>

                    <div className="confirm-swap-details">
                        <div className="confirm-swap-stat">
                            <span className="stat-label">Total Frames</span>
                            <span className="stat-value">{totalFrames}</span>
                        </div>
                        {totalBatches > 1 && (
                            <div className="confirm-swap-stat">
                                <span className="stat-label">Batches</span>
                                <span className="stat-value">{totalBatches} × {batchSize}</span>
                            </div>
                        )}
                    </div>

                    <p className="confirm-swap-warning">
                        This action will update the database and cannot be easily undone.
                    </p>
                </div>

                <div className="confirm-swap-actions">
                    <button className="confirm-swap-btn cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="confirm-swap-btn confirm" onClick={onConfirm}>
                        Yes, Swap Players
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmSwapModal;
