"""
neural_anc_model.py — PyTorch AI/ML Model Architectures
SIH26052 Tactical ANC Headset — Edge AI/ML Tri-Brain Engine

Three neural network modules mirroring the JavaScript aiml_engine.js
implementation, designed for INT8 quantisation and CMSIS-NN export:

    AcousticSceneClassifier   — Brain 1: 5-class log-linear scene classifier
    NeuralStepSupervisor      — Brain 2: µ(n) and Huber-β MLP predictor
    DeepSpectralMaskNet       — Brain 3: per-bin spectral gain predictor

Training pipeline: train_acoustic_ai.py
Evaluation:        evaluate_aiml_anc.py
Export:            export_edge_ai.py  →  arm_nn_weights.h  +  model.onnx

References:
    Barchiesi et al. 2015 — Acoustic scene classification survey
    Salamon et al. 2017   — Deep convolutional neural networks for ESC
    CMSIS-NN (Lai 2018)   — Efficient NN on ARM Cortex-M
"""

import math
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# ---------------------------------------------------------------------------
# Constants (must match aiml_engine.js)
# ---------------------------------------------------------------------------

N_CLASSES  = 5
N_MELS     = 24
FFT_N      = 256
HOP        = 64
N_FEATURES = 7   # [centroid, zcr, hfRatio, flatness, energyLog, peakNorm, bias]

CLASS_NAMES = [
    "Stationary Vehicle",
    "Non-Stationary Engine",
    "Gunshot / Blast Transient",
    "Tactical Voice",
    "Threat Cue / Warning Siren",
]

SR_SIM  = 4000   # Simulation sample rate
SR_ENH  = 16000  # Enhancement lane sample rate


# ---------------------------------------------------------------------------
# Feature Extraction (NumPy, mirrors JS extractFeatures())
# ---------------------------------------------------------------------------

