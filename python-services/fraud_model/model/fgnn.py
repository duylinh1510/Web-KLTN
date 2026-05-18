import torch
import torch.nn as nn
from .laplacian import build_laplacian_sparse
from .layers import FGNNBlock

"""
F-GNN top-level model (paper Sec 3.2, Algorithm 1).

Pipeline:
    X
      -> input_proj  (in_dim -> hidden_dim)
      -> [FGNNBlock] * num_layers     each block = spectral + fraud-aware
      -> classifier
"""


class FGNN(nn.Module):
    """
    =======================
    F-GNN — frequency-aware GNN for fraud detection
    =======================
    Each block applies paper's three steps (freq decoupling, adaptive
    gating, fraud-aware fusion). The Laplacian is materialized once
    per forward pass and reused across all blocks.
    """

    def __init__(self, in_dim, hidden_dim=64, num_classes=2,
                 num_layers=2, K=3, dropout=0.0):
        super().__init__()

        self.input_proj = nn.Linear(in_dim, hidden_dim)
        self.blocks = nn.ModuleList([
            FGNNBlock(hidden_dim, K, dropout=dropout)
            for _ in range(num_layers)
        ])
        self.classifier = nn.Linear(hidden_dim, num_classes)
        self.dropout = nn.Dropout(dropout)

    def forward(self, data, y_masked=None):
        """
        =======================
        Forward pass
        =======================
        Args:
            data     : torch_geometric Data with x, edge_index.
            y_masked : [N] long tensor in {-1, 0, 1}. -1 = unknown.
                       If None, all nodes are treated as unknown
                       (pure-inference mode).
        Returns:
            [N, num_classes] class logits.
        """
        X, edge_index = data.x, data.edge_index
        N = X.shape[0]

        if y_masked is None:
            y_masked = torch.full((N,), -1, dtype=torch.long, device=X.device)

        L = build_laplacian_sparse(edge_index, N)

        H = self.dropout(self.input_proj(X))
        for block in self.blocks:
            H = block(H, L, edge_index, y_masked)
        return self.classifier(H)
