import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  Database,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Table2,
  Wind,
  X,
  Zap,
} from "lucide-react";

const API_URL = (
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

const DEFAULT_DATE = "2026-01-15";
const DEFAULT_HOUR = 12;

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number.toLocaleString("en-GB", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getErrorMessage(error) {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        typeof item === "string"
          ? item
          : item?.msg || JSON.stringify(item)
      )
      .join("; ");
  }

  if (detail && typeof detail === "object") {
    return detail.msg || JSON.stringify(detail);
  }

  if (error?.response?.data?.message) {
    return String(error.response.data.message);
  }

  return error?.message || "An unexpected error occurred.";
}

function MetricCard({ label, value, unit, icon: Icon, description }) {
  return (
    <article className="stat">
      <div className="metric">
        <div>
          <p className="stat-label">{label}</p>
          <h2 className="stat-value">{value}</h2>
          {unit && <span className="stat-unit">{unit}</span>}
        </div>

        <div className="stat-icon">
          <Icon size={21} />
        </div>
      </div>

      {description && (
        <p className="stat-description">{description}</p>
      )}
    </article>
  );
}

const NAV_ITEMS = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    target: "forecast-analytics",
  },
  {
    id: "analytics",
    label: "Forecast analytics",
    icon: Activity,
    target: "analysis-settings",
  },
  {
    id: "performance",
    label: "Performance metrics",
    icon: BarChart3,
    target: "performance-metrics",
  },
  {
    id: "chart",
    label: "Generation chart",
    icon: Wind,
    target: "generation-chart",
  },
  {
    id: "periods",
    label: "Delivery periods",
    icon: Table2,
    target: "delivery-periods",
  },
  {
    id: "pipeline",
    label: "Data pipeline",
    icon: Database,
    target: "data-pipeline",
  },
];

