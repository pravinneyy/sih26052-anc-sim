#!/usr/bin/env python3

import argparse
import csv
import sys

import numpy as np
from scipy.signal import fftconvolve

# --------------------------------------------------------------------------
# Sample-rate rescaling helpers
# --------------------------------------------------------------------------
FS_REF = 4000.0     # sample rate the constants in the original sim.js were tuned at
FS = 48000.0        # target sample rate for this reimplementation
SCALE = FS / FS_REF  # = 12


def scale_len(n_ref):
    """Rescale a sample-domain length (filter taps, delays, windows) so it
    spans the same physical duration at FS that it did at FS_REF."""
    return max(1, round(n_ref * SCALE))


def scale_pole(pole_ref):
    """Rescale a one-pole IIR smoothing coefficient (as used directly in
    X = pole*X + (1-pole)*input) so the smoother keeps the same real-world
    time constant at FS as it had at FS_REF."""
    return pole_ref ** (1.0 / SCALE)


# --------------------------------------------------------------------------
# Acoustic paths: P = S * G, so an exact optimal filter always exists.
# A randomly drawn S is usually non-minimum-phase, so even a *correct*
# FxLMS loop only converges to the causal/stable part of it -- that's
# intentional, it's what makes the sim behave like a real system.
# --------------------------------------------------------------------------
def make_paths(seed):
    rng = np.random.default_rng(seed)

    nS, nG = scale_len(16), scale_len(20)
    dS, dG = scale_len(2), scale_len(4)
    tauS, tauG = 4.0 * SCALE, 6.0 * SCALE  # decay constants, same physical ms

    S = np.zeros(nS)
    G = np.zeros(nG)

    iS = np.arange(dS, nS)
    S[iS] = rng.standard_normal(len(iS)) * np.exp(-(iS - dS) / tauS)
    iG = np.arange(dG, nG)
    G[iG] = rng.standard_normal(len(iG)) * np.exp(-(iG - dG) / tauG)

    S /= np.sum(np.abs(S))
    G /= np.sum(np.abs(G))

    P = np.convolve(S, G)
    return P, S, G


def perturb(S, pct, seed=9):
    """Mismatch the true secondary path S to build the *estimate* Shat that
    the controller actually gets to use -- a real system never knows S
    exactly."""
    rng = np.random.default_rng(seed)
    return S * (1.0 + pct / 100.0 * rng.standard_normal(len(S)))


# --------------------------------------------------------------------------
# Disturbance signal: a slowly frequency-modulated tone-plus-lowpassed-noise
# bed, with sparse high-amplitude impulses added on top.
# --------------------------------------------------------------------------
def gen_noise(n, seed=2):
    rng = np.random.default_rng(seed)
    # AR(1) lowpass pole rescaled to keep the same ms time-constant as the
    # 0.86/0.14 pole in sim.js (tuned at FS_REF).
    a = scale_pole(0.86)
    b = 1.0 - a

    t = np.arange(n) / FS
    innov = rng.standard_normal(n)
    lp = np.zeros(n)
    acc = 0.0
    for i in range(n):
        acc = a * acc + b * innov[i]
        lp[i] = acc

    f = 100.0 + 60.0 * np.sin(2 * np.pi * 0.25 * t)
    x = (np.sin(2 * np.pi * f * t) + 0.8 * lp) * (1.0 + 0.4 * np.sin(2 * np.pi * 0.7 * t))

    x /= (np.sqrt(np.mean(x ** 2)) or 1.0)
    return x


def add_impulses(x, times, amp, seed=7):
    y = x.copy()
    rng = np.random.default_rng(seed)
    L = round(0.003 * FS)
    for t0 in times:
        i0 = round(t0 * FS)
        k = np.arange(min(L, len(y) - i0))
        shape = amp * np.exp(-k / (L / 4.0)) * rng.standard_normal(len(k))
        y[i0:i0 + len(k)] += shape
    return y


