import torch

"""
Small training-side utilities: checkpoint I/O, class weighting,
and label-masking for the fraud-aware aggregator.
"""


def save_model(model, path):
    """
    =======================
    Save model state_dict to disk
    =======================
    """
    torch.save(model.state_dict(), path)


def load_model(model, path, device="cpu"):
    """
    =======================
    Load model state_dict from disk
    =======================
    Loads weights into `model` in place and returns it.
    """
    model.load_state_dict(torch.load(path, map_location=device))
    return model


def class_weights_from_mask(y, mask, num_classes=2):
    """
    =======================
    Inverse-frequency class weights from the train split only
    =======================
    Computed exclusively on nodes selected by `mask` to avoid
    leaking val/test distribution into the loss.

    weight[k] = sum(counts) / (num_classes * counts[k])
    """
    y_train = y[mask]
    counts = torch.bincount(y_train, minlength=num_classes).float()
    counts = counts.clamp(min=1.0)
    return counts.sum() / (num_classes * counts)


def make_y_masked(y, train_mask):
    """
    =======================
    Build y_masked tensor with -1 for non-train nodes
    =======================
    Paper Eq. 10 splits neighbor influence by label. Non-train nodes
    are treated as 'unknown' (-1), so the attention MLP branch is
    used for them both at train and inference time.
    """
    y_masked = y.clone()
    y_masked[~train_mask] = -1
    return y_masked