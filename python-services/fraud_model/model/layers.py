import torch
import torch.nn as nn
from .spectral import FrequencyDecoupler

"""
F-GNN layer building blocks (paper Sec 3.3 - 3.5).

FGNNLayer
    Spectral enhancement = frequency decoupling + node-adaptive gating.

FraudAwareAggregator
    Label-aware neighbor fusion (Eq. 9-11) with an explicit
    `y_masked` interface (-1 = unknown). Both train and inference
    use the same code path so MLP_att keeps receiving gradients.

FGNNBlock
    One full paper-defined F-GNN layer = FGNNLayer + FraudAwareAggregator
    with a residual skip connection.
"""


# ---------------------------------------------------------------------------
# Spectral enhancement layer
# ---------------------------------------------------------------------------


class FGNNLayer(nn.Module):
    """
    =======================
    Spectral enhancement layer (Sec 3.3 - 3.4)
    =======================
    Acts on features already projected to `dim`:
        (amp_low, amp_high, phase) = FrequencyDecoupler(X, L)
        gamma_i  = sigma(MLP_gamma(Amp(x_i)))             (Eq. 7)
        amp_tilde = (1 - gamma) ⊙ amp_low + gamma ⊙ amp_high
        Z         = amp_tilde ⊙ phase                     (Eq. 8)
        Z         = LayerNorm(LeakyReLU(Z))
    """

    def __init__(self, dim, K, dropout=0.0):
        super().__init__()
        self.dim = dim

        self.decoupler = FrequencyDecoupler(dim, K)
        self.gate_mlp  = self._build_gate_mlp(dim)

        self.act  = nn.LeakyReLU(0.1)
        self.norm = nn.LayerNorm(dim)
        self.dropout = nn.Dropout(dropout)

    @staticmethod
    def _build_gate_mlp(dim):
        """
        =======================
        Node-adaptive gating MLP
        =======================
        Maps Amp(x_i) in R^dim to gamma_i in [0,1]^dim via
        Linear → LeakyReLU → Linear → Sigmoid.
        """
        return nn.Sequential(
            nn.Linear(dim, dim),
            nn.LeakyReLU(0.1),
            nn.Linear(dim, dim),
            nn.Sigmoid(),
        )

    def _compute_gate(self, amp_low, amp_high):
        """
        =======================
        Compute gamma_i from overall amplitude
        =======================
        Uses (amp_low + amp_high) as a triangle-inequality proxy for
        the full spectral amplitude |x̂_i|.
        """
        amp = amp_low + amp_high
        return self.gate_mlp(amp)

    def _reconstruct(self, amp_tilde, phase):
        """
        =======================
        Reconstruct the enhanced signal
        =======================
        Z = amp_tilde ⊙ phase (Eq. 8, Chebyshev realization),
        followed by LeakyReLU, LayerNorm and Dropout.
        """
        Z = amp_tilde * phase
        Z = self.norm(self.act(Z))
        return self.dropout(Z)

    def forward(self, X, L):
        """
        =======================
        Forward pass
        =======================
        """
        amp_low, amp_high, phase = self.decoupler(X, L)
        gamma = self._compute_gate(amp_low, amp_high)
        amp_tilde = (1.0 - gamma) * amp_low + gamma * amp_high
        return self._reconstruct(amp_tilde, phase)


# ---------------------------------------------------------------------------
# Fraud-aware neighbor aggregation
# ---------------------------------------------------------------------------


