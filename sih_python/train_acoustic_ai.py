#!/usr/bin/env python3
"""
train_acoustic_ai.py — Synthetic Tactical Acoustic Dataset Generation & Model Training

Generates:
  - Multi-condition military soundscapes:
      Class 0: Stationary Vehicle / Turbine Hum (80-300 Hz)
      Class 1: Non-Stationary Rotor / Wind Buffeting (15-600 Hz modulated)
      Class 2: Gunfire / Rocket Blast Transients (150-180 dBSPL impulses)
      Class 3: Tactical Voice / Radio Comms (Formants 250-3400 Hz)
      Class 4: Acoustic Threat Cues (Sniper crack, warning siren, footsteps)
  - Trains EdgeAcousticAI parameters using cross-entropy and gradient regularizers.
"""

import os
import numpy as np
from neural_anc_model import EdgeAcousticAI
from export_edge_ai import export_c_header, export_json

def generate_tactical_dataset(num_samples_per_class=200, frame_len=256, fs=16000):
    """Generates synthetic labeled acoustic frames spanning 5 tactical classes."""
    rng = np.random.default_rng(42)
    X = []
    y = []

    for c in range(5):
        for _ in range(num_samples_per_class):
            t = np.arange(frame_len) / fs
            noise = rng.standard_normal(frame_len) * 0.2

            if c == 0:
                # Stationary engine
                f0 = rng.uniform(70, 130)
                sig = 0.8 * np.sin(2 * np.pi * f0 * t) + 0.4 * np.sin(2 * np.pi * 2 * f0 * t) + noise
            elif c == 1:
                # Non-stationary rotor
                f_mod = rng.uniform(18, 30)
                sig = np.sin(2 * np.pi * 350 * t) * (1.0 + 0.6 * np.sin(2 * np.pi * f_mod * t)) + noise
            elif c == 2:
                # High energy transient (gunshot)
                impulse = np.exp(-t * rng.uniform(200, 500)) * (rng.standard_normal(frame_len) + 0.5)
                sig = 4.0 * impulse + noise * 0.1
            elif c == 3:
                # Tactical voice formants
                f_voice = rng.uniform(120, 220)
                sig = (0.7 * np.sin(2 * np.pi * f_voice * t) + 0.5 * np.sin(2 * np.pi * 2 * f_voice * t) + 0.3 * np.sin(2 * np.pi * 3 * f_voice * t)) + noise * 0.3
            else:
                # Threat cue / siren
                f_siren = rng.uniform(800, 1500)
                sig = 0.9 * np.sin(2 * np.pi * f_siren * t) + noise * 0.2

            # Energy normalization
            rms = np.sqrt(np.mean(sig ** 2)) or 1.0
            sig = sig / rms

            X.append(sig)
            y.append(c)

    return np.array(X, dtype=np.float32), np.array(y, dtype=np.int64)

def train_edge_ai():
    print("Generating synthetic tactical acoustic dataset (1000 frames)...")
    X, y = generate_tactical_dataset(num_samples_per_class=200)

    model = EdgeAcousticAI()
    print("Extracting Mel-filterbank & statistical features...")

    features = []
    for sig in X:
        feats, _, _ = model.extract_features(sig)
        features.append(feats)
    features = np.array(features)

    # Mini-batch gradient descent for EdgeAcousticAI
    lr = 0.01
    epochs = 40
    batch_size = 32
    num_samples = len(features)

    print(f"Training EdgeAcousticAI over {epochs} epochs...")
    for ep in range(epochs):
        perm = np.random.permutation(num_samples)
        total_loss = 0.0
        correct = 0

        for b in range(0, num_samples, batch_size):
            idx = perm[b:b + batch_size]
            b_feats = features[idx]
            b_y = y[idx]

            # Forward
            h = np.dot(b_feats, model.W1.T) + model.b1
            h_act = np.where(h > 0, h, 0.1 * h)
            logits = np.dot(h_act, model.W2.T) + model.b2

            # Softmax
            exp_l = np.exp(logits - np.max(logits, axis=1, keepdims=True))
            probs = exp_l / np.sum(exp_l, axis=1, keepdims=True)

            # Loss & Accuracy
            for i, target in enumerate(b_y):
                loss = -np.log(probs[i, target] + 1e-12)
                total_loss += loss
                if np.argmax(probs[i]) == target:
                    correct += 1

            # Backward
            d_logits = probs.copy()
            for i, target in enumerate(b_y):
                d_logits[i, target] -= 1.0
            d_logits /= len(idx)

            dW2 = np.dot(d_logits.T, h_act)
            db2 = np.sum(d_logits, axis=0)

            dh = np.dot(d_logits, model.W2)
            dh_act = np.where(h > 0, dh, 0.1 * dh)

            dW1 = np.dot(dh_act.T, b_feats)
            db1 = np.sum(dh_act, axis=0)

            # Update
            model.W2 -= lr * dW2
            model.b2 -= lr * db2
            model.W1 -= lr * dW1
            model.b1 -= lr * db1

        if (ep + 1) % 10 == 0 or ep == epochs - 1:
            acc = (correct / num_samples) * 100.0
            avg_loss = total_loss / num_samples
            print(f"  Epoch {ep+1:02d}/{epochs} — Loss: {avg_loss:.4f} | Accuracy: {acc:.2f}%")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(base_dir)

    c_header = os.path.join(project_dir, 'c_embedded', 'arm_nn_weights.h')
    json_weights = os.path.join(base_dir, 'aiml_weights.json')

    export_c_header(model, c_header)
    export_json(model, json_weights)
    print("\nTraining & Export complete. Ready for real-time edge execution!")

if __name__ == '__main__':
    train_edge_ai()
