"""
Tiny CRN/GRU voice-mask model for SIH26052 audio enhancement.

The model is intentionally small enough for browser/edge deployment:

  noisy STFT log-magnitude -> causal 2-D CRN frontend -> GRU -> heads

Heads:
  - mask: per-frame ideal-ratio mask over STFT bins
  - noise_logits: stationary / non_stationary / impulsive
  - vad_logit: operator voice present
  - impulse_logit: frame contains an impulsive event

The forward pass is causal in time: convolution padding only looks backward.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict

import torch
import torch.nn as nn
import torch.nn.functional as F


NOISE_CLASSES = ("stationary", "non_stationary", "impulsive")
NOISE_TO_ID = {name: idx for idx, name in enumerate(NOISE_CLASSES)}
ID_TO_NOISE = {idx: name for name, idx in NOISE_TO_ID.items()}


@dataclass
class TinyCRNGRUConfig:
    sample_rate: int = 16000
    n_fft: int = 512
    hop_length: int = 128
    win_length: int = 512
    freq_bins: int = 257
    conv_channels: int = 16
    gru_hidden: int = 96
    gru_layers: int = 1
    dropout: float = 0.05

    def to_dict(self) -> Dict[str, int | float]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, int | float] | None) -> "TinyCRNGRUConfig":
        if not data:
            return cls()
        allowed = {field.name for field in cls.__dataclass_fields__.values()}
        return cls(**{k: v for k, v in data.items() if k in allowed})


class CausalConv2d(nn.Module):
    """Conv2d with left-only time padding and symmetric frequency padding."""

    def __init__(self, in_ch: int, out_ch: int, kernel=(3, 5), stride=(1, 1)):
        super().__init__()
        self.time_pad = kernel[0] - 1
        self.freq_pad = kernel[1] // 2
        self.conv = nn.Conv2d(in_ch, out_ch, kernel_size=kernel, stride=stride)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.pad(x, (self.freq_pad, self.freq_pad, self.time_pad, 0))
        return self.conv(x)


class TinyCRNGRUMaskNet(nn.Module):
    """
    Compact causal CRN/GRU model.

    Input:
        x: float tensor [batch, frames, freq_bins], usually log1p(|STFT|)

    Output dict:
        mask: [batch, frames, freq_bins], range [0, 1]
        noise_logits: [batch, frames, 3]
        vad_logit: [batch, frames]
        impulse_logit: [batch, frames]
    """

    def __init__(self, config: TinyCRNGRUConfig | None = None):
        super().__init__()
        self.config = config or TinyCRNGRUConfig()
        c = self.config.conv_channels

        self.norm = nn.LayerNorm(self.config.freq_bins)
        self.enc1 = CausalConv2d(1, c // 2, kernel=(3, 5), stride=(1, 2))
        self.enc2 = CausalConv2d(c // 2, c, kernel=(3, 5), stride=(1, 2))
        self.enc3 = CausalConv2d(c, c, kernel=(3, 3), stride=(1, 1))

        compressed_bins = self._compressed_bins(self.config.freq_bins)
        gru_in = c * compressed_bins
        self.gru = nn.GRU(
            input_size=gru_in,
            hidden_size=self.config.gru_hidden,
            num_layers=self.config.gru_layers,
            batch_first=True,
            dropout=self.config.dropout if self.config.gru_layers > 1 else 0.0,
        )
        self.post = nn.Sequential(
            nn.LayerNorm(self.config.gru_hidden),
            nn.Dropout(self.config.dropout),
        )
        self.mask_head = nn.Linear(self.config.gru_hidden, self.config.freq_bins)
        self.noise_head = nn.Linear(self.config.gru_hidden, len(NOISE_CLASSES))
        self.vad_head = nn.Linear(self.config.gru_hidden, 1)
        self.impulse_head = nn.Linear(self.config.gru_hidden, 1)

        self._init_weights()

    @staticmethod
    def _conv_out_len(n: int, kernel: int = 5, pad: int = 2, stride: int = 2) -> int:
        return ((n + 2 * pad - kernel) // stride) + 1

    @classmethod
    def _compressed_bins(cls, freq_bins: int) -> int:
        return cls._conv_out_len(cls._conv_out_len(freq_bins))

    def _init_weights(self) -> None:
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.xavier_uniform_(module.weight)
                nn.init.zeros_(module.bias)
            elif isinstance(module, nn.Conv2d):
                nn.init.kaiming_uniform_(module.weight, nonlinearity="relu")
                nn.init.zeros_(module.bias)
        # Initialize impulse head bias to negative prior for rare impulse events (~7% prior)
        nn.init.constant_(self.impulse_head.bias, -2.5)

    def forward(self, x: torch.Tensor, hidden: torch.Tensor | None = None):
        if x.ndim != 3:
            raise ValueError("Expected x with shape [batch, frames, freq_bins]")
        if int(x.shape[-1]) != int(self.config.freq_bins):
            raise ValueError(f"Expected {self.config.freq_bins} frequency bins, got {x.shape[-1]}")

        z = self.norm(x).unsqueeze(1)  # [B, 1, T, F]
        z = F.silu(self.enc1(z))
        z = F.silu(self.enc2(z))
        z = F.silu(self.enc3(z))

        b, c, t, f = z.shape
        z = z.permute(0, 2, 1, 3).contiguous().view(b, t, c * f)
        z, hidden = self.gru(z, hidden)
        z = self.post(z)

        mask = torch.sigmoid(self.mask_head(z))
        return {
            "mask": mask,
            "noise_logits": self.noise_head(z),
            "vad_logit": self.vad_head(z).squeeze(-1),
            "impulse_logit": self.impulse_head(z).squeeze(-1),
            "hidden": hidden,
        }


def checkpoint_payload(model: TinyCRNGRUMaskNet, extra: dict | None = None) -> dict:
    payload = {
        "model": "TinyCRNGRUMaskNet",
        "config": model.config.to_dict(),
        "state_dict": model.state_dict(),
        "noise_classes": list(NOISE_CLASSES),
    }
    if extra:
        payload.update(extra)
    return payload


def load_model_from_checkpoint(path: str, map_location: str | torch.device = "cpu") -> TinyCRNGRUMaskNet:
    ckpt = torch.load(path, map_location=map_location)
    config = TinyCRNGRUConfig.from_dict(ckpt.get("config"))
    model = TinyCRNGRUMaskNet(config)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model
