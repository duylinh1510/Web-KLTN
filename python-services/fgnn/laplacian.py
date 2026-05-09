import torch
from torch_geometric.utils import remove_self_loops

"""
Sparse normalized Laplacian: L = I - D^{-1/2} A D^{-1/2}
"""


def _compute_degree(row, num_nodes, device):
    deg = torch.zeros(num_nodes, device=device)
    deg.index_add_(0, row, torch.ones_like(row, dtype=torch.float))
    return deg


def _off_diagonal_entries(row, col, deg_inv_sqrt):
    indices = torch.stack([row, col], dim=0)
    values = -deg_inv_sqrt[row] * deg_inv_sqrt[col]
    return indices, values


def _diagonal_entries(num_nodes, device):
    diag_idx = torch.arange(num_nodes, device=device)
    indices = torch.stack([diag_idx, diag_idx], dim=0)
    values = torch.ones(num_nodes, device=device)
    return indices, values


def build_laplacian_sparse(edge_index, num_nodes):
    """Build sparse normalized Laplacian. Assumes undirected edges."""
    device = edge_index.device

    edge_index_noloop, _ = remove_self_loops(edge_index)
    row, col = edge_index_noloop

    deg = _compute_degree(row, num_nodes, device)
    deg_inv_sqrt = deg.clamp(min=1e-12).pow(-0.5)

    off_idx, off_val = _off_diagonal_entries(row, col, deg_inv_sqrt)
    dia_idx, dia_val = _diagonal_entries(num_nodes, device)

    indices = torch.cat([off_idx, dia_idx], dim=1)
    values = torch.cat([off_val, dia_val], dim=0)

    return torch.sparse_coo_tensor(indices, values, (num_nodes, num_nodes)).coalesce()
