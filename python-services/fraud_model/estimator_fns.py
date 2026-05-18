"""
Evaluation metrics for binary fraud detection (paper Sec 4.1, Eq. 20-23):
F1-Macro, AUC, G-Mean.
"""

import numpy as np
from sklearn.metrics import (
    f1_score, roc_auc_score, confusion_matrix,
    precision_score, recall_score, accuracy_score
)


def _safe_auc(y_true, pos_scores):
    """
    =======================
    ROC-AUC guarded against single-class slices
    =======================
    Returns NaN when `y_true` contains only one class (otherwise
    sklearn raises ValueError).
    """
    try:
        return roc_auc_score(y_true, pos_scores)
    except ValueError:
        return float("nan")


def _g_mean(y_true, y_pred_label):
    """
    =======================
    G-Mean of sensitivity and specificity
    =======================
    G-Mean = sqrt(Recall_1 * Specificity_0)  (paper Eq. 23)
    """
    tn, fp, fn, tp = confusion_matrix(
        y_true, y_pred_label, labels=[0, 1]
    ).ravel()
    recall_fraud = tp / (tp + fn + 1e-8)
    specificity  = tn / (tn + fp + 1e-8)
    return np.sqrt(max(recall_fraud, 0.0) * max(specificity, 0.0))


def evaluate(y_true, y_pred_probs):
    """
    =======================
    Compute all evaluation metrics
    =======================
    Returns:
        (f1_macro, auc, g_mean, precision_fraud, recall_fraud, accuracy)
    """
    y_pred_label = y_pred_probs.argmax(axis=1)
    f1_macro  = f1_score(y_true, y_pred_label, average="macro", zero_division=0)
    auc       = _safe_auc(y_true, y_pred_probs[:, 1])
    gmean     = _g_mean(y_true, y_pred_label)
    precision = precision_score(y_true, y_pred_label, pos_label=1, zero_division=0)
    recall    = recall_score(y_true, y_pred_label, pos_label=1, zero_division=0)
    acc       = accuracy_score(y_true, y_pred_label)
    return f1_macro, auc, gmean, precision, recall, acc
