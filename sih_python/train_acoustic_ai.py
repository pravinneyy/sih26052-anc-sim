"""
train_acoustic_ai.py — Synthetic Military Acoustic Dataset Generation & Training
SIH26052 Tactical ANC Headset — AI/ML Tri-Brain Engine

Generates a synthetic dataset covering 5 acoustic scene classes using
physically-motivated signal models, then trains the TriBrainANCEngine.

Dataset classes:
    0 — Stationary Vehicle   (helicopter hover, tank idle, cockpit hum)
    1 — Non-Stationary Engine (rotor RPM sweep, engine ramp, maneuvering)
    2 — Gunshot / Blast       (impulse + ring-down, burst fire, artillery)
    3 — Tactical Voice        (voiced speech F0 harmonics in noise)
    4 — Threat Cue / Siren   (warble siren, alert tone, vehicle horn)

Multi-objective loss:
    L = CrossEntropy(scene) + λ_mu × MSE(mu_schedule) + λ_stoi × (1 - STOI_proxy)

Usage:
    pip install torch numpy tqdm
    python train_acoustic_ai.py [--epochs 50] [--batch 64] [--out model.pt]
"""

import argparse
import math
import random
import time
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

# Local import
from neural_anc_model import (
    TriBrainANCEngine, N_CLASSES, N_FEATURES, FFT_N, SR_SIM,
    extract_features, build_feature_vector, CLASS_NAMES,
)

# ---------------------------------------------------------------------------
# Synthetic signal generators
# ---------------------------------------------------------------------------

RNG = np.random.default_rng(seed=42)


def gen_stationary_vehicle(n: int, sr: int) -> np.ndarray:
    """Helicopter/tank engine at fixed RPM — tonal + filtered noise."""
    t    = np.arange(n) / sr
    rpm  = RNG.uniform(900, 2200)
    f0   = rpm / 60
    sig  = (0.6 * np.sin(2 * np.pi * f0 * t)
           + 0.4 * np.sin(2 * np.pi * 2 * f0 * t)
           + 0.2 * np.sin(2 * np.pi * 4 * f0 * t))
    # Add light broadband noise
    noise = RNG.standard_normal(n)
    # Low-pass filter (IIR 1st order, α = 0.1)
    for i in range(1, n):
        noise[i] = 0.9 * noise[i - 1] + 0.1 * noise[i]
    sig += noise * RNG.uniform(0.05, 0.2)
    return sig


def gen_nonstationary_engine(n: int, sr: int) -> np.ndarray:
    """Engine with RPM sweep — non-stationary frequency content."""
    t   = np.arange(n) / sr
    f   = 40 + 30 * np.sin(2 * np.pi * RNG.uniform(0.1, 0.5) * t)
    sig = (np.sin(2 * np.pi * np.cumsum(f) / sr)
           + 0.6 * RNG.standard_normal(n) * 0.3)
    sig *= (1 + 0.4 * np.sin(2 * np.pi * RNG.uniform(0.5, 2) * t))
    return sig


def gen_gunshot(n: int, sr: int) -> np.ndarray:
    """Impulsive transient with exponential decay + broadband ring."""
    decay = RNG.uniform(200, 500)
    t     = np.arange(n) / sr
    sig   = (4.0 * np.exp(-t * decay) * RNG.standard_normal(n)
             + 0.15 * RNG.standard_normal(n))
    return sig


def gen_tactical_voice(n: int, sr: int) -> np.ndarray:
    """Quasi-periodic voiced speech (F0 harmonics) in moderate noise."""
    t   = np.arange(n) / sr
    f0  = RNG.uniform(120, 220)
    env = np.abs(np.sin(2 * np.pi * RNG.uniform(1, 3) * t)) ** 0.5
    sig = env * sum(
        (1 / h) * np.sin(2 * np.pi * h * f0 * t + RNG.uniform(0, 2 * np.pi))
        for h in range(1, 5)
    )
    noise = 0.12 * RNG.standard_normal(n)
    return sig + noise


def gen_threat_siren(n: int, sr: int) -> np.ndarray:
    """Warble/sweep siren — narrow tone with frequency modulation."""
    t    = np.arange(n) / sr
    rate = RNG.uniform(1.0, 3.0)
    f    = RNG.uniform(600, 1200) + RNG.uniform(200, 600) * np.sin(2 * np.pi * rate * t)
    sig  = 0.85 * np.sin(2 * np.pi * np.cumsum(f) / sr)
    sig *= (0.7 + 0.3 * np.abs(np.sin(2 * np.pi * rate * t)))
    sig += 0.05 * RNG.standard_normal(n)
    return sig


