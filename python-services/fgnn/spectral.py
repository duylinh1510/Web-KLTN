import torch
import torch.nn as nn

"""
Chebyshev-polynomial spectral components for F-GNN
(paper Sec 3.3 - 3.4, Sec 3.7).
"""


def _spmm(L, X):
    if L.is_sparse:
        return torch.sparse.mm(L, X)
    return L @ X


class ChebFilterLow(nn.Module):
    """Learnable low-pass Chebyshev filter g(L)."""

    def __init__(self, dim, K):
        super().__init__()
        self.K = K
        self.dim = dim
        self.theta = nn.Parameter(self._init_theta(K, dim))

    @staticmethod
    def _init_theta(K, dim):
        theta = torch.zeros(K, dim)
        theta[0].fill_(1.0)
        theta = theta + 0.01 * torch.randn(K, dim)
        return theta

    def _cheb_step(self, L, Tx_prev, Tx_curr):
        return 2.0 * _spmm(L, Tx_curr) - Tx_prev

    def forward(self, X, L):
        Tx_prev = X
        out = Tx_prev * self.theta[0]

        if self.K > 1:
            Tx_curr = _spmm(L, X)
            out = out + Tx_curr * self.theta[1]

            for k in range(2, self.K):
                Tx_next = self._cheb_step(L, Tx_prev, Tx_curr)
                out = out + Tx_next * self.theta[k]
                Tx_prev, Tx_curr = Tx_curr, Tx_next

        return out


class FrequencyDecoupler(nn.Module):
    """Split node features into low / high frequency bands."""

    def __init__(self, dim, K, eps=1e-8):
        super().__init__()
        self.eps = eps
        self.low_filter = ChebFilterLow(dim, K)

    def _amplitudes(self, X_low, X_high):
        return torch.abs(X_low), torch.abs(X_high)

    def _phase(self, X):
        return X / (torch.abs(X) + self.eps)

    def forward(self, X, L):
        X_low = self.low_filter(X, L)
        X_high = X - X_low
        amp_low, amp_high = self._amplitudes(X_low, X_high)
        phase = self._phase(X)
        return amp_low, amp_high, phase
