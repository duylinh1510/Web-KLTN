import torch
import torch.nn as nn
from .spectral import FrequencyDecoupler

"""
F-GNN layer building blocks (paper Sec 3.3 - 3.5).
"""


class FGNNLayer(nn.Module):
    """Spectral enhancement layer (Sec 3.3 - 3.4)."""

    def __init__(self, dim, K, dropout=0.0):
        super().__init__()
        self.dim = dim
        self.decoupler = FrequencyDecoupler(dim, K)
        self.gate_mlp = nn.Sequential(
            nn.Linear(dim, dim), nn.LeakyReLU(0.1),
            nn.Linear(dim, dim), nn.Sigmoid(),
        )
        self.act = nn.LeakyReLU(0.1)
        self.norm = nn.LayerNorm(dim)
        self.dropout = nn.Dropout(dropout)

    def forward(self, X, L):
        amp_low, amp_high, phase = self.decoupler(X, L)
        gamma = self.gate_mlp(amp_low + amp_high)
        amp_tilde = (1.0 - gamma) * amp_low + gamma * amp_high
        Z = amp_tilde * phase
        Z = self.norm(self.act(Z))
        return self.dropout(Z)


class FraudAwareAggregator(nn.Module):
    """Label-aware neighbor fusion (Sec 3.5, Eq. 9-11)."""

    def __init__(self, dim, dropout=0.0, use_degree_norm=True, ego_fusion=True):
        super().__init__()
        self.dim = dim
        self.use_degree_norm = use_degree_norm
        self.ego_fusion = ego_fusion

        self.alpha_mlp = nn.Sequential(nn.Linear(dim, 1), nn.Sigmoid())
        self.att_mlp = nn.Sequential(
            nn.Linear(2 * dim, dim), nn.LeakyReLU(0.1),
            nn.Linear(dim, 1), nn.Sigmoid(),
        )
        self.W = nn.Linear(dim, dim, bias=False)
        self.agg_mlp = nn.Sequential(nn.Linear(dim, dim), nn.LeakyReLU(0.1))

        out_in = 2 * dim if ego_fusion else dim
        self.out_mlp = nn.Sequential(nn.Linear(out_in, dim), nn.LeakyReLU(0.1))
        self.dropout = nn.Dropout(dropout)

    def _compute_omega(self, z_i, z_j, y_j):
        E = z_i.shape[0]
        alpha_i = self.alpha_mlp(z_i)
        is_fraud = (y_j == 1)
        is_benign = (y_j == 0)
        is_unknown = (y_j == -1)

        omega = torch.zeros(E, 1, device=z_i.device)
        if is_fraud.any():
            omega[is_fraud] = alpha_i[is_fraud]
        if is_benign.any():
            omega[is_benign] = (1.0 - alpha_i)[is_benign]
        if is_unknown.any():
            omega[is_unknown] = self.att_mlp(
                torch.cat([z_i[is_unknown], z_j[is_unknown]], dim=-1)
            )
        return omega

    def _aggregate(self, row, omega, z_j, num_nodes):
        weighted = omega * self.W(z_j)
        agg = torch.zeros(num_nodes, self.dim, device=z_j.device)
        agg.index_add_(0, row, weighted)
        if self.use_degree_norm:
            deg = torch.zeros(num_nodes, device=z_j.device)
            deg.index_add_(0, row, torch.ones(row.shape[0], device=z_j.device))
            deg = deg.clamp(min=1).unsqueeze(-1)
            agg = agg / deg
        return self.agg_mlp(agg)

    def forward(self, Z, edge_index, y_masked):
        row, col = edge_index
        N = Z.shape[0]
        z_i, z_j = Z[row], Z[col]
        y_j = y_masked[col]
        omega = self._compute_omega(z_i, z_j, y_j)
        h_i = self._aggregate(row, omega, z_j, N)
        if self.ego_fusion:
            inp = torch.cat([h_i, Z], dim=-1)
        else:
            inp = h_i
        return self.dropout(self.out_mlp(inp))


class FGNNBlock(nn.Module):
    """One full F-GNN layer = spectral + fraud-aware + residual."""

    def __init__(self, dim, K, dropout=0.0):
        super().__init__()
        self.spectral = FGNNLayer(dim, K, dropout=dropout)
        self.fusion = FraudAwareAggregator(dim, dropout=dropout)

    def forward(self, X, L, edge_index, y_masked):
        Z = self.spectral(X, L)
        H = self.fusion(Z, edge_index, y_masked)
        return X + H