# --------------------------------------------------------------------------
# Impulse detector: energy-ratio (fast/slow) trip with hysteresis hold and
# a warm-up period so the bootstrap deadlock (background estimate starts at
# zero -> detector trips on itself -> never recovers) can't happen.
# --------------------------------------------------------------------------
class Detector:
    def __init__(self, thr=4.0):
        self.T = thr
        # poles rescaled from sim.js's 4 kHz-tuned values, see scale_pole()
        self.pole_fast = scale_pole(1.0 - 0.05)   # sim.js: af = 0.05
        self.pole_slow = scale_pole(0.999)        # sim.js: as = 0.999
        self.pole_leak = scale_pole(0.99999)      # sim.js: final Eb leak
        self.hold = scale_len_seconds(0.06)
        self.warm = scale_len_seconds(0.4)

        self.Ef = 0.0
        self.Eb = 0.0
        self.k = 0
        self.timer = 0
        self.state = 0

    def step(self, x):
        p = x * x
        self.Ef = self.pole_fast * self.Ef + (1.0 - self.pole_fast) * p
        self.k += 1

        if self.k < self.warm:
            self.Eb += (p - self.Eb) / self.k
            self.state = 0
            return 0, 0.0

        ratio = self.Ef / (self.Eb + 1e-12)
        if ratio > self.T:
            self.state = 1
            self.timer = self.hold
        else:
            self.Eb = self.pole_slow * self.Eb + (1.0 - self.pole_slow) * p
            if self.timer > 0:
                self.timer -= 1
                self.state = 2
            else:
                self.state = 0

        self.Eb = self.pole_leak * self.Eb + (1.0 - self.pole_leak) * min(p, 4 * self.Eb)
        return self.state, ratio


def scale_len_seconds(t_seconds):
    """A length expressed directly in seconds in sim.js -> samples at FS.
    (No FS_REF rescaling needed -- these were already physical durations.)"""
    return max(1, round(t_seconds * FS))


def score(e, E0):
    """Geman-McClure-style redescending weight: full gradient near 0,
    saturating (and eventually falling back off) for large errors."""
    return e / (1.0 + (abs(e) / (E0 + 1e-12)) ** 2)


# --------------------------------------------------------------------------
# FxLMS core
# --------------------------------------------------------------------------
def run_fxlms(x, P, S, Shat, variant, mu, L, thr=4.0, norm='instant'):
    n = len(x)
    d = fftconvolve(x, P)[:n]        # signal at the error mic, uncontrolled
    xf = fftconvolve(x, Shat)[:n]    # reference filtered by the secondary-path estimate

    w = np.zeros(L)
    xb = np.zeros(L)     # x history, xb[0] = x[k] ... xb[L-1] = x[k-L+1]
    xfb = np.zeros(L)    # xf history, same ordering
    Ls = len(S)
    yb = np.zeros(Ls)    # y history, yb[0] = y[k] ... yb[Ls-1] = y[k-Ls+1]

    e = np.zeros(n)
    st = np.zeros(n, dtype=np.uint8)
    ratio = np.zeros(n)

    det = Detector(thr)

    # sim.js leaves Emed/pnorm at a fixed 1e-3 and lets the leaky averages
    # below (also tuned at FS_REF) catch up sample by sample. At L=32,
    # FS=4 kHz that ramp is a handful of samples and is over before it
    # matters. At a realistic L (hundreds of taps) and 48 kHz it is not:
    # the power estimate stays orders of magnitude below the true
    # reference power for long enough that the normalised step g=mu/pnorm
    # is briefly huge and the filter blows up before pnorm ever catches
    # up. Seeding pnorm from the actual startup reference power removes
    # that artifact without changing anything about steady-state behaviour.
    warm_n = min(L, n)
    pnorm = float(np.mean(xf[:warm_n] ** 2)) + 1e-6 if warm_n else 1e-3
    Emed = float(np.mean(np.abs(d[:warm_n]))) + 1e-6 if warm_n else 1e-3

    # sim.js hardcodes a leaky-average pole (0.999) for pnorm at its 4 kHz
    # tuning; rescale it like every other one-pole constant so it keeps the
    # same physical (ms) time constant at FS. Emed always uses this leaky
    # form (it's a robustness-scale estimate, not a stability-critical
    # normalizer) -- only pnorm's mode is affected by --norm.
    pole_emed = scale_pole(0.999)
    pole_pw = scale_pole(0.999) if norm == 'leaky' else 0.0

    for k in range(n):
        xb[1:] = xb[:-1]
        xb[0] = x[k]
        xfb[1:] = xfb[:-1]
        xfb[0] = xf[k]

        y = float(np.dot(w, xb))

        yb[1:] = yb[:-1]
        yb[0] = y

        yp = float(np.dot(S, yb))
        err = d[k] - yp
        e[k] = err

        s, rt = det.step(x[k])
        st[k] = s
        ratio[k] = rt

        Emed = pole_emed * Emed + (1.0 - pole_emed) * abs(err)

        if variant == 'A':
            upd, m = err, mu
        elif variant == 'B':
            upd, m = score(err, 3 * Emed), mu
        else:  # 'C' -- robust weighting only when the detector says we're at risk
            if s == 1:
                upd, m = score(err, 3 * Emed), 0.0
            elif s == 2:
                upd, m = score(err, 3 * Emed), 0.15 * mu
            else:
                upd, m = err, mu

        pw = float(np.dot(xfb, xfb))
        # 'leaky': bound how fast one sample can move the power normaliser
        # (sim.js's own behaviour -- an impulse can't hijack pnorm, but the
        # normalizer also lags true power by ~250ms, which is why stability
        # requires a tiny mu). 'instant': pnorm tracks the current window's
        # power exactly, standard NLMS, no cap needed for stability.
        if norm == 'leaky':
            pnorm = pole_pw * pnorm + (1.0 - pole_pw) * min(pw, 4 * pnorm)
        else:
            pnorm = pw

        g = m / (pnorm + 1e-6)
        w += g * upd * xfb
        np.clip(w, -50, 50, out=w)

    return {'e': e, 'd': d, 'st': st, 'ratio': ratio}


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------
def smooth_db(e, ms=20):
    w = max(1, round(ms * FS / 1000.0))
    p = e ** 2
    csum = np.cumsum(np.insert(p, 0, 0.0))
    n = len(e)
    out = np.empty(n)
    for i in range(n):
        a = max(0, i - w + 1)
        seg_sum = csum[i + 1] - csum[a]
        out[i] = 10 * np.log10(seg_sum / (i - a + 1) + 1e-12)
    return out