function App() {
  const [deliveryDate, setDeliveryDate] = useState(DEFAULT_DATE);
  const [decisionHour, setDecisionHour] = useState(DEFAULT_HOUR);

  const [analysis, setAnalysis] = useState(null);
  const [summary, setSummary] = useState(null);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");

  const navigateTo = (item) => {
    setActiveSection(item.id);
    setMobileMenuOpen(false);

    document
      .getElementById(item.target)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const elements = NAV_ITEMS
      .map((item) => document.getElementById(item.target))
      .filter(Boolean);

    if (!("IntersectionObserver" in window) || !elements.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => b.intersectionRatio - a.intersectionRatio
          )[0];

        if (visible) {
          const match = NAV_ITEMS.find(
            (item) => item.target === visible.target.id
          );

          if (match) setActiveSection(match.id);
        }
      },
      {
        rootMargin: "-18% 0px -62% 0px",
        threshold: [0, 0.15, 0.4],
      }
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    if (!deliveryDate) {
      setAnalysis(null);
      setError("Select a delivery date to load the analysis.");
      return;
    }

    setLoading(true);
    setError("");
    setSyncMessage("");

    try {
      const response = await axios.get(
        `${API_URL}/api/analysis`,
        {
          params: {
            delivery_date: deliveryDate,
            decision_hour: decisionHour,
          },
        }
      );

      setAnalysis(response.data);
    } catch (requestError) {
      setAnalysis(null);
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [deliveryDate, decisionHour]);

  const loadSummary = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/api/summary`);
      setSummary(response.data);
    } catch (requestError) {
      console.error(
        "Could not load summary:",
        getErrorMessage(requestError)
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleSync = async () => {
    setSyncing(true);
    setError("");
    setSyncMessage("");

    try {
      const response = await axios.post(
        `${API_URL}/api/sync/january-2026`
      );

      const result = response.data;

      setSyncMessage(
        result?.message ||
          result?.detail ||
          `Sync completed: ${JSON.stringify(result)}`
      );

      await Promise.all([load(), loadSummary()]);
    } catch (requestError) {
      setError(`Sync failed: ${getErrorMessage(requestError)}`);
    } finally {
      setSyncing(false);
    }
  };

  const points = Array.isArray(analysis?.points)
    ? analysis.points
    : [];

  const totalPeriods = analysis?.total_periods ?? points.length;

  const matchedPeriods =
    analysis?.matched_periods ??
    points.filter(
      (point) =>
        numericValue(point.actual) !== null &&
        numericValue(point.forecast) !== null
    ).length;

  // Normalize API values so Recharts receives numbers, not numeric strings.
  const chartData = points.map((point) => ({
    ...point,
    time: formatTime(point.startTime),
    actual: numericValue(point.actual),
    forecast: numericValue(point.forecast),
    error: numericValue(point.error),
  }));

  const actualsCount = summary?.actual_records ?? null;
  const forecastsCount = summary?.forecast_records ?? null;

  const forecastPoints = chartData.filter(
    (point) => point.forecast !== null
  ).length;

  return (
    <div className="app">
      <div
        className={`mobile-overlay ${
          mobileMenuOpen ? "visible" : ""
        }`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`sidebar ${
          mobileMenuOpen ? "sidebar-open" : ""
        }`}
        aria-label="Main navigation"
      >
        <div className="brand">
          <div className="brand-icon">
            <Wind size={24} />
          </div>

          <div className="brand-copy">
            <h2>WindLens</h2>
            <p>Renewable intelligence</p>
          </div>

          <button
            className="mobile-close"
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <nav
          className="sidebar-section"
          aria-label="Workspace navigation"
        >
          <p className="sidebar-label">WORKSPACE</p>

          {NAV_ITEMS.filter(
            (item) => item.id !== "pipeline"
          ).map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                className={`sidebar-link ${
                  activeSection === item.id ? "active" : ""
                }`}
                onClick={() => navigateTo(item)}
                type="button"
                aria-current={
                  activeSection === item.id ? "page" : undefined
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
                <span className="nav-chevron">›</span>
              </button>
            );
          })}

          <p className="sidebar-label sidebar-label-secondary">
            DATA &amp; OPERATIONS
          </p>

          {NAV_ITEMS.filter(
            (item) => item.id === "pipeline"
          ).map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                className={`sidebar-link ${
                  activeSection === item.id ? "active" : ""
                }`}
                onClick={() => navigateTo(item)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
                <span className="nav-chevron">›</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-icon">
            <Wind size={17} />
          </div>
          <p>Clean energy, clearer decisions.</p>
          <span>
            Explore forecast performance across the day.
          </span>
        </div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>Wind generation workspace</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar" id="forecast-analytics">
          <button
            className="mobile-menu-button"
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={21} />
          </button>

          <div className="topbar-copy">
            <p className="eyebrow">UK RENEWABLE ENERGY</p>
            <h1>Wind generation forecast</h1>
            <p className="subtitle">
              Day-ahead forecasting performance and decision support
            </p>
          </div>

          <button
            id="data-pipeline"
            className="sync-button"
            onClick={handleSync}
            disabled={syncing}
            type="button"
          >
            <RefreshCw
              size={16}
              className={syncing ? "spin" : ""}
            />
            {syncing ? "Syncing data..." : "Sync January 2026"}
          </button>
        </header>

        <section className="filters panel" id="analysis-settings">
          <div className="filter-heading">
            <div className="filter-icon">
              <Clock size={18} />
            </div>

            <div>
              <h3>Analysis settings</h3>
              <p>Choose a delivery date and decision cutoff.</p>
            </div>
          </div>

          <div className="filter-controls">
            <label className="filter-field">
              <span>Delivery date</span>
              <input
                type="date"
                value={deliveryDate}
                min="2026-01-01"
                max="2026-01-31"
                onChange={(event) =>
                  setDeliveryDate(event.target.value)
                }
              />
            </label>

            <label className="filter-field">
              <span>Decision cutoff (UK time)</span>
              <select
                value={decisionHour}
                onChange={(event) =>
                  setDecisionHour(Number(event.target.value))
                }
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>

            <button
              className="refresh-button"
              type="button"
              onClick={load}
              disabled={loading || !deliveryDate}
            >
              <RefreshCw
                size={15}
                className={loading ? "spin" : ""}
              />
              {loading ? "Loading..." : "Refresh analysis"}
            </button>
          </div>
        </section>

        {error && (
          <div className="alert" role="alert">
            <AlertCircle size={19} />
            <div>
              <strong>Something needs attention</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="dismiss-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {syncMessage && (
          <div className="success" role="status">
            <CheckCircle2 size={19} />
            <div>
              <strong>Sync response</strong>
              <p>{syncMessage}</p>
            </div>
            <button
              type="button"
              className="dismiss-button"
              onClick={() => setSyncMessage("")}
              aria-label="Dismiss sync message"
            >
              ×
            </button>
          </div>
        )}

        <section
          className="stats"
          id="performance-metrics"
          aria-label="Forecast performance metrics"
        >
          <MetricCard
            label="Mean absolute error"
            value={formatNumber(analysis?.mae_mw)}
            unit="MW"
            icon={Activity}
            description="Average absolute forecast error"
          />

          <MetricCard
            label="Root mean squared error"
            value={formatNumber(analysis?.rmse_mw)}
            unit="MW"
            icon={Zap}
            description="Penalises larger forecast errors"
          />

          <MetricCard
            label="Weighted absolute percentage error"
            value={formatNumber(analysis?.wape_percent)}
            unit="%"
            icon={Wind}
            description="Error relative to actual generation"
          />

          <MetricCard
            label="Matched periods"
            value={`${matchedPeriods} / ${totalPeriods}`}
            icon={CheckCircle2}
            description="Periods with actual and forecast data"
          />
        </section>

        <section className="panels" id="generation-chart">
          <div className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <h3>Actual vs forecast generation</h3>
                <p>
                  {analysis?.delivery_date || deliveryDate}
                  {" · "}
                  Decision cutoff{" "}
                  {String(decisionHour).padStart(2, "0")}:00 UK time
                </p>
              </div>

              <span className="chart-unit">Generation (MW)</span>
            </div>

            {loading ? (
              <div className="empty-state">
                <RefreshCw size={25} className="spin" />
                <p>Loading forecast analysis...</p>
              </div>
            ) : chartData.length > 0 ? (
              <>
                
                <div className="chart">
                  <ResponsiveContainer width="100%" height={380}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 10, right: 20, left: 5, bottom: 20 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#263548"
                      />

                      <XAxis
                        dataKey="time"
                        stroke="#91a2b7"
                        tick={{ fontSize: 11 }}
                        minTickGap={25}
                      />

                      <YAxis
                        stroke="#91a2b7"
                        tick={{ fontSize: 11 }}
                        width={65}
                        domain={[0, "auto"]}
                        tickFormatter={(value) =>
                          Number(value).toLocaleString("en-GB")
                        }
                      />

                      <Tooltip
                        contentStyle={{
                          background: "#111d2b",
                          border: "1px solid #2b3b50",
                          borderRadius: 10,
                          color: "#f3f7fb",
                        }}
                        labelStyle={{ color: "#a8b8ca" }}
                        formatter={(value, name) => [
                          value == null ? "No data" : `${formatNumber(value)} MW`,
                          name,
                        ]}
                      />

                      <Legend
                        verticalAlign="bottom"
                        align="center"
                        height={40}
                        wrapperStyle={{ paddingTop: "12px" }}
                      />

                      <Line
                        type="linear"
                        dataKey="actual"
                        name="Actual"
                        stroke="#27c6a0"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />

                      <Line
                        type="linear"
                        dataKey="forecast"
                        name="Forecast"
                        stroke="#72a7ff"
                        strokeWidth={3}
                        strokeDasharray="7 4"
                        dot={{ r: 3, fill: "#72a7ff", strokeWidth: 0 }}
                        activeDot={{ r: 6 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>


                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "24px",
                    alignItems: "center",
                    padding: "0 12px 12px",
                    color: "#91a2b7",
                    fontSize: "13px",
                  }}
                >
                  <span>
                    Actual periods:{" "}
                    {chartData.filter((p) => p.actual !== null).length}
                  </span>
                  <span>
                    Forecast periods: {forecastPoints}
                  </span>
                </div>

                {forecastPoints === 0 && (
                  <div className="alert" role="alert">
                    <AlertCircle size={19} />
                    <div>
                      <strong>Forecast values are unavailable</strong>
                      <p>
                        The API returned analysis points, but none
                        contains a numeric forecast value for the
                        selected date and cutoff.
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <Database size={30} />
                <h4>No analysis records available</h4>
                <p>
                  There are no matching records for this date and
                  decision cutoff. Check the backend response.
                </p>
              </div>
            )}
          </div>

          <div className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h3>Forecast error summary</h3>
                <p>Forecast minus actual generation</p>
              </div>
            </div>

            <div className="detail-metric">
              <span>Mean bias</span>
              <strong>{formatNumber(analysis?.bias_mw)} MW</strong>
              <p>
                The sign indicates whether forecasts tend to be
                above or below actual generation, based on the
                backend's error convention.
              </p>
            </div>

            <div className="detail-divider" />

            <div className="detail-metric">
              <span>Decision cutoff</span>
              <strong>
                {analysis?.decision_cutoff_uk ||
                  `${String(decisionHour).padStart(2, "0")}:00 UK`}
              </strong>
              <p>
                Eligible forecasts should have been published by
                the selected decision cutoff.
              </p>
            </div>

            <div className="detail-divider" />

            <div className="detail-metric">
              <span>Data availability</span>
              <strong>
                {matchedPeriods > 0
                  ? "Matched data"
                  : "No matched data"}
              </strong>
              <p>
                Actual and forecast values must refer to the same
                delivery periods for a fair comparison.
              </p>
            </div>
          </div>
        </section>

        <section className="panel table-panel" id="delivery-periods">
          <div className="panel-heading">
            <div>
              <h3>Delivery-period breakdown</h3>
              <p>
                {points.length} records returned for{" "}
                {analysis?.delivery_date || deliveryDate}
              </p>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Delivery time</th>
                  <th>Actual (MW)</th>
                  <th>Forecast (MW)</th>
                  <th>Error (MW)</th>
                  <th>Forecast published</th>
                </tr>
              </thead>

              <tbody>
                {points.length > 0 ? (
                  points.map((point, index) => (
                    <tr
                      key={`${point.startTime || "period"}-${index}`}
                    >
                      <td>{formatTime(point.startTime)}</td>
                      <td>{formatNumber(point.actual)}</td>
                      <td>{formatNumber(point.forecast)}</td>
                      <td
                        className={
                          point.error == null
                            ? ""
                            : Number(point.error) > 0
                              ? "positive-error"
                              : Number(point.error) < 0
                                ? "negative-error"
                                : ""
                        }
                      >
                        {formatNumber(point.error)}
                      </td>
                      <td>{formatTime(point.publishTime)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      {loading
                        ? "Loading records..."
                        : "No records found for this selection."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="footer">
          <span>WindLens · Forecast analytics</span>
          <span>
            {actualsCount !== null || forecastsCount !== null
              ? `Stored records — Actuals: ${
                  actualsCount ?? "—"
                } · Forecasts: ${forecastsCount ?? "—"}`
              : "UK wind generation · January 2026"}
          </span>
        </footer>
      </main>
    </div>
  );
}

export default App;
