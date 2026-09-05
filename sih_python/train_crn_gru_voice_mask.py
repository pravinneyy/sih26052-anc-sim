"""
Train the SIH26052 Tiny CRN/GRU voice-mask model.

MAD and other noise/event datasets provide the background classes:
  stationary / non_stationary / impulsive

Clean speech provides the target voice. Training examples are generated
on-the-fly by mixing clean speech with labeled noise at random SNRs.

Example:
  python sih_python/train_crn_gru_voice_mask.py ^
    --speech-dir data/clean_speech ^
    --mad-root data/MAD_dataset ^
    --noise-dir data/noise ^
    --epochs 30 --batch 16 --out models/crn_gru_voice_mask.pt ^
    --export-onnx public/models/crn_gru_voice_mask.onnx
"""

from __future__ import annotations

import argparse
import json
import random
import time
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from ml_audio_model import (
    ID_TO_NOISE,
    NOISE_TO_ID,
    TinyCRNGRUConfig,
    TinyCRNGRUMaskNet,
    checkpoint_payload,
)
from ml_audio_utils import (
    collect_noise_files,
    crop_or_pad,
    impulse_prior_from_wave,
    iter_audio_files,
    mix_at_snr,
    normalize_peak,
    read_audio,
)


def synth_voice(n: int, sr: int, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / float(sr)
    f0 = rng.uniform(105.0, 210.0)
    vibrato = 1.0 + 0.025 * np.sin(2 * np.pi * rng.uniform(3.0, 6.0) * t)
    envelope = np.maximum(0.0, np.sin(2 * np.pi * rng.uniform(1.8, 3.4) * t + rng.uniform(0, 6.28))) ** 1.4
    sig = np.zeros(n, dtype=np.float32)
    for h in range(1, 14):
        freq = f0 * h * vibrato
        formant = np.exp(-((freq - 650.0) / 450.0) ** 2) + 0.65 * np.exp(-((freq - 1700.0) / 700.0) ** 2)
        phase = rng.uniform(0, 6.28)
        sig += (formant / h) * np.sin(2 * np.pi * freq * t + phase).astype(np.float32)
    sig *= 0.28 * envelope.astype(np.float32)
    return normalize_peak(sig, 0.55)


def synth_noise(n: int, sr: int, label: int, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(n, dtype=np.float32) / float(sr)
    white = rng.standard_normal(n).astype(np.float32)

    if label == NOISE_TO_ID["stationary"]:
        lp = np.zeros(n, dtype=np.float32)
        acc = 0.0
        for i, v in enumerate(white):
            acc = 0.94 * acc + 0.06 * float(v)
            lp[i] = acc
        base = (
            0.75 * lp
            + 0.25 * np.sin(2 * np.pi * rng.uniform(80, 140) * t)
            + 0.18 * np.sin(2 * np.pi * rng.uniform(180, 280) * t)
        )
        return normalize_peak(base.astype(np.float32), 0.85)

    if label == NOISE_TO_ID["non_stationary"]:
        lp = np.zeros(n, dtype=np.float32)
        acc = 0.0
        for i, v in enumerate(white):
            acc = 0.90 * acc + 0.10 * float(v)
            lp[i] = acc
        freq = rng.uniform(65, 120) + rng.uniform(25, 90) * np.sin(2 * np.pi * rng.uniform(0.15, 0.8) * t)
        phase = 2 * np.pi * np.cumsum(freq) / sr
        mod = 0.7 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.3, 1.4) * t + rng.uniform(0, 6.28))
        base = mod * (0.7 * np.sin(phase) + 0.45 * lp)
        return normalize_peak(base.astype(np.float32), 0.88)

    # impulsive
    base = 0.06 * white
    count = int(rng.integers(1, 5))
    for _ in range(count):
        i0 = int(rng.integers(sr // 8, max(sr // 8 + 1, n - sr // 10)))
        length = int(rng.integers(max(8, sr // 250), max(16, sr // 55)))
        k = np.arange(min(length, n - i0), dtype=np.float32)
        burst = rng.uniform(1.3, 3.4) * np.exp(-k / max(1.0, length / 5.0))
        base[i0 : i0 + len(k)] += burst * rng.standard_normal(len(k)).astype(np.float32)
    return normalize_peak(base.astype(np.float32), 0.95)


class MixtureDataset(Dataset):
    def __init__(
        self,
        speech_files: List[Path],
        noise_files: List[Tuple[Path, int]],
        config: TinyCRNGRUConfig,
        samples: int,
        segment_seconds: float,
        snr_min: float,
        snr_max: float,
        noise_only_prob: float,
        synthetic_fallback: bool,
    ):
        self.speech_files = speech_files
        self.noise_files = noise_files
        self.config = config
        self.samples = samples
        self.segment_samples = int(round(segment_seconds * config.sample_rate))
        self.snr_min = snr_min
        self.snr_max = snr_max
        self.noise_only_prob = noise_only_prob
        self.synthetic_fallback = synthetic_fallback

        if not self.speech_files and not synthetic_fallback:
            raise ValueError("No clean speech files found. Provide --speech-dir or enable --synthetic-fallback.")
        if not self.noise_files and not synthetic_fallback:
            raise ValueError("No noise files found. Provide --mad-root/--noise-dir or enable --synthetic-fallback.")

    def __len__(self) -> int:
        return self.samples

    def _rng(self, idx: int) -> np.random.Generator:
        return np.random.default_rng([idx, random.getrandbits(32)])

    def _speech(self, rng: np.random.Generator) -> np.ndarray:
        if self.speech_files:
            path = self.speech_files[int(rng.integers(0, len(self.speech_files)))]
            return crop_or_pad(read_audio(path, self.config.sample_rate), self.segment_samples, rng)
        return synth_voice(self.segment_samples, self.config.sample_rate, rng)

    def _noise(self, rng: np.random.Generator) -> Tuple[np.ndarray, int]:
        if self.noise_files:
            path, label = self.noise_files[int(rng.integers(0, len(self.noise_files)))]
            return crop_or_pad(read_audio(path, self.config.sample_rate), self.segment_samples, rng), label
        label = int(rng.integers(0, len(NOISE_TO_ID)))
        return synth_noise(self.segment_samples, self.config.sample_rate, label, rng), label

    def _specs(self, mixed: np.ndarray, clean: np.ndarray, noise: np.ndarray, label: int) -> Dict[str, torch.Tensor]:
        win = torch.hann_window(self.config.win_length)
        x = torch.from_numpy(mixed)
        s = torch.from_numpy(clean)
        noisy_stft = torch.stft(
            x,
            n_fft=self.config.n_fft,
            hop_length=self.config.hop_length,
            win_length=self.config.win_length,
            window=win,
            center=True,
            return_complex=True,
        )
        clean_stft = torch.stft(
            s,
            n_fft=self.config.n_fft,
            hop_length=self.config.hop_length,
            win_length=self.config.win_length,
            window=win,
            center=True,
            return_complex=True,
        )
        noisy_mag = noisy_stft.abs().transpose(0, 1).contiguous()
        clean_mag = clean_stft.abs().transpose(0, 1).contiguous()
        feat = torch.log1p(noisy_mag)
        target_mask = (clean_mag / (noisy_mag + 1e-6)).clamp(0.0, 1.0)

        vad = (clean_mag.mean(dim=1) > 1e-4).float()
        prior = torch.from_numpy(
            impulse_prior_from_wave(
                noise,
                frame_length=self.config.n_fft,
                hop_length=self.config.hop_length,
            )
        )
        prior = prior[: feat.shape[0]]
        if prior.numel() < feat.shape[0]:
            prior = F.pad(prior, (0, feat.shape[0] - prior.numel()))
        impulse = prior.float() if label == NOISE_TO_ID["impulsive"] else torch.zeros_like(vad)

        frame_label = torch.full((feat.shape[0],), label, dtype=torch.long)
        if label == NOISE_TO_ID["impulsive"]:
            frame_label = torch.where(
                impulse > 0.5,
                torch.full_like(frame_label, NOISE_TO_ID["impulsive"]),
                torch.full_like(frame_label, NOISE_TO_ID["non_stationary"]),
            )

        return {
            "features": feat.float(),
            "mask": target_mask.float(),
            "noise_label": frame_label,
            "vad": vad,
            "impulse": impulse,
        }

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        rng = self._rng(idx)
        noise, label = self._noise(rng)
        has_speech = rng.random() >= self.noise_only_prob
        clean = self._speech(rng) if has_speech else np.zeros(self.segment_samples, dtype=np.float32)
        snr = float(rng.uniform(self.snr_min, self.snr_max))
        mixed, clean = mix_at_snr(clean, noise, snr) if has_speech else (normalize_peak(noise, 0.9), clean)
        return self._specs(mixed, clean, noise, label)


def collate(batch):
    return {key: torch.stack([item[key] for item in batch], dim=0) for key in batch[0]}


def export_onnx(model: TinyCRNGRUMaskNet, path: Path, frames: int = 120) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, frames, model.config.freq_bins)
    model.eval()

    class ExportWrapper(torch.nn.Module):
        def __init__(self, inner: TinyCRNGRUMaskNet):
            super().__init__()
            self.inner = inner

        def forward(self, log_mag):
            out = self.inner(log_mag)
            return out["mask"], out["noise_logits"], out["vad_logit"], out["impulse_logit"]

    torch.onnx.export(
        ExportWrapper(model).eval(),
        dummy,
        str(path),
        input_names=["log_mag"],
        output_names=["mask", "noise_logits", "vad_logit", "impulse_logit"],
        opset_version=17,
        dynamic_axes={
            "log_mag": {0: "batch", 1: "frames"},
            "mask": {0: "batch", 1: "frames"},
            "noise_logits": {0: "batch", 1: "frames"},
            "vad_logit": {0: "batch", 1: "frames"},
            "impulse_logit": {0: "batch", 1: "frames"},
        },
        dynamo=False,
    )


def train(args) -> Path:
    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    config = TinyCRNGRUConfig(sample_rate=args.sample_rate)

    speech_files = iter_audio_files(args.speech_dir) if args.speech_dir else []
    noise_files = collect_noise_files(args.mad_root, args.noise_dir or [])

    counts = Counter(label for _, label in noise_files)
    print(f"Clean speech files: {len(speech_files)}")
    print("Noise/event files:", {ID_TO_NOISE[k]: counts.get(k, 0) for k in sorted(ID_TO_NOISE)})
    if not speech_files or not noise_files:
        print("Using synthetic fallback for missing sources. Real performance needs real clean speech + MAD/noise files.")

    dataset = MixtureDataset(
        speech_files=speech_files,
        noise_files=noise_files,
        config=config,
        samples=args.steps_per_epoch * args.batch,
        segment_seconds=args.segment_seconds,
        snr_min=args.snr_min,
        snr_max=args.snr_max,
        noise_only_prob=args.noise_only_prob,
        synthetic_fallback=args.synthetic_fallback,
    )
    loader = DataLoader(dataset, batch_size=args.batch, shuffle=True, num_workers=args.workers, collate_fn=collate)

    model = TinyCRNGRUMaskNet(config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scaler = torch.cuda.amp.GradScaler(enabled=args.amp and device.type == "cuda")

    best = float("inf")
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        t0 = time.time()
        totals = Counter()
        n_batches = 0

        for batch in loader:
            feat = batch["features"].to(device)
            target_mask = batch["mask"].to(device)
            labels = batch["noise_label"].to(device)
            vad = batch["vad"].to(device)
            impulse = batch["impulse"].to(device)

            optimizer.zero_grad(set_to_none=True)
            with torch.cuda.amp.autocast(enabled=args.amp and device.type == "cuda"):
                pred = model(feat)
                mask_loss = F.smooth_l1_loss(pred["mask"], target_mask)
                noise_loss = F.cross_entropy(pred["noise_logits"].reshape(-1, len(NOISE_TO_ID)), labels.reshape(-1))
                vad_loss = F.binary_cross_entropy_with_logits(pred["vad_logit"], vad)
                impulse_weight = torch.where(
                    impulse > 0.5,
                    torch.full_like(impulse, args.impulse_pos_weight),
                    torch.ones_like(impulse),
                )
                impulse_loss = F.binary_cross_entropy_with_logits(
                    pred["impulse_logit"],
                    impulse,
                    weight=impulse_weight,
                )
                loss = (
                    args.mask_loss_weight * mask_loss
                    + args.noise_loss_weight * noise_loss
                    + args.vad_loss_weight * vad_loss
                    + args.impulse_loss_weight * impulse_loss
                )

            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(optimizer)
            scaler.update()

            with torch.no_grad():
                cls = pred["noise_logits"].argmax(dim=-1)
                acc = (cls == labels).float().mean()
                imp_pred = (torch.sigmoid(pred["impulse_logit"]) > 0.5).float()
                imp_recall = ((imp_pred * impulse).sum() / impulse.sum().clamp_min(1.0)).item()

            totals["loss"] += float(loss.item())
            totals["mask"] += float(mask_loss.item())
            totals["noise"] += float(noise_loss.item())
            totals["vad"] += float(vad_loss.item())
            totals["impulse"] += float(impulse_loss.item())
            totals["acc"] += float(acc.item())
            totals["imp_recall"] += imp_recall
            n_batches += 1

        avg = {k: v / max(1, n_batches) for k, v in totals.items()}
        print(
            f"epoch {epoch:03d}/{args.epochs} "
            f"loss={avg['loss']:.4f} mask={avg['mask']:.4f} "
            f"noise_ce={avg['noise']:.4f} noise_acc={avg['acc']*100:.1f}% "
            f"imp_recall={avg['imp_recall']*100:.1f}% "
            f"time={time.time()-t0:.1f}s"
        )

        if avg["loss"] < best:
            best = avg["loss"]
            torch.save(
                checkpoint_payload(
                    model,
                    {
                        "epoch": epoch,
                        "best_loss": best,
                        "training_args": vars(args),
                    },
                ),
                out_path,
            )
            print(f"saved {out_path}")

    meta_path = out_path.with_suffix(".json")
    meta_path.write_text(
        json.dumps(
            {
                "checkpoint": str(out_path),
                "config": config.to_dict(),
                "noise_classes": list(NOISE_TO_ID.keys()),
                "best_loss": best,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    if args.export_onnx:
        export_onnx(model.cpu(), Path(args.export_onnx))
        print(f"exported ONNX: {args.export_onnx}")
    return out_path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Train a compact CRN/GRU voice-mask enhancer.")
    p.add_argument("--speech-dir", type=str, default=None, help="Directory of clean operator speech WAV/FLAC/etc.")
    p.add_argument("--mad-root", type=str, default=None, help="MAD_dataset root containing training.csv/test.csv.")
    p.add_argument("--noise-dir", type=str, action="append", default=[], help="Additional noise root. Can be repeated.")
    p.add_argument("--out", type=str, default="models/crn_gru_voice_mask.pt", help="Output checkpoint path.")
    p.add_argument("--export-onnx", type=str, default=None, help="Optional ONNX export path for browser/edge inference.")
    p.add_argument("--epochs", type=int, default=25)
    p.add_argument("--steps-per-epoch", type=int, default=500)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--workers", type=int, default=0)
    p.add_argument("--sample-rate", type=int, default=16000)
    p.add_argument("--segment-seconds", type=float, default=2.0)
    p.add_argument("--snr-min", type=float, default=-8.0)
    p.add_argument("--snr-max", type=float, default=10.0)
    p.add_argument("--noise-only-prob", type=float, default=0.12)
    p.add_argument("--synthetic-fallback", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--device", type=str, default=None)
    p.add_argument("--amp", action="store_true", help="Use CUDA mixed precision.")
    p.add_argument("--mask-loss-weight", type=float, default=1.0)
    p.add_argument("--noise-loss-weight", type=float, default=0.20)
    p.add_argument("--vad-loss-weight", type=float, default=0.10)
    p.add_argument("--impulse-loss-weight", type=float, default=0.45)
    p.add_argument("--impulse-pos-weight", type=float, default=10.0)
    return p


if __name__ == "__main__":
    train(build_parser().parse_args())