def atten_db(d, e, a, b):
    sd = np.sum(d[a:b] ** 2)
    se = np.sum(e[a:b] ** 2)
    return 10 * np.log10(sd / (se + 1e-12))


def recovery_ms(sm, from_idx, baseline_db, tol_db, hold_samples):
    count = 0
    for i in range(from_idx, len(sm)):
        if abs(sm[i] - baseline_db) <= tol_db:
            count += 1
            if count >= hold_samples:
                return max(0, i - hold_samples - from_idx) / FS * 1000.0
        else:
            count = 0
    return max(0, len(sm) - from_idx) / FS * 1000.0


# --------------------------------------------------------------------------
# One (path, variant) trial
# --------------------------------------------------------------------------
def run_trial(path_seed, variant, duration, taps, mu, thr,
              mismatch_pct, impulse_amp, noise_seed, impulse_seed, norm='instant'):
    n = scale_len_seconds(duration)
    P, S, G = make_paths(path_seed)
    Shat = perturb(S, mismatch_pct, seed=path_seed * 1000 + 9)

    x = gen_noise(n, seed=noise_seed)
    impulse_times = [duration * f for f in (0.25, 0.5, 0.75)]
    x = add_impulses(x, impulse_times, impulse_amp, seed=impulse_seed)

    out = run_fxlms(x, P, S, Shat, variant, mu, taps, thr, norm=norm)
    e, d = out['e'], out['d']

    sm_e = smooth_db(e)
    sm_d = smooth_db(d)

    # Steady-state attenuation: last 30% of the run, well after any impulse.
    tail_a = round(0.7 * n)
    steady_atten = atten_db(d, e, tail_a, n)

    # Recovery time after each impulse: ms until the smoothed *residual*
    # settles back within 3 dB of its own pre-impulse (already-converged)
    # level and stays there for 50 ms. Comparing against the raw disturbance
    # d instead of the residual's own settled level was a bug -- once the
    # controller is attenuating by more than the tolerance, the residual is
    # *supposed* to sit below d's level forever, so "recovery" against d
    # could never actually be reached and every trial hit the fallback
    # (time-to-end-of-trace) value instead of a real number.
    tol_db = 3.0
    hold = scale_len_seconds(0.05)
    pre_window = scale_len_seconds(0.25)
    pre_gap = scale_len_seconds(0.05)
    recoveries = []
    for t0 in impulse_times:
        i0 = round(t0 * FS)
        pre_a = max(0, i0 - pre_gap - pre_window)
        pre_b = max(pre_a + 1, i0 - pre_gap)
        baseline_db = np.median(sm_e[pre_a:pre_b])
        recoveries.append(recovery_ms(sm_e, i0, baseline_db, tol_db, hold))

    return {
        'path_seed': path_seed,
        'variant': variant,
        'steady_atten_db': steady_atten,
        'mean_recovery_ms': float(np.mean(recoveries)),
        'max_recovery_ms': float(np.max(recoveries)),
    }


