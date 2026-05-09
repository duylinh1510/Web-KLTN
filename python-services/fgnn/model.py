import torch
import torch.nn as nn
from .laplacian import build_laplacian_sparse
from .layers import FGNNBlock

"""
F-GNN top-level model (paper Sec 3.2, Algorithm 1).
"""


class FGNN(nn.Module):
    """F-GNN — frequency-aware GNN for fraud detection."""

    def __init__(self, in_dim, hidden_dim=64, num_classes=2,
                 num_layers=2, K=3, dropout=0.0):
        super().__init__()
        self.num_layers = num_layers
        self.input_proj = nn.Linear(in_dim, hidden_dim)
        self.blocks = nn.ModuleList([
            FGNNBlock(hidden_dim, K, dropout=dropout)
            for _ in range(num_layers)
        ])
        self.classifier = nn.Linear(hidden_dim, num_classes)
        self.dropout = nn.Dropout(dropout)

    def _default_unknown_labels(self, n, device):
        return torch.full((n,), -1, dtype=torch.long, device=device)

    def forward(self, data, y_masked=None):
        X = data.x
        edge_index = data.edge_index
        N = X.shape[0]

        if y_masked is None:
            y_masked = self._default_unknown_labels(N, X.device)

        L = build_laplacian_sparse(edge_index, N)

        H = self.dropout(self.input_proj(X))
        for block in self.blocks:
            H = block(H, L, edge_index, y_masked)
        return self.classifier(H)
