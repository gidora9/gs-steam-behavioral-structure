import csv
import json
import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap, LogNorm


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "steam_behavioral_baseline.csv"
SUMMARY = ROOT / "data" / "steam_behavioral_summary.json"
OUT = ROOT / "assets"


def short(value):
    if value >= 1000:
        return f"{round(value / 1000):g}k"
    return f"{int(value)}"


def load_points():
    owned = []
    hours = []
    residual = []
    with DATA.open(newline="") as f:
        for row in csv.DictReader(f):
            g = float(row["owned_games"])
            h = float(row["total_hours"])
            if g > 0 and h > 0:
                owned.append(math.log10(g))
                hours.append(math.log10(h))
                residual.append(float(row["log_residual"]))
    return np.array(owned), np.array(hours), np.array(residual)


def render():
    OUT.mkdir(exist_ok=True)
    owned, hours, residual = load_points()
    summary = json.loads(SUMMARY.read_text())
    model = summary["models"]["lifetime"]
    a = float(model["intercept_a"])
    b = float(model["slope_b"])

    x_min, x_max = 0, math.log10(max(10000, np.quantile(10**owned, 0.9995)) * 1.08)
    y_min, y_max = 1, math.log10(max(80000, np.quantile(10**hours, 0.9995)) * 1.15)

    x_line = np.linspace(x_min, x_max, 260)
    games_line = 10**x_line
    y_gs = np.log10(np.maximum(1, 10 ** (a + b * np.log10(games_line + 1)) - 1))

    median_x = np.median(np.log10((10**owned) + 1))
    median_y = np.median(np.log10((10**hours) + 1))
    benchmark_slope = 0.92
    benchmark_intercept = median_y - benchmark_slope * median_x
    y_benchmark = np.log10(
        np.maximum(1, 10 ** (benchmark_intercept + benchmark_slope * np.log10(games_line + 1)) - 1)
    )

    bg = "#f7f4ed"
    ink = "#26313c"
    muted = "#66758a"
    gs_line = "#8b4f2d"
    bench_line = "#929aa4"
    gap = "#c9ad82"
    density = LinearSegmentedColormap.from_list(
        "gs_density",
        ["#f7f4ed", "#d8e2e8", "#8ba9b8", "#4c768b", "#264e63"],
    )

    fig = plt.figure(figsize=(16, 9), dpi=180, facecolor=bg)
    ax = fig.add_axes([0.08, 0.21, 0.82, 0.58], facecolor=bg)

    ax.hexbin(
        owned,
        hours,
        gridsize=150,
        extent=(x_min, x_max, y_min, y_max),
        mincnt=1,
        cmap=density,
        norm=LogNorm(vmin=1, vmax=850),
        linewidths=0,
        alpha=0.92,
    )

    ax.fill_between(x_line, y_gs, y_benchmark, color=gap, alpha=0.18, zorder=2)
    ax.plot(x_line, y_benchmark, color=bench_line, linewidth=3.2, alpha=0.72, zorder=4)
    ax.plot(x_line, y_gs, color=gs_line, linewidth=5.0, alpha=0.95, zorder=5)

    ax.set_xlim(x_min, x_max)
    ax.set_ylim(y_min, y_max)
    ax.set_xticks([0, 1, 2, 3, 4])
    ax.set_xticklabels(["1", "10", "100", "1k", "10k"], fontsize=18, color=ink)
    ax.set_yticks([1, 2, 3, 4, math.log10(50000)])
    ax.set_yticklabels(["10", "100", "1k", "10k", "50k"], fontsize=18, color=ink)
    ax.set_xlabel("Steam games owned", fontsize=25, color=ink, labelpad=12)
    ax.set_ylabel("Lifetime Steam hours", fontsize=24, color=ink, labelpad=16)
    ax.grid(True, color=ink, alpha=0.055, linewidth=1.0)
    for spine in ax.spines.values():
        spine.set_color((38 / 255, 49 / 255, 60 / 255, 0.16))

    fig.text(0.08, 0.925, "Games grow faster than hours", fontsize=48, color=ink, weight=700)
    fig.text(
        0.08,
        0.865,
        "GS Steam libraries expand horizontally, while engagement rises more slowly.",
        fontsize=21,
        color=muted,
    )

    ax.text(
        0.58,
        0.88,
        "proportional benchmark",
        transform=ax.transAxes,
        fontsize=18,
        color=bench_line,
        ha="left",
    )
    ax.text(
        0.66,
        0.69,
        "observed GS baseline",
        transform=ax.transAxes,
        fontsize=21,
        color=gs_line,
        weight=700,
        ha="left",
    )
    ax.text(
        0.70,
        0.30,
        "engagement gap",
        transform=ax.transAxes,
        fontsize=32,
        color=gs_line,
        alpha=0.52,
        weight=700,
        ha="center",
    )

    fig.text(
        0.08,
        0.075,
        f"{short(summary['quality']['users_with_steam_ownership'])} Steam owners  |  "
        f"{short(summary['models']['lifetime']['model_users'])} with playtime  |  "
        f"signal = actual hours / expected hours",
        fontsize=17,
        color=muted,
    )
    fig.text(
        0.08,
        0.038,
        "Not who plays the most. This shows engagement relative to ownership exposure.",
        fontsize=17,
        color=ink,
        weight=700,
    )

    png = OUT / "steam-behavioral-structure-pdf.png"
    svg = OUT / "steam-behavioral-structure-pdf.svg"
    pdf = OUT / "steam-behavioral-structure-pdf.pdf"
    fig.savefig(png, facecolor=bg)
    fig.savefig(svg, facecolor=bg)
    fig.savefig(pdf, facecolor=bg)
    print(png)
    print(svg)
    print(pdf)


if __name__ == "__main__":
    render()