# --------------------------------------------------------------------------
# Sweep across acoustic paths
# --------------------------------------------------------------------------
def run_sweep(n_paths=6, duration=4.0, taps=None, mu=None, thr=4.0,
              mismatch_pct=15.0, impulse_amp=10.0, base_seed=1, norm='instant'):
    if taps is None:
        taps = scale_len(32)  # same physical filter span as sim.js's 32 taps @ 4 kHz
    if mu is None:
        # 0.005 is the raw stability ceiling for 'instant' norm at 384 taps
        # (max|e| stays bounded), but the hardest of the 6 default paths is
        # only *marginally* stable there (worst-case path can show negative
        # dB, i.e. genuine divergence, not just noise) -- 7e-4 keeps a real
        # margin so every default path converges cleanly. Tighten further
        # (or loosen, if you've checked your own path draws) with --mu.
        mu = 7e-4 if norm == 'instant' else 2e-5
    used_mu = mu

    path_seeds = [base_seed + i for i in range(n_paths)]
    variants = ['A', 'B', 'C']
    results = []

    for ps in path_seeds:
        for v in variants:
            r = run_trial(
                path_seed=ps, variant=v, duration=duration, taps=taps,
                mu=mu, thr=thr, mismatch_pct=mismatch_pct,
                impulse_amp=impulse_amp,
                noise_seed=ps * 100 + 2, impulse_seed=ps * 100 + 7,
                norm=norm,
            )
            results.append(r)

    return results, taps, used_mu


def summarize(results):
    variants = ['A', 'B', 'C']
    summary = {}
    for v in variants:
        rows = [r for r in results if r['variant'] == v]
        atten = np.array([r['steady_atten_db'] for r in rows])
        rec = np.array([r['mean_recovery_ms'] for r in rows])
        summary[v] = {
            'atten_mean': atten.mean(), 'atten_std': atten.std(),
            'rec_mean': rec.mean(), 'rec_std': rec.std(),
        }
    return summary


def print_report(results, summary, taps, norm='instant', mu=None):
    mu_str = f", mu={mu:g}" if mu is not None else ""
    print(f"FxLMS ANC sweep -- FS={FS:.0f} Hz, taps={taps} "
          f"({taps / FS * 1000:.1f} ms), norm={norm}{mu_str}, "
          f"{len({r['path_seed'] for r in results})} acoustic paths\n")

    print(f"{'path':>5} {'variant':>7} {'atten (dB)':>11} {'mean recov (ms)':>17} {'max recov (ms)':>16}")
    for r in results:
        print(f"{r['path_seed']:>5} {r['variant']:>7} {r['steady_atten_db']:>11.2f} "
              f"{r['mean_recovery_ms']:>17.1f} {r['max_recovery_ms']:>16.1f}")

    print("\nAcross-path summary (mean +/- std):")
    for v in ['A', 'B', 'C']:
        s = summary[v]
        print(f"  variant {v}: attenuation {s['atten_mean']:6.2f} +/- {s['atten_std']:4.2f} dB   "
              f"recovery {s['rec_mean']:7.1f} +/- {s['rec_std']:6.1f} ms")


def write_csv(path, results):
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--paths', type=int, default=6, help='number of swept acoustic paths')
    ap.add_argument('--duration', type=float, default=4.0, help='signal duration, seconds')
    ap.add_argument('--taps', type=int, default=None,
                     help='adaptive filter length (default: 384, i.e. 8 ms @ 48 kHz)')
    ap.add_argument('--norm', choices=['instant', 'leaky'], default='instant',
                     help="power-normalizer mode (default: instant). 'instant' is "
                          "textbook NLMS (fast, stable to mu~0.005 @ 384 taps). "
                          "'leaky' reproduces sim.js's own ~250ms-lagging normalizer "
                          "(much slower, stable only to mu~2e-5 @ 384 taps)")
    ap.add_argument('--mu', type=float, default=None,
                     help='LMS step size (normalised step g=mu/pnorm). Default depends '
                          'on --norm: 7e-4 for instant, 2e-5 for leaky -- both chosen '
                          'with a stability margin across all 6 default paths at the '
                          'default 384-tap filter; scale down for longer filters or a '
                          'harder --seed draw')
    ap.add_argument('--thr', type=float, default=4.0, help='detector energy-ratio threshold')
    ap.add_argument('--mismatch', type=float, default=15.0,
                     help='percent random mismatch between true and estimated secondary path')
    ap.add_argument('--impulse-amp', type=float, default=10.0, help='impulse amplitude')
    ap.add_argument('--seed', type=int, default=1, help='base seed for path sweep')
    ap.add_argument('--csv', type=str, default=None, help='optional path to write per-trial results as CSV')
    args = ap.parse_args()

    results, taps, used_mu = run_sweep(
        n_paths=args.paths, duration=args.duration, taps=args.taps, mu=args.mu,
        thr=args.thr, mismatch_pct=args.mismatch, impulse_amp=args.impulse_amp,
        base_seed=args.seed, norm=args.norm,
    )
    summary = summarize(results)
    print_report(results, summary, taps, norm=args.norm, mu=used_mu)

    if args.csv:
        write_csv(args.csv, results)
        print(f"\nWrote per-trial results to {args.csv}")


if __name__ == '__main__':
    sys.exit(main())
