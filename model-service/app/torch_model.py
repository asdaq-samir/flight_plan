"""The PyTorch checkpoint-spottability architecture -- a deliberate
duplicate of src/vfr/torch_model.py, not an import of it.

model-service's build context is ./model-service alone (docker-compose.yml),
not the repo root, matching this service's own design: it is meant to
stand in for a real SageMaker inference container, which would have no
access to this repo's src/ tree either. Pulling that tree in just to
share one 20-line class would mean restructuring the build (context: .,
a COPY of src/vfr, a PYTHONPATH) for every future deploy of this
service, not just this one model.

The two copies MUST stay in sync: torch.load(state_dict) only works
against an identically-shaped module, so a change to one architecture
(here or in vfr.model_candidates' trainer) needs the same change made
in the other by hand.
"""
import torch
from torch import nn


class SpottabilityMLP(nn.Module):
    """Linear(n,32) -> ReLU -> Dropout -> Linear(32,16) -> ReLU ->
    Dropout -> Linear(16,1). Matches notebook 04's architecture and
    vfr.torch_model.SpottabilityMLP exactly.
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