class FraudAwareAggregator(nn.Module):
    """
    =======================
    Label-aware neighbor fusion (Sec 3.5, Eq. 9-11)
    =======================
    Neighbor weight omega_ij depends on the neighbor's (masked) label:
        y_j =  1 -> omega_ij = alpha_i              (fraud)
        y_j =  0 -> omega_ij = 1 - alpha_i          (benign)
        y_j = -1 -> omega_ij = MLP_att(z_i, z_j)    (unknown)
    """

    def __init__(self, dim, dropout=0.0,
                 use_degree_norm=True, ego_fusion=True):
        super().__init__()
        self.dim = dim
        self.use_degree_norm = use_degree_norm
        self.ego_fusion = ego_fusion

        self.alpha_mlp = nn.Sequential(nn.Linear(dim, 1), nn.Sigmoid())
        self.att_mlp   = self._build_att_mlp(dim)

        self.W       = nn.Linear(dim, dim, bias=False)
        self.agg_mlp = nn.Sequential(nn.Linear(dim, dim), nn.LeakyReLU(0.1))

        out_in = 2 * dim if ego_fusion else dim
        self.out_mlp = nn.Sequential(nn.Linear(out_in, dim), nn.LeakyReLU(0.1))

        self.dropout = nn.Dropout(dropout)

    @staticmethod
    def _build_att_mlp(dim):
        """
        =======================
        Attention MLP for unknown neighbors
        =======================
        Concatenates [z_i, z_j] then reduces to a scalar in [0, 1].
        """
        return nn.Sequential(
            nn.Linear(2 * dim, dim),
            nn.LeakyReLU(0.1),
            nn.Linear(dim, 1),
            nn.Sigmoid(),
        )

    # ----- stepwise helpers -----

    def _compute_omega(self, z_i, z_j, y_j):
        """
        =======================
        Per-edge fusion weight omega_ij (Eq. 10)
        =======================
        Three branches selected by the neighbor label:
            1  -> alpha_i
            0  -> 1 - alpha_i
           -1  -> MLP_att(z_i, z_j)
        """
        E = z_i.shape[0]
        alpha_i = self.alpha_mlp(z_i)                    # [E, 1]

        is_fraud   = (y_j == 1)
        is_benign  = (y_j == 0)
        is_unknown = (y_j == -1)

        omega = torch.zeros(E, 1, device=z_i.device)
        if is_fraud.any():
            omega[is_fraud]  = alpha_i[is_fraud]
        if is_benign.any():
            omega[is_benign] = (1.0 - alpha_i)[is_benign]
        if is_unknown.any():
            omega[is_unknown] = self.att_mlp(
                torch.cat([z_i[is_unknown], z_j[is_unknown]], dim=-1)
            )
        return omega

    def _aggregate(self, row, omega, z_j, num_nodes):
        """
        =======================
        Weighted neighbor aggregation (Eq. 9)
        =======================
        h_i = sum_{j in N(i)} omega_ij · W z_j, followed by an
        optional degree normalization for stability (not in the
        paper's equation but standard practice).
        """
        weighted = omega * self.W(z_j)                    # [E, dim]

        agg = torch.zeros(num_nodes, self.dim, device=z_j.device)
        agg.index_add_(0, row, weighted)

        if self.use_degree_norm:
            deg = torch.zeros(num_nodes, device=z_j.device)
            deg.index_add_(0, row, torch.ones(row.shape[0], device=z_j.device))
            deg = deg.clamp(min=1).unsqueeze(-1)
            agg = agg / deg

        return self.agg_mlp(agg)

    def _fuse(self, h_i, Z):
        """
        =======================
        Ego / neighbor fusion (Eq. 11, GraphSAGE-style)
        =======================
        If `ego_fusion` is enabled, concatenates the aggregated
        neighbor representation with the node's own feature before
        the output MLP.
        """
        if self.ego_fusion:
            inp = torch.cat([h_i, Z], dim=-1)
        else:
            inp = h_i
        return self.dropout(self.out_mlp(inp))

    # ----- forward -----

    def forward(self, Z, edge_index, y_masked):
        """
        =======================
        Forward pass
        =======================
        Args:
            Z          : [N, dim] node features from FGNNLayer.
            edge_index : [2, E] long tensor.
            y_masked   : [N] long tensor in {-1, 0, 1}.
        """
        row, col = edge_index
        N = Z.shape[0]

        z_i = Z[row]
        z_j = Z[col]
        y_j = y_masked[col]

        omega = self._compute_omega(z_i, z_j, y_j)
        h_i   = self._aggregate(row, omega, z_j, N)
        return self._fuse(h_i, Z)


# ---------------------------------------------------------------------------
# Full F-GNN block = spectral + fraud-aware + residual
# ---------------------------------------------------------------------------


class FGNNBlock(nn.Module):
    """
    =======================
    One full F-GNN layer (Sec 3.2)
    =======================
    Sequentially applies spectral enhancement and fraud-aware
    aggregation, then adds a residual skip connection.

    FIX (residual double-counting): The original code did X + H where
    H = out_mlp([h_i, Z]) already contains Z internally (ego_fusion).
    This caused Z to be counted twice — once inside H and once via X
    (which equals the input to the spectral layer). The fix uses Z + H
    so the residual skips over the aggregation step only, not the
    spectral step, matching the standard ResGNN convention.
    """

    def __init__(self, dim, K, dropout=0.0):
        super().__init__()
        self.spectral = FGNNLayer(dim, K, dropout=dropout)
        self.fusion   = FraudAwareAggregator(dim, dropout=dropout)

    def forward(self, X, L, edge_index, y_masked):
        """
        =======================
        Forward pass with residual connection
        =======================
        Z = spectral(X)          — frequency-enhanced features
        H = fusion(Z, ...)       — fraud-aware neighbor aggregation
        out = Z + H              — residual skips only the aggregation step
        """
        Z = self.spectral(X, L)
        H = self.fusion(Z, edge_index, y_masked)
        return Z + H