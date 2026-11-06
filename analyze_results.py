"""Plot BER and data rate vs delta-alpha for each distance from the receiver's CSV export.

Usage:
    python analyze_results.py bfsk_results.csv [more.csv ...]
Writes ber_vs_alpha.png, rate_vs_alpha.png and prints a summary table.
Requires: pip install pandas matplotlib
"""
import sys

import matplotlib.pyplot as plt
import pandas as pd

df = pd.concat([pd.read_csv(f) for f in sys.argv[1:]], ignore_index=True)
summary = (df.groupby(["preset_bps", "distance_cm", "delta_alpha"])
             .agg(trials=("ber", "size"), ber=("ber", "mean"), data_rate_bps=("data_rate_bps", "mean"),
                  camera_fps=("camera_fps", "mean"))
             .reset_index())
print(summary.to_string(index=False))
summary.to_csv("summary.csv", index=False)

for metric, ylabel, fname in [("ber", "Bit error rate", "ber_vs_alpha.png"),
                              ("data_rate_bps", "Data rate (correct bits / s)", "rate_vs_alpha.png")]:
    presets = sorted(summary.preset_bps.unique(), key=float)
    fig, axes = plt.subplots(1, len(presets), figsize=(5 * len(presets), 4), squeeze=False)
    for ax, p in zip(axes[0], presets):
        sub = summary[summary.preset_bps == p]
        for dist, g in sub.groupby("distance_cm"):
            g = g.sort_values("delta_alpha")
            ax.plot(g.delta_alpha, g[metric], "o-", label=f"{dist:g} cm")
        ax.set_xlabel("Δα"); ax.set_ylabel(ylabel); ax.set_title(f"{p} bps preset")
        ax.set_xticks(sorted(sub.delta_alpha.unique()))
        if metric == "ber":
            ax.set_ylim(-0.02, 1.02)
        ax.grid(alpha=0.3); ax.legend(title="distance")
    fig.tight_layout(); fig.savefig(fname, dpi=150)
    print("saved", fname)
