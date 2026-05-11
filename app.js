const DATA_PATH = "./data/steam_behavioral_baseline.csv";
const SUMMARY_PATH = "./data/steam_behavioral_summary.json";

const state = {
  rows: [],
  summary: null,
  freshOnly: false,
  benchmarkOn: true,
  renderCount: 0,
};

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatShort(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `${Math.round(value)}`;
}

function parseFlag(value) {
  return String(value).toLowerCase() === "t" || String(value).toLowerCase() === "true";
}

async function loadSummary() {
  const response = await fetch(SUMMARY_PATH);
  return response.json();
}

function loadCsv() {
  return new Promise((resolve, reject) => {
    const rows = [];
    Papa.parse(DATA_PATH, {
      download: true,
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      worker: false,
      step(result) {
        const row = result.data;
        const owned = number(row.owned_games);
        const hours = number(row.total_hours);
        if (!owned || !hours || owned <= 0 || hours <= 0) return;
        rows.push({
          user_id: row.user_id,
          owned_games: owned,
          total_hours: hours,
          signal_ratio: number(row.signal_ratio) ?? 0,
          log_residual: number(row.log_residual) ?? 0,
          tenure_adjusted_signal: number(row.tenure_adjusted_signal) ?? 0,
          tenure_band: row.tenure_band || "Unknown",
          behavioral_segment: row.behavioral_segment || "Core Market",
          sync_freshness_band: row.sync_freshness_band || "unknown",
          stale_sync_flag: parseFlag(row.stale_sync_flag),
        });
      },
      complete() {
        resolve(rows);
      },
      error(error) {
        reject(error);
      },
    });
  });
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function makeLineSpace(min, max, count) {
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  return Array.from({ length: count }, (_, i) => 10 ** (logMin + (i / (count - 1)) * (logMax - logMin)));
}

function colorPayload(rows) {
  return {
    color: rows.map((row) => Math.max(-1.1, Math.min(1.1, row.log_residual))),
    colorscale: [
      [0, "#245a9c"],
      [0.45, "#8aa7b6"],
      [0.5, "#d8d1bf"],
      [0.72, "#c57a31"],
      [1, "#a33d2f"],
    ],
    cmin: -1.1,
    cmax: 1.1,
    colorbar: {
      title: { text: "below / above expected", side: "right" },
      thickness: 7,
      len: 0.30,
      y: 0.20,
      x: 1.025,
      outlinewidth: 0,
      tickvals: [-1, 0, 1],
      ticktext: ["below", "expected", "above"],
      tickfont: { color: "#7a8696", size: 9 },
      titlefont: { color: "#7a8696", size: 9 },
    },
    showscale: true,
  };
}

function makePlot() {
  const rows = state.freshOnly ? state.rows.filter((row) => !row.stale_sync_flag) : state.rows;
  const owned = rows.map((row) => row.owned_games);
  const hours = rows.map((row) => row.total_hours);
  const minOwned = 1;
  const minHours = 10;
  const maxOwned = Math.max(10000, quantile(owned, 0.9995));
  const maxHours = Math.max(80000, quantile(hours, 0.9995));
  const xRange = [Math.log10(minOwned), Math.log10(maxOwned * 1.08)];
  const yRange = [Math.log10(minHours), Math.log10(maxHours * 1.15)];
  const medianOwned = quantile(owned, 0.5);
  const medianHours = quantile(hours, 0.5);

  const model = state.summary.models.lifetime;
  const a = Number(model.intercept_a);
  const b = Number(model.slope_b);
  const xLine = makeLineSpace(minOwned, maxOwned * 1.08, 240);
  const yGs = xLine.map((x) => Math.max(1, 10 ** (a + b * Math.log10(x + 1)) - 1));

  const medianX = Math.log10(medianOwned + 1);
  const medianY = Math.log10(medianHours + 1);
  const benchmarkSlope = 0.92;
  const benchmarkIntercept = medianY - benchmarkSlope * medianX;
  const yBenchmark = xLine.map((x) =>
    Math.max(1, 10 ** (benchmarkIntercept + benchmarkSlope * Math.log10(x + 1)) - 1),
  );

  const color = colorPayload(rows);
  const cloud = {
    type: "scattergl",
    mode: "markers",
    name: "GS users",
    x: owned,
    y: hours,
    customdata: rows.map((row) => [
      row.signal_ratio,
      row.log_residual,
      row.tenure_adjusted_signal,
      row.tenure_band,
      row.behavioral_segment,
      row.sync_freshness_band,
    ]),
    marker: {
      size: 2.2,
      opacity: 0.22,
      line: { width: 0 },
      ...color,
    },
    hovertemplate:
      "owned games: %{x:,}<br>" +
      "lifetime hours: %{y:,.0f}<br>" +
      "signal: %{customdata[0]:.2f}x<br>" +
      "log residual: %{customdata[1]:.3f}<br>" +
      "segment: %{customdata[4]}<br>" +
      "sync freshness: %{customdata[5]}<extra></extra>",
  };

  const gap = {
    type: "scatter",
    mode: "lines",
    name: "Expectation gap",
    x: [...xLine, ...xLine.slice().reverse()],
    y: [...yBenchmark, ...yGs.slice().reverse()],
    fill: "toself",
    fillcolor: "rgba(184, 138, 86, 0.12)",
    line: { width: 0, color: "rgba(184, 138, 86, 0)" },
    hoverinfo: "skip",
    showlegend: true,
  };

  const benchmark = {
    type: "scatter",
    mode: "lines",
    name: "Conceptual benchmark",
    x: xLine,
    y: yBenchmark,
    line: { color: "rgba(104, 115, 128, 0.36)", width: 1.2 },
    hoverinfo: "skip",
  };

  const baseline = {
    type: "scatter",
    mode: "lines",
    name: "Observed GS baseline",
    x: xLine,
    y: yGs,
    line: { color: "rgba(139, 79, 45, 0.84)", width: 2.2 },
    hoverinfo: "skip",
  };

  const layout = {
    paper_bgcolor: "#f7f4ed",
    plot_bgcolor: "#f7f4ed",
    margin: { l: 74, r: 34, t: 36, b: 72 },
    hovermode: "closest",
    dragmode: "pan",
    legend: {
      orientation: "h",
      x: 0.985,
      xanchor: "right",
      y: 0.975,
      yanchor: "top",
      bgcolor: "rgba(247,244,237,0)",
      font: { size: 10, color: "#64748b" },
      itemclick: "toggle",
      itemdoubleclick: "toggleothers",
    },
    xaxis: {
      title: { text: "Steam games owned", font: { size: 18, color: "#26313c" }, standoff: 20 },
      type: "log",
      range: xRange,
      tickmode: "array",
      tickvals: [1, 10, 100, 1000, 10000],
      ticktext: ["1", "10", "100", "1k", "10k"],
      gridcolor: "rgba(38,49,60,0.035)",
      zeroline: false,
      linecolor: "rgba(38,49,60,0.13)",
      tickfont: { color: "#475569", size: 13 },
    },
    yaxis: {
      title: { text: "Lifetime Steam hours", font: { size: 18, color: "#26313c" }, standoff: 20 },
      type: "log",
      range: yRange,
      tickmode: "array",
      tickvals: [1, 10, 100, 1000, 10000, 50000],
      ticktext: ["1", "10", "100", "1k", "10k", "50k"],
      gridcolor: "rgba(38,49,60,0.035)",
      zeroline: false,
      linecolor: "rgba(38,49,60,0.13)",
      tickfont: { color: "#475569", size: 13 },
    },
  };

  const config = {
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    toImageButtonOptions: {
      filename: "gs-steam-behavioral-structure",
      format: "png",
      width: 1800,
      height: 1100,
      scale: 2,
    },
  };

  const traces = state.benchmarkOn ? [gap, benchmark, baseline, cloud] : [baseline, cloud];
  state.renderCount += 1;
  layout.datarevision = state.renderCount;

  const plot = document.getElementById("plot");
  Plotly.purge(plot);
  Plotly.newPlot(plot, traces, layout, config);
  const fullSteamOwners = state.summary.quality.users_with_steam_ownership;
  const unplayedUsers = state.summary.quality.zero_playtime_users;
  document.getElementById("methodSource").textContent =
    `GS Steam market map | plotted positive-playtime users=${formatShort(rows.length)} | full Steam owners=${formatShort(fullSteamOwners)} | unplayed=${formatShort(unplayedUsers)} | lifetime slope=${Number(model.slope_b).toFixed(3)} | R²=${Number(model.r_squared).toFixed(3)}`;
}

async function boot() {
  const status = document.getElementById("status");
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("benchmark") === "off") {
      state.benchmarkOn = false;
      document.getElementById("benchmarkOn").checked = false;
    }
    const [summary, rows] = await Promise.all([loadSummary(), loadCsv()]);
    state.summary = summary;
    state.rows = rows;
    status.classList.add("is-hidden");
    makePlot();
  } catch (error) {
    status.textContent = `Could not load visualization data: ${error.message}`;
  }
}

document.getElementById("freshOnly").addEventListener("change", (event) => {
  state.freshOnly = event.target.checked;
  makePlot();
});

document.getElementById("benchmarkOn").addEventListener("change", (event) => {
  state.benchmarkOn = event.target.checked;
  makePlot();
});

boot();
