import torch
import torch.nn as nn

"""
Chebyshev-polynomial spectral components for F-GNN
(paper Sec 3.3 - 3.4, Sec 3.7).

ChebFilterLow:
    Learnable low-pass filter g(L) applied without explicit
    eigendecomposition. Uses the Chebyshev recurrence
        T_0(L) = I,   T_1(L) = L,   T_k(L) = 2 L T_{k-1}(L) - T_{k-2}(L)
    Theta is per-order per-feature; feature channels are not mixed
    by the filter itself.

FrequencyDecoupler:
    X_low  = G_low(L) X
    X_high = X - X_low                        (Eq. 6, G_high = I - G_low)
    Amp    = |.|,    Phase = X / (|X| + eps)  (real-signal unit direction)
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _spmm(L, X):
    """
    =======================
    Sparse × dense matmul with a dense fallback
    =======================
    If L is a sparse tensor, use torch.sparse.mm; otherwise fall back
    to the regular @ operator. Keeps the rest of the codebase unaware
    of the storage format.
    """
    if L.is_sparse:
        return torch.sparse.mm(L, X)
    return L @ X


# ---------------------------------------------------------------------------
# Chebyshev low-pass filter
# ---------------------------------------------------------------------------


class ChebFilterLow(nn.Module):
    """
    =======================
    Learnable low-pass Chebyshev filter g(L)
    =======================
    g(L) X = sum_{k=0..K-1} theta_k ⊙ T_k(L) X
    theta: [K, dim] — per-order, per-feature spectral coefficients.
    Initialized so g(L) ≈ I at start (theta_0 ≈ 1, others ≈ 0).
    """

    def __init__(self, dim, K):
        super().__init__()
        self.K = K
        self.dim = dim
        self.theta = nn.Parameter(self._init_theta(K, dim))

    @staticmethod
    def _init_theta(K, dim):
        """
        =======================
        Initialize spectral coefficients close to identity
        =======================
        theta_0 starts at ~1 and higher-order coefficients at ~0 so
        that g(L) X ≈ X at iteration zero, stabilizing early training.
        """
        theta = torch.zeros(K, dim)
        theta[0].fill_(1.0)
        theta = theta + 0.01 * torch.randn(K, dim)
        return theta

    def _cheb_step(self, L, Tx_prev, Tx_curr):
        """
        =======================
        One step of the Chebyshev recurrence
        =======================
        T_k(L) X = 2 L T_{k-1}(L) X - T_{k-2}(L) X
        """
        return 2.0 * _spmm(L, Tx_curr) - Tx_prev

    def forward(self, X, L):
        """
        =======================
        Apply the learned low-pass filter
        =======================
        Args:
            X: [N, dim] node features.
            L: [N, N] (sparse or dense) normalized Laplacian.
        Returns:
            [N, dim] filtered features.
        """
        Tx_prev = X                              # T_0(L) X = X
        out = Tx_prev * self.theta[0]

        if self.K > 1:
            Tx_curr = _spmm(L, X)                # T_1(L) X = L X
            out = out + Tx_curr * self.theta[1]

            for k in range(2, self.K):
                Tx_next = self._cheb_step(L, Tx_prev, Tx_curr)
                out = out + Tx_next * self.theta[k]
                Tx_prev, Tx_curr = Tx_curr, Tx_next

        return out


# ---------------------------------------------------------------------------
# Frequency decoupling
# ---------------------------------------------------------------------------


class FrequencyDecoupler(nn.Module):
    """
    =======================
    Split node features into low / high frequency bands
    =======================
    Low band is produced by ChebFilterLow; the high band is defined
    complementarily as X - X_low, matching G_high = I - G_low in the
    spectral domain (paper Eq. 6).
    """

    def __init__(self, dim, K, eps=1e-8):
        super().__init__()
        self.eps = eps
        self.low_filter = ChebFilterLow(dim, K)

    def _amplitudes(self, X_low, X_high):
        """
        =======================
        Per-band amplitudes
        =======================
        Amp_low = |X_low|,  Amp_high = |X_high|.
        """
        return torch.abs(X_low), torch.abs(X_high)

    def _phase(self, X):
        """
        =======================
        Unit-direction phase surrogate
        =======================
        For real-valued signals (Chebyshev realization), arg(x̂) is
        approximated by the sign of X, i.e. X / (|X| + eps).
        """
        return X / (torch.abs(X) + self.eps)

    def forward(self, X, L):
        """
        =======================
        Forward pass
        =======================
        Returns:
            amp_low  : [N, dim]
            amp_high : [N, dim]
            phase    : [N, dim]
        """
        X_low  = self.low_filter(X, L)
        X_high = X - X_low

        amp_low, amp_high = self._amplitudes(X_low, X_high)
        phase = self._phase(X)
        return amp_low, amp_high, phase