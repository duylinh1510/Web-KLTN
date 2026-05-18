import torch
from torch_geometric.utils import remove_self_loops

"""
Sparse normalized Laplacian builder shared across spectral models.

L = I - D^{-1/2} A D^{-1/2}
Materialized as torch.sparse_coo_tensor to achieve O(N + E) memory
instead of O(N^2) — matching paper Sec 3.7 (scalability / mini-batch
compatibility).

FIX: build_laplacian_sparse now returns a rescaled Laplacian
    L_scaled = (2 / lambda_max) * L - I
so eigenvalues lie in [-1, 1], which is required for Chebyshev
polynomial stability (polynomials diverge outside this range).
lambda_max is estimated cheaply with power iteration — no full
eigendecomposition needed.
"""


def _compute_degree(row, num_nodes, device):
    """
    =======================
    Node-degree vector
    =======================
    Counts incoming edges per node using index_add_. Assumes the
    `edge_index` has already had its self-loops removed.
    """
    deg = torch.zeros(num_nodes, device=device)
    deg.index_add_(0, row, torch.ones_like(row, dtype=torch.float))
    return deg


def _off_diagonal_entries(row, col, deg_inv_sqrt):
    """
    =======================
    Off-diagonal entries of -D^{-1/2} A D^{-1/2}
    =======================
    Returns (indices, values) for the off-diagonal portion of the
    normalized Laplacian (before adding the identity).
    """
    indices = torch.stack([row, col], dim=0)
    values  = -deg_inv_sqrt[row] * deg_inv_sqrt[col]
    return indices, values


def _diagonal_entries(num_nodes, device):
    """
    =======================
    Diagonal (+I) entries
    =======================
    Returns (indices, values) that encode the identity on the diagonal
    of L = I - D^{-1/2} A D^{-1/2}.
    """
    diag_idx  = torch.arange(num_nodes, device=device)
    indices   = torch.stack([diag_idx, diag_idx], dim=0)
    values    = torch.ones(num_nodes, device=device)
    return indices, values


def _estimate_lambda_max(L, num_iterations=10):
    """
    =======================
    Estimate largest eigenvalue via power iteration
    =======================
    Runs `num_iterations` steps of v <- L v / ||L v|| and returns
    the Rayleigh quotient vT L v as the lambda_max estimate.

    Power iteration is O(num_iterations * E) — negligible vs. the
    forward pass — and avoids any dense eigendecomposition.
    Falls back to 2.0 (theoretical max of the normalized Laplacian)
    when the graph has no edges.
    """
    num_nodes = L.shape[0]
    device    = L.device

    if num_nodes == 0:
        return torch.tensor(2.0, device=device)

    v = torch.randn(num_nodes, 1, device=device)
    v = v / (v.norm() + 1e-12)

    for _ in range(num_iterations):
        v_new = torch.sparse.mm(L, v) if L.is_sparse else L @ v
        norm  = v_new.norm()
        if norm < 1e-12:
            break
        v = v_new / norm

    Lv         = torch.sparse.mm(L, v) if L.is_sparse else L @ v
    lambda_max = (v.t() @ Lv).item()

    # Clamp: eigenvalues of the normalized Laplacian are in [0, 2]
    lambda_max = max(float(lambda_max), 0.5)
    lambda_max = min(lambda_max, 2.0)
    return torch.tensor(lambda_max, device=device)


def _rescale_laplacian(L, lambda_max):
    """
    =======================
    Rescale L so eigenvalues lie in [-1, 1]
    =======================
    L_scaled = (2 / lambda_max) * L - I

    This is the standard Chebyshev rescaling (Defferrard et al., 2016,
    Eq. 4). Without it, Chebyshev polynomials of order k > 1 grow
    without bound and cause gradient instability.
    """
    num_nodes = L.shape[0]
    device    = L.device
    scale     = 2.0 / lambda_max.item()

    # Scale the existing sparse L
    if L.is_sparse:
        scaled_indices = L.coalesce().indices()
        scaled_values  = L.coalesce().values() * scale
        L_scaled = torch.sparse_coo_tensor(
            scaled_indices, scaled_values, L.shape
        ).coalesce()
    else:
        L_scaled = L * scale

    # Subtract identity
    diag_idx = torch.arange(num_nodes, device=device)
    eye_idx  = torch.stack([diag_idx, diag_idx], dim=0)
    eye_val  = -torch.ones(num_nodes, device=device)

    eye_sparse = torch.sparse_coo_tensor(eye_idx, eye_val, L.shape).coalesce()

    if L.is_sparse:
        # Addition of two sparse tensors
        L_scaled = (L_scaled + eye_sparse).coalesce()
    else:
        L_scaled[diag_idx, diag_idx] -= 1.0

    return L_scaled


def build_laplacian_sparse(edge_index, num_nodes):
    """
    =======================
    Build the rescaled sparse normalized Laplacian
    =======================
    Steps:
        1. Compute L = I - D^{-1/2} A D^{-1/2}  (eigenvalues in [0, 2])
        2. Estimate lambda_max via power iteration
        3. Return L_scaled = (2 / lambda_max) * L - I  (eigenvalues in [-1, 1])

    Assumes edge_index is undirected (both directions present).
    """
    device = edge_index.device

    edge_index_noloop, _ = remove_self_loops(edge_index)
    row, col = edge_index_noloop

    deg          = _compute_degree(row, num_nodes, device)
    deg_inv_sqrt = deg.clamp(min=1e-12).pow(-0.5)

    off_idx, off_val = _off_diagonal_entries(row, col, deg_inv_sqrt)
    dia_idx, dia_val = _diagonal_entries(num_nodes, device)

    indices = torch.cat([off_idx, dia_idx], dim=1)
    values  = torch.cat([off_val, dia_val], dim=0)

    L = torch.sparse_coo_tensor(indices, values, (num_nodes, num_nodes)).coalesce()

    # FIX: rescale for Chebyshev stability
    lambda_max = _estimate_lambda_max(L)
    return _rescale_laplacian(L, lambda_max)