def extract_features(frame: np.ndarray, sr: int) -> dict:
    """
    Extract 6 acoustic features from a time-domain frame.

    Returns dict with keys:
        centroid, zcr, hfRatio, flatness, energy, peakNorm
    """
    N = FFT_N
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)  # Hann

    # Power spectrum
    frame_w = frame[:N] * win if len(frame) >= N else np.pad(frame, (0, N - len(frame))) * win
    ps = np.abs(np.fft.rfft(frame_w, n=N)[: N // 2]) ** 2 / N
    total_pow = ps.sum() + 1e-12

    # Spectral centroid (normalised)
    centroid = np.dot(np.arange(N // 2), ps) / (total_pow * N // 2)

    # Zero-crossing rate
    zcr = np.mean(np.diff(np.sign(frame[:N])) != 0)

    # High-frequency energy ratio (above 1 kHz)
    hf_start = max(1, round(1000 / (sr / 2) * (N // 2)))
    hf_ratio = ps[hf_start:].sum() / total_pow

    # Spectral flatness
    geom_mean = np.exp(np.mean(np.log(ps + 1e-12)))
    flatness   = float(min(1.0, geom_mean / (total_pow / (N // 2) + 1e-12)))

    # Frame power
    energy = float(np.mean(frame[:N] ** 2))

    # Peak normalised ratio
    peak     = float(ps.max())
    peak_norm = min(10.0, peak / (total_pow / (N // 2) + 1e-12))

    return dict(
        centroid=float(centroid),
        zcr=float(zcr),
        hfRatio=float(hf_ratio),
        flatness=flatness,
        energy=energy,
        peakNorm=float(peak_norm),
    )


def build_feature_vector(feat: dict) -> np.ndarray:
    """Convert feature dict → normalised 7-element input vector."""
    e_log  = max(-2.0, min(2.0, math.log10(feat["energy"] + 1e-6) / 3 + 0.8))
    p_norm = min(1.0, math.log10(feat["peakNorm"] + 1) / 1.5)
    return np.array([
        feat["centroid"],
        feat["zcr"],
        feat["hfRatio"],
        feat["flatness"],
        e_log,
        p_norm,
        1.0,   # bias term
    ], dtype=np.float32)


# ---------------------------------------------------------------------------
# Brain 1 — Acoustic Scene Classifier
# ---------------------------------------------------------------------------

class AcousticSceneClassifier(nn.Module):
    """
    Compact log-linear classifier for 5 tactical acoustic scene classes.

    Architecture:
        Input  : N_FEATURES (7) acoustic features per frame
        Hidden : optional 16-unit ReLU layer for non-linear capacity
        Output : N_CLASSES (5) logits → softmax probabilities

    Designed for INT8 CMSIS-NN quantisation:
        · N_FEATURES × N_CLASSES weight table = 35 INT8 MACs  (linear)
        · N_FEATURES × 16 + 16 × N_CLASSES    = 192 INT8 MACs (with hidden)
        · < 1 µs on Cortex-M55 @ 400 MHz with Ethos-U55
    """

    def __init__(self, use_hidden: bool = True, hidden_dim: int = 16):
        super().__init__()
        self.use_hidden = use_hidden
        if use_hidden:
            self.fc1 = nn.Linear(N_FEATURES, hidden_dim)
            self.fc2 = nn.Linear(hidden_dim, N_CLASSES)
        else:
            self.fc  = nn.Linear(N_FEATURES, N_CLASSES, bias=True)

        self._init_weights()

    def _init_weights(self):
        """Initialise weights from the hand-tuned JS classifier matrix."""
        # Row = class, col = [centroid, zcr, hfRatio, flatness, energyLog, peakNorm, bias]
        W = torch.tensor([
            [-3.5, -2.8, -1.8, -4.5,  0.3,  2.8,  2.0],   # Stationary Vehicle
            [ 0.6,  1.3,  1.0, -1.2, -0.2,  0.3,  1.0],   # Non-Stationary Engine
            [-0.4,  4.2,  3.2,  6.0,  4.5, -0.8, -5.0],   # Gunshot / Blast
            [ 2.0,  1.8, -2.0,  0.8, -1.0,  0.5,  0.6],   # Tactical Voice
            [ 4.0, -0.4,  3.5, -4.0,  0.6,  4.2, -0.8],   # Threat Siren
        ])
        if self.use_hidden:
            nn.init.xavier_uniform_(self.fc1.weight)
            nn.init.zeros_(self.fc1.bias)
            nn.init.xavier_uniform_(self.fc2.weight)
            nn.init.zeros_(self.fc2.bias)
        else:
            with torch.no_grad():
                self.fc.weight.copy_(W[:, :N_FEATURES - 1])
                self.fc.bias.copy_(W[:, -1])

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (batch, N_FEATURES) → probs: (batch, N_CLASSES)"""
        if self.use_hidden:
            h = F.relu(self.fc1(x))
            logits = self.fc2(h)
        else:
            logits = self.fc(x)
        return F.softmax(logits, dim=-1)

    def classify_frame(self, frame: np.ndarray, sr: int) -> np.ndarray:
        """Convenience: raw audio frame → class probability vector."""
        feat = extract_features(frame, sr)
        fv   = torch.from_numpy(build_feature_vector(feat)).unsqueeze(0)
        with torch.no_grad():
            return self.forward(fv).squeeze(0).numpy()


# ---------------------------------------------------------------------------
# Brain 2 — Neural Step-Size µ(n) & Stability Supervisor
# ---------------------------------------------------------------------------

class NeuralStepSupervisor(nn.Module):
    """
    2-layer MLP predicting optimal FxLMS step size scale and Huber threshold.

    Architecture:
        Input  : [class_probs(5), energy_log, zcr, flatness]  — 8 inputs
        Hidden : 6 units, ReLU
        Output : [mu_scale ∈ [0, 1.5],  beta_scale ∈ [1, 5]]

    Training target:
        mu_scale   minimises residual-error variance post-convergence
        beta_scale minimises weight-divergence probability during transients

    Export: 6×8 + 2×6 = 60 INT8 MACs ≈ 0.3 µs on Cortex-M55
    """

    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(8, 6)
        self.fc2 = nn.Linear(6, 2)
        self._init_weights()

    def _init_weights(self):
        """Initialise from the JS MLP_W1/MLP_W2 hand-tuned matrices."""
        W1 = torch.tensor([
            [ 1.2, -0.9,  0.4, -1.5,  0.8, -0.6,  0.5, -0.3],
            [-0.6,  1.8, -1.2,  0.7,  1.3,  0.4, -0.8,  0.6],
            [ 0.9, -0.5,  1.4, -0.8,  0.3,  0.9,  0.2, -0.7],
            [-2.0,  0.6,  1.6,  0.4, -0.7,  1.1, -0.4,  0.9],
            [ 0.4,  1.1, -0.6,  1.8, -1.2, -0.5,  1.0, -0.8],
            [ 1.4, -1.2,  0.5,  1.0,  0.9, -1.0,  0.6,  0.4],
        ])
        B1 = torch.tensor([0.2, -0.3, 0.15, 0.5, -0.2, 0.35])
        W2 = torch.tensor([
            [ 1.1, -0.8,  0.7, -1.4,  1.0, -0.5],
            [-0.7,  1.3, -0.9,  0.8, -0.6,  1.5],
        ])
        B2 = torch.tensor([0.9, 2.6])
        with torch.no_grad():
            self.fc1.weight.copy_(W1)
            self.fc1.bias.copy_(B1)
            self.fc2.weight.copy_(W2)
            self.fc2.bias.copy_(B2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (batch, 8)  →  out: (batch, 2)
            out[:, 0] = mu_scale   (sigmoid × 1.5)
            out[:, 1] = beta_scale (1 + sigmoid × 4)
        """
        h   = F.relu(self.fc1(x))
        raw = self.fc2(h)
        mu_scale   = 1.5 * torch.sigmoid(raw[:, 0])
        beta_scale = 1.0 + 4.0 * torch.sigmoid(raw[:, 1])
        return torch.stack([mu_scale, beta_scale], dim=-1)


# ---------------------------------------------------------------------------
# Brain 3 — Deep Spectral Mask & Selective Transparency Engine
# ---------------------------------------------------------------------------

class DeepSpectralMaskNet(nn.Module):
    """
    Scene-conditioned spectral mask generator.

    Architecture:
        Input  : [class_probs(5), mode_onehot(4), freq_bin_norm(1)]  per bin
        Hidden : 16 → 8 units, ReLU
        Output : gain ∈ [0, 1] per frequency bin (sigmoid)

    Called once per FFT frame, vectorised across all N/2 frequency bins:
        Total MACs = N/2 × (10×16 + 16×8 + 8×1) ≈ 45k per frame

    Modes:
        0 = STEALTH        — maximum noise suppression
        1 = TACTICAL_VOICE — preserve speech 150–4000 Hz
        2 = COMBAT_AWARE   — pass gunshot/siren threat cues
        3 = AMBIENT        — light suppression
    """

    N_MODES = 4

    def __init__(self, n_bins: int = FFT_N // 2):
        super().__init__()
        self.n_bins  = n_bins
        inp_dim = N_CLASSES + self.N_MODES + 1   # probs + mode + freq_norm
        self.net = nn.Sequential(
            nn.Linear(inp_dim, 16),
            nn.ReLU(),
            nn.Linear(16, 8),
            nn.ReLU(),
            nn.Linear(8, 1),
            nn.Sigmoid(),
        )
        self._init_weights()

    def _init_weights(self):
        for m in self.net.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight, gain=0.8)
                nn.init.constant_(m.bias, 0.1)

    def forward(
        self,
        class_probs: torch.Tensor,   # (batch, N_CLASSES)
        mode: torch.Tensor,           # (batch,) integer 0-3
        n_bins: int | None = None,
    ) -> torch.Tensor:
        """
        Returns gain mask: (batch, n_bins) in [0, 1].
        """
        B      = class_probs.size(0)
        n_bins = n_bins or self.n_bins

        # Mode one-hot
        mode_oh = F.one_hot(mode.long(), num_classes=self.N_MODES).float()  # (B, 4)

        # Frequency bins normalised [0, 1]
        freq   = torch.linspace(0, 1, n_bins, device=class_probs.device)    # (n_bins,)
        freq   = freq.unsqueeze(0).unsqueeze(-1).expand(B, -1, 1)           # (B, n_bins, 1)

        # Expand class_probs and mode_oh across bins
        probs_exp = class_probs.unsqueeze(1).expand(-1, n_bins, -1)          # (B, n_bins, 5)
        mode_exp  = mode_oh.unsqueeze(1).expand(-1, n_bins, -1)              # (B, n_bins, 4)

        inp  = torch.cat([probs_exp, mode_exp, freq], dim=-1)                # (B, n_bins, 10)
        gain = self.net(inp).squeeze(-1)                                      # (B, n_bins)
        return gain

    def generate_mask(
        self,
        class_probs: np.ndarray,   # (N_CLASSES,)
        mode: int,
        sr: int,
    ) -> np.ndarray:
        """Convenience: numpy in → numpy out."""
        probs_t = torch.from_numpy(class_probs.astype(np.float32)).unsqueeze(0)
        mode_t  = torch.tensor([mode], dtype=torch.long)
        with torch.no_grad():
            mask = self.forward(probs_t, mode_t, n_bins=FFT_N // 2)
        return mask.squeeze(0).numpy()


# ---------------------------------------------------------------------------
# Combined Tri-Brain Module
# ---------------------------------------------------------------------------

class TriBrainANCEngine(nn.Module):
    """
    Combined edge AI/ML module for the tactical ANC headset.
    Wraps all three brains for joint training and ONNX export.
    """

    def __init__(self):
        super().__init__()
        self.brain1 = AcousticSceneClassifier(use_hidden=True)
        self.brain2 = NeuralStepSupervisor()
        self.brain3 = DeepSpectralMaskNet()

    def forward(
        self,
        features: torch.Tensor,     # (batch, N_FEATURES) acoustic feature vector
        mode: torch.Tensor,          # (batch,) int tactical mode
    ):
        """
        Returns:
            class_probs  : (batch, N_CLASSES)  — scene classification
            step_params  : (batch, 2)           — [mu_scale, beta_scale]
            spectral_mask: (batch, N//2)        — per-bin gain [0, 1]
        """
        class_probs   = self.brain1(features)
        brain2_input  = torch.cat([
            class_probs,
            features[:, 4:5],    # energy_log
            features[:, 1:2],    # zcr
            features[:, 3:4],    # flatness
        ], dim=-1)
        step_params   = self.brain2(brain2_input)
        spectral_mask = self.brain3(class_probs, mode)
        return class_probs, step_params, spectral_mask


# ---------------------------------------------------------------------------
# Model summary
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    engine = TriBrainANCEngine()
    total_params = sum(p.numel() for p in engine.parameters())
    print(f"TriBrainANCEngine — Total parameters: {total_params}")
    print(f"  Brain 1 (Classifier):   {sum(p.numel() for p in engine.brain1.parameters())} params")
    print(f"  Brain 2 (Step-Size):    {sum(p.numel() for p in engine.brain2.parameters())} params")
    print(f"  Brain 3 (Spectral Mask):{sum(p.numel() for p in engine.brain3.parameters())} params")

    # Test forward pass
    B = 4
    feat = torch.randn(B, N_FEATURES)
    mode = torch.randint(0, 4, (B,))
    probs, step, mask = engine(feat, mode)
    print(f"\nForward pass shapes:")
    print(f"  class_probs  : {probs.shape}")   # (4, 5)
    print(f"  step_params  : {step.shape}")    # (4, 2)
    print(f"  spectral_mask: {mask.shape}")    # (4, 128)
    print(f"\nclass_probs sum (should be ≈1): {probs.sum(dim=-1)}")
    print(f"mu_scale range:   [{step[:,0].min():.3f}, {step[:,0].max():.3f}]  (target: [0, 1.5])")
    print(f"beta_scale range: [{step[:,1].min():.3f}, {step[:,1].max():.3f}]  (target: [1, 5])")
    print(f"mask range:       [{mask.min():.3f}, {mask.max():.3f}]  (target: [0, 1])")