GENERATORS = [
    gen_stationary_vehicle,
    gen_nonstationary_engine,
    gen_gunshot,
    gen_tactical_voice,
    gen_threat_siren,
]

# Target mu schedule per class: [normal, blast, recovery]
# Mirrors the System D logic in sim.js
MU_TARGETS = {
    0: 1.15,  # Stationary  — neural-optimal efficiency
    1: 0.85,  # Non-stat    — conservative
    2: 0.00,  # Gunshot     — freeze
    3: 0.70,  # Voice       — preserve speech
    4: 0.50,  # Siren       — careful (pass-through mode)
}


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class TacticalAcousticDataset(Dataset):
    """
    Generates synthetic frames on-the-fly.
    Each sample: (feature_vector, class_label, mu_target)
    """

    def __init__(self, n_samples: int = 5000, sr: int = SR_SIM):
        self.n   = n_samples
        self.sr  = sr

    def __len__(self):
        return self.n

    def __getitem__(self, idx):
        cls    = idx % N_CLASSES
        gen    = GENERATORS[cls]
        signal = gen(FFT_N * 4, self.sr)   # Generate 4 frames worth

        # Pick a random frame
        start = random.randint(0, FFT_N * 3)
        frame = signal[start: start + FFT_N]

        feat    = extract_features(frame, self.sr)
        fv      = build_feature_vector(feat)
        mu_tgt  = MU_TARGETS[cls]
        mode    = random.randint(0, 3)

        return (
            torch.from_numpy(fv).float(),           # feature vector
            torch.tensor(cls, dtype=torch.long),    # scene class
            torch.tensor(mu_tgt, dtype=torch.float),# µ target
            torch.tensor(mode, dtype=torch.long),   # tactical mode
        )


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------

def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training on: {device}")

    model  = TriBrainANCEngine().to(device)
    optim_ = optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched  = optim.lr_scheduler.CosineAnnealingLR(optim_, T_max=args.epochs)

    dataset = TacticalAcousticDataset(n_samples=args.samples, sr=SR_SIM)
    loader  = DataLoader(dataset, batch_size=args.batch, shuffle=True,
                         num_workers=0, pin_memory=False)

    ce_loss  = nn.CrossEntropyLoss()
    mse_loss = nn.MSELoss()

    best_acc = 0.0

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = total_ce = total_mu = n_correct = n_total = 0

        for feat, labels, mu_tgt, mode in loader:
            feat, labels = feat.to(device), labels.to(device)
            mu_tgt, mode = mu_tgt.to(device), mode.to(device)

            probs, step, mask = model(feat, mode)

            # Brain 1 loss: scene classification
            logits = torch.log(probs + 1e-8)
            loss_ce = ce_loss(logits, labels)

            # Brain 2 loss: mu_scale regression toward target
            loss_mu = mse_loss(step[:, 0], mu_tgt)

            # Brain 3 regularisation: mask should sum to ~half the bins
            # (neither all-suppress nor all-pass)
            loss_mask = ((mask.mean(dim=-1) - 0.4) ** 2).mean()

            loss = loss_ce + args.lam_mu * loss_mu + 0.05 * loss_mask

            optim_.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0)
            optim_.step()

            # Accuracy
            preds    = probs.argmax(dim=-1)
            n_correct += (preds == labels).sum().item()
            n_total   += labels.size(0)

            total_loss += loss.item()
            total_ce   += loss_ce.item()
            total_mu   += loss_mu.item()

        sched.step()
        acc = n_correct / max(1, n_total) * 100
        avg = total_loss / max(1, len(loader))
        print(f"Epoch {epoch:3d}/{args.epochs}  loss={avg:.4f}  "
              f"ce={total_ce/len(loader):.4f}  mu={total_mu/len(loader):.4f}  "
              f"acc={acc:.1f}%")

        if acc > best_acc:
            best_acc = acc
            torch.save(model.state_dict(), args.out)
            print(f"  ✓ Saved checkpoint (acc={acc:.1f}%)")

    print(f"\nTraining complete. Best accuracy: {best_acc:.1f}%")
    print(f"Model saved to: {args.out}")
    return model


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train SIH26052 AI/ML Tri-Brain Engine")
    parser.add_argument("--epochs",  type=int,   default=40,         help="Training epochs")
    parser.add_argument("--batch",   type=int,   default=64,         help="Batch size")
    parser.add_argument("--samples", type=int,   default=8000,       help="Dataset size")
    parser.add_argument("--lr",      type=float, default=3e-3,       help="Learning rate")
    parser.add_argument("--lam-mu",  type=float, default=0.5,        help="µ loss weight λ")
    parser.add_argument("--out",     type=str,   default="model.pt", help="Output checkpoint path")
    args = parser.parse_args()

    train(args)
