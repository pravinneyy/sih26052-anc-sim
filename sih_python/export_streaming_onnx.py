"""
Re-export the trained TinyCRNGRUMaskNet with the GRU hidden state exposed as
an explicit input/output, so the browser can run inference one small chunk
at a time (streaming) instead of only on a whole pre-recorded clip.

The existing `public/models/crn_gru_voice_mask.onnx` (produced by
train_crn_gru_voice_mask.py --export-onnx) hard-codes both the hidden state
(always starts at zero every call) and the frame count in the exported
graph. That is fine for the batch/offline path but unusable for a live
microphone: it would reset the model's recurrent memory every chunk and
only accepts one fixed chunk length. This script produces a second ONNX
graph, used by the real-time Audio Lab engine, that carries hidden state
across calls and accepts any chunk length.

Usage:
  python sih_python/export_streaming_onnx.py \
    --checkpoint models/crn_gru_voice_mask.pt \
    --out public/models/crn_gru_voice_mask_streaming.onnx
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
import torch.nn as nn

from ml_audio_model import NOISE_CLASSES, TinyCRNGRUMaskNet, load_model_from_checkpoint


class StreamingWrapper(nn.Module):
    def __init__(self, inner: TinyCRNGRUMaskNet):
        super().__init__()
        self.inner = inner

    def forward(self, log_mag: torch.Tensor, hidden: torch.Tensor):
        out = self.inner(log_mag, hidden)
        return out["mask"], out["noise_logits"], out["vad_logit"], out["impulse_logit"], out["hidden"]


def export_streaming_onnx(
    checkpoint: str,
    out_path: str,
    frames: int = 14,
    context_frames: int = 6,
    chunk_frames: int = 8,
) -> None:
    model = load_model_from_checkpoint(checkpoint, map_location="cpu")
    wrapper = StreamingWrapper(model).eval()

    dummy_log_mag = torch.randn(1, frames, model.config.freq_bins)
    dummy_hidden = torch.zeros(model.config.gru_layers, 1, model.config.gru_hidden)

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        wrapper,
        (dummy_log_mag, dummy_hidden),
        str(out),
        input_names=["log_mag", "hidden_in"],
        output_names=["mask", "noise_logits", "vad_logit", "impulse_logit", "hidden_out"],
        opset_version=17,
        dynamo=False,
        dynamic_axes={
            "log_mag": {0: "batch", 1: "frames"},
            "hidden_in": {1: "batch"},
            "mask": {0: "batch", 1: "frames"},
            "noise_logits": {0: "batch", 1: "frames"},
            "vad_logit": {0: "batch", 1: "frames"},
            "impulse_logit": {0: "batch", 1: "frames"},
            "hidden_out": {1: "batch"},
        },
    )
    print(f"exported streaming ONNX: {out}")
    print(f"config: {model.config.to_dict()}")

    # Companion manifest the browser engine reads at startup instead of
    # hard-coding these dimensions in JS — keeps the live engine correct if
    # the model is ever retrained with different sizes.
    manifest = {
        "onnx": out.name,
        "sample_rate": model.config.sample_rate,
        "n_fft": model.config.n_fft,
        "hop_length": model.config.hop_length,
        "win_length": model.config.win_length,
        "freq_bins": model.config.freq_bins,
        "gru_layers": model.config.gru_layers,
        "gru_hidden": model.config.gru_hidden,
        "noise_classes": list(NOISE_CLASSES),
        # Streaming chunking scheme this export was validated against (see
        # export_streaming_onnx.py docstring): `context_frames` of causal
        # conv receptive-field history are re-fed each call so the encoder
        # doesn't see zero-padding at every chunk boundary, and are dropped
        # from the output; `chunk_frames` new frames are produced per call.
        "context_frames": context_frames,
        "chunk_frames": chunk_frames,
    }
    manifest_path = out.with_suffix(".json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote manifest: {manifest_path}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Export TinyCRNGRUMaskNet with streaming hidden-state I/O.")
    p.add_argument("--checkpoint", type=str, default="models/crn_gru_voice_mask.pt")
    p.add_argument("--out", type=str, default="public/models/crn_gru_voice_mask_streaming.onnx")
    p.add_argument("--context-frames", type=int, default=6, help="Causal receptive-field history re-fed each chunk.")
    p.add_argument("--chunk-frames", type=int, default=8, help="New frames produced per streaming inference call.")
    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    export_streaming_onnx(
        args.checkpoint,
        args.out,
        frames=args.context_frames + args.chunk_frames,
        context_frames=args.context_frames,
        chunk_frames=args.chunk_frames,
    )
