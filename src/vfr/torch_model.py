"""The PyTorch checkpoint-spottability architecture, split out into its
own module (rather than living inline in model_candidates.py) so the
trainer's own code stays readable on its own.

model-service keeps its own duplicate of this exact class
(model-service/app/torch_model.py) rather than importing this one --
its build context is ./model-service alone, with no access to this
src/ tree, matching that service's own design as a standalone
SageMaker-inference-container stand-in. See that file's own docstring
for the full reasoning; the two must be kept in sync by hand, since
torch.load(state_dict) only works against an identically-shaped module.
"""
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
