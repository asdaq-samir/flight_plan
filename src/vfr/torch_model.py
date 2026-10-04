"""The PyTorch checkpoint-spottability architecture, split out into its
own module (rather than living inline in model_candidates.py) so the
trainer's own code stays readable on its own."""
import torch
from torch import nn


class SpottabilityMLP(nn.Module):
    """Linear(n,32) -> ReLU -> Dropout -> Linear(32,16) -> ReLU ->
    Dropout -> Linear(16,1). Matches notebook 04's architecture
    exactly, extracted here the same way notebook 03's model-selection
    logic became vfr.pipeline.retrain().
    """

    def __init__(self, n_features: int, dropout: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(16, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)
