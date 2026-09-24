"""
Batch-enhance operator audio with the SIH26052 Tiny CRN/GRU model.

The operator controls how many files to process with --max-files.

Example:
  python sih_python/batch_enhance_crn_gru.py ^
    --checkpoint models/crn_gru_voice_mask.pt ^
    --input-dir incoming_audio ^
    --max-files 25 ^
    --out-dir outputs/enhanced
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn.functional as F

from ml_audio_model import ID_TO_NOISE, NOISE_TO_ID, TinyCRNGRUMaskNet, load_model_from_checkpoint
from ml_audio_utils import (
    dbfs,
    impulse_prior_from_wave,
    iter_audio_files,
    one_second_segments,
    read_audio,
    write_wav,
)


def load_checkpoint(path: str, device: torch.device) -> TinyCRNGRUMaskNet:
    model = load_model_from_checkpoint(path, map_location=device)
    return model.to(device).eval()


def spectral_floor_reduction_db(in_mag: torch.Tensor, out_mag: torch.Tensor) -> float:
    in_frame = in_mag.square().mean(dim=1).detach().cpu().numpy()
    out_frame = out_mag.square().mean(dim=1).detach().cpu().numpy()
    q_in = np.percentile(in_frame[in_frame > 0], 10) if np.any(in_frame > 0) else 1e-12
    q_out = np.percentile(out_frame[out_frame > 0], 10) if np.any(out_frame > 0) else 1e-12
    return 10.0 * math.log10((q_in + 1e-12) / (q_out + 1e-12))


def enhance_audio(
    audio: np.ndarray,
    model: TinyCRNGRUMaskNet,
    device: torch.device,
    floor_db: float,
    impulse_extra_db: float,
    impulse_threshold: float,
    fast_prior_weight: float,
) -> Tuple[np.ndarray, Dict]:
    cfg = model.config
    x = torch.from_numpy(audio.astype(np.float32)).to(device)
    window = torch.hann_window(cfg.win_length, device=device)

    noisy = torch.stft(
        x,
        n_fft=cfg.n_fft,
        hop_length=cfg.hop_length,
        win_length=cfg.win_length,
        window=window,
        center=True,
        return_complex=True,
    )
    mag = noisy.abs().transpose(0, 1).contiguous()
    feat = torch.log1p(mag).unsqueeze(0)

    with torch.no_grad():
        pred = model(feat)
        mask = pred["mask"].squeeze(0)
        class_prob = F.softmax(pred["noise_logits"].squeeze(0), dim=-1)
        impulse_prob = torch.sigmoid(pred["impulse_logit"].squeeze(0))
        vad_prob = torch.sigmoid(pred["vad_logit"].squeeze(0))

    fast_prior_np = impulse_prior_from_wave(
        audio,
        frame_length=cfg.n_fft,
        hop_length=cfg.hop_length,
        ratio_threshold=8.0,
        hold_frames=10,
    )
    fast_prior = torch.from_numpy(fast_prior_np).to(device)
    if fast_prior.numel() < impulse_prob.numel():
        fast_prior = F.pad(fast_prior, (0, impulse_prob.numel() - fast_prior.numel()))
    fast_prior = fast_prior[: impulse_prob.numel()]
    impulse_prob = torch.maximum(impulse_prob, fast_prior_weight * fast_prior).clamp(0.0, 1.0)

    floor = 10.0 ** (floor_db / 20.0)
    impulse_gain = 10.0 ** (impulse_extra_db / 20.0)
    impulse_gate = 1.0 - impulse_prob.unsqueeze(-1) * (1.0 - impulse_gain)
    mask = mask.clamp(floor, 1.0) * impulse_gate
    mask = mask.clamp(floor, 1.0)

    enhanced_stft = noisy * mask.transpose(0, 1)
    enhanced = torch.istft(
        enhanced_stft,
        n_fft=cfg.n_fft,
        hop_length=cfg.hop_length,
        win_length=cfg.win_length,
        window=window,
        center=True,
        length=len(audio),
    )
    enhanced_np = enhanced.detach().cpu().numpy().astype(np.float32)
    peak = float(np.max(np.abs(enhanced_np))) if enhanced_np.size else 0.0
    if peak > 0.99:
        enhanced_np *= 0.99 / peak

    frame_labels = class_prob.argmax(dim=-1).detach().cpu().numpy().astype(int)
    impulse_frames = (impulse_prob.detach().cpu().numpy() >= impulse_threshold)
    frame_labels = np.where(impulse_frames, NOISE_TO_ID["impulsive"], frame_labels)
    timeline = [
        {"second": round(sec, 3), "noise": label}
        for sec, label in one_second_segments(frame_labels, cfg.hop_length, cfg.sample_rate)
    ]

    counts = np.bincount(frame_labels, minlength=len(NOISE_TO_ID))
    dominant = ID_TO_NOISE[int(np.argmax(counts))]
    impulse_indices = np.flatnonzero(impulse_frames)
    first_impulse = None
    if impulse_indices.size:
        first_impulse = float(impulse_indices[0] * cfg.hop_length / cfg.sample_rate)

    out_mag = enhanced_stft.abs().transpose(0, 1).contiguous()
    meta = {
        "dominant_noise": dominant,
        "first_impulsive_second": first_impulse,
        "impulsive_frame_count": int(impulse_indices.size),
        "mean_voice_probability": float(vad_prob.mean().detach().cpu().item()),
        "input_dbfs": dbfs(audio),
        "output_dbfs": dbfs(enhanced_np),
        "rms_reduction_db": dbfs(audio) - dbfs(enhanced_np),
        "spectral_floor_reduction_db": spectral_floor_reduction_db(mag, out_mag),
        "timeline": timeline,
    }
    return enhanced_np, meta


def collect_inputs(args) -> List[Path]:
    files: List[Path] = []
    if args.files:
        files.extend(Path(p) for p in args.files)
    if args.input_dir:
        files.extend(iter_audio_files(args.input_dir))
    files = [p for p in files if p.exists() and p.is_file()]
    files = sorted(dict.fromkeys(files))
    if args.max_files is not None:
        files = files[: max(0, args.max_files)]
    return files


def process(args) -> None:
    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    model = load_checkpoint(args.checkpoint, device)
    files = collect_inputs(args)
    if not files:
        raise SystemExit("No input audio files found.")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_rows = []
    timeline_report: Dict[str, List[dict]] = {}

    for idx, path in enumerate(files, start=1):
        audio = read_audio(path, model.config.sample_rate)
        enhanced, meta = enhance_audio(
            audio,
            model,
            device=device,
            floor_db=args.floor_db,
            impulse_extra_db=args.impulse_extra_db,
            impulse_threshold=args.impulse_threshold,
            fast_prior_weight=args.fast_prior_weight,
        )
        out_path = out_dir / f"{idx:04d}_{path.stem}_enhanced.wav"
        write_wav(out_path, enhanced, model.config.sample_rate)

        first = meta["first_impulsive_second"]
        first_str = "" if first is None else f"{first:.3f}"
        impulse_label = f"{first_str}s" if first_str else "none"
        print(
            f"[{idx}/{len(files)}] {path.name} -> {out_path.name} | "
            f"noise={meta['dominant_noise']} first_impulse={impulse_label} "
            f"floor_reduction={meta['spectral_floor_reduction_db']:.1f}dB"
        )

        report_rows.append(
            {
                "input_file": str(path),
                "output_file": str(out_path),
                "duration_sec": f"{len(audio) / model.config.sample_rate:.3f}",
                "dominant_noise": meta["dominant_noise"],
                "first_impulsive_second": first_str,
                "impulsive_frame_count": meta["impulsive_frame_count"],
                "mean_voice_probability": f"{meta['mean_voice_probability']:.4f}",
                "input_dbfs": f"{meta['input_dbfs']:.2f}",
                "output_dbfs": f"{meta['output_dbfs']:.2f}",
                "rms_reduction_db": f"{meta['rms_reduction_db']:.2f}",
                "spectral_floor_reduction_db": f"{meta['spectral_floor_reduction_db']:.2f}",
            }
        )
        timeline_report[str(path)] = meta["timeline"]

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(report_rows[0].keys()))
        writer.writeheader()
        writer.writerows(report_rows)

    timeline_path = report_path.with_suffix(".timeline.json")
    timeline_path.write_text(json.dumps(timeline_report, indent=2), encoding="utf-8")
    print(f"Report: {report_path}")
    print(f"Timeline: {timeline_path}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Batch CRN/GRU enhancement and noise classification.")
    p.add_argument("--checkpoint", required=True, help="Trained .pt checkpoint from train_crn_gru_voice_mask.py.")
    p.add_argument("--input-dir", type=str, default=None, help="Directory of operator audio files.")
    p.add_argument("--files", nargs="*", default=None, help="Explicit audio files to process.")
    p.add_argument("--max-files", type=int, default=None, help="Only process the first N files.")
    p.add_argument("--out-dir", type=str, default="outputs/enhanced")
    p.add_argument("--report", type=str, default="outputs/enhanced/report.csv")
    p.add_argument("--device", type=str, default=None)
    p.add_argument("--floor-db", type=float, default=-32.0, help="Minimum mask floor.")
    p.add_argument("--impulse-extra-db", type=float, default=-24.0, help="Extra immediate attenuation on impulse frames.")
    p.add_argument("--impulse-threshold", type=float, default=0.50)
    p.add_argument("--fast-prior-weight", type=float, default=0.95, help="Weight for the causal energy-ratio impulse prior.")
    return p


if __name__ == "__main__":
    process(build_parser().parse_args())
