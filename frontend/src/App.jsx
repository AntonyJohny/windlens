
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  Menu,
  X,
  RefreshCw,
  Wind,
  Zap,
} from "lucide-react";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:8000"
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

function getErrorMessage(error) {
  const detail = error?.response?.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        return item?.msg || JSON.stringify(item);
      })
      .join("; ");
  }

  if (detail && typeof detail === "object") {
    return detail.msg || JSON.stringify(detail);
  }

  if (error?.response?.data?.message) {
    return String(error.response.data.message);
  }

  if (error?.message) {
    return error.message;
  }

  return "An unexpected error occurred. Please try again.";
}

function MetricCard({ label, value, unit, icon: Icon, description }) {
  return (
    <div className="stat">
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
    </div>
  );
}

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
  const [activeSection, setActiveSection] = useState("analytics");

  const navigateTo = (section) => {
    setActiveSection(section);
    setMobileMenuOpen(false);
    document.getElementById(section === "pipeline" ? "data-pipeline" : "forecast-analytics")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const load = useCallback(async () => {
    // Never call the API with delivery_date="".
    if (!deliveryDate) {
      setAnalysis(null);
      setError("Select a delivery date to load the analysis.");
      return;
    }

    setLoading(true);
    setError("");
    setSyncMessage("");

    try {
      const response = await axios.get(`${API_URL}/api/analysis`, {
        params: {
          delivery_date: deliveryDate,
          decision_hour: decisionHour,
        },
      });

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
      // Keep the dashboard usable if the summary endpoint fails.
      console.error("Could not load summary:", getErrorMessage(requestError));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleDateChange = (event) => {
    // A date input returns either YYYY-MM-DD or an empty string.
    setDeliveryDate(event.target.value);
  };

  const handleHourChange = (event) => {
    const value = Number(event.target.value);

    if (Number.isInteger(value) && value >= 0 && value <= 23) {
      setDecisionHour(value);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError("");
    setSyncMessage("");

    try {
      const response = await axios.post(
        `${API_URL}/api/sync/january-2026`
      );

      const result = response.data;

      // Show the actual backend result instead of assuming records were imported.
      setSyncMessage(
        result?.message ||
          result?.detail ||
          `Sync request completed. Backend response: ${JSON.stringify(result)}`
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

  const totalPeriods =
    analysis?.total_periods ?? points.length;

  const matchedPeriods =
    analysis?.matched_periods ??
    points.filter(
      (point) =>
        point?.actual !== null &&
        point?.actual !== undefined &&
        point?.forecast !== null &&
        point?.forecast !== undefined
    ).length;

  const chartData = points.map((point) => ({
    ...point,
    time: formatTime(point.startTime),
    actual: point.actual ?? null,
    forecast: point.forecast ?? null,
    error: point.error ?? null,
  }));
  const actualsCount = summary?.actual_records ?? null;
  const forecastsCount = summary?.forecast_records ?? null;
  return (
    <div className="app">
      <div className={`mobile-overlay ${mobileMenuOpen ? "visible" : ""}`} onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon"><Wind size={24} /></div>
          <div className="brand-copy">
            <h2>WindLens</h2>
            <p>Renewable intelligence</p>
          </div>
          <button className="mobile-close" type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">WORKSPACE</p>
          <button className={`sidebar-link ${activeSection === "analytics" ? "active" : ""}`} onClick={() => navigateTo("analytics")} type="button">
            <Activity size={18} /><span>Forecast analytics</span><span className="nav-chevron">›</span>
          </button>
          <button className={`sidebar-link ${activeSection === "pipeline" ? "active" : ""}`} onClick={() => navigateTo("pipeline")} type="button">
            <Database size={18} /><span>Data pipeline</span><span className="nav-chevron">›</span>
          </button>
        </div>

        <div className="sidebar-card">
          <div className="sidebar-card-icon"><Wind size={17} /></div>
          <p>Clean energy, clearer decisions.</p>
          <span>Explore forecast performance across the day.</span>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>Wind generation workspace</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar" id="forecast-analytics">
          <button className="mobile-menu-button" type="button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation">
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

        <section className="filters panel">
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
                onChange={handleDateChange}
              />
            </label>

            <label className="filter-field">
              <span>Decision cutoff (UK time)</span>
              <select
                value={decisionHour}
                onChange={handleHourChange}
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

        <section className="stats">
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
            description="Periods with both actual and forecast data"
          />
        </section>

        <section className="panels">
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
              <div className="chart">
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 20,
                      left: 0,
                      bottom: 5,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id="actualGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#27c6a0"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="95%"
                          stopColor="#27c6a0"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>

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

                    <Legend />

                    <Area
                      type="monotone"
                      dataKey="actual"
                      name="Actual"
                      stroke="#27c6a0"
                      fill="url(#actualGradient)"
                      strokeWidth={2}
                      connectNulls={false}
                    />

                    <Line
                      type="monotone"
                      dataKey="forecast"
                      name="Forecast available at cutoff"
                      stroke="#72a7ff"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state">
                <Database size={30} />
                <h4>No analysis records available</h4>
                <p>
                  There are no matching records for this date and
                  decision cutoff. Check the data sync and backend
                  response.
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
              <strong>
                {formatNumber(analysis?.bias_mw)} MW
              </strong>
              <p>
                Positive bias means forecasts tend to be higher than
                actual generation, if bias is calculated as forecast
                minus actual.
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
                Only forecasts published by the decision cutoff should
                be used for a fair day-ahead assessment.
              </p>
            </div>

            <div className="detail-divider" />

            <div className="detail-metric">
              <span>Data availability</span>
              <strong>
                {matchedPeriods > 0 ? "Matched data" : "No matched data"}
              </strong>
              <p>
                Actuals and eligible forecasts must share delivery
                periods before forecast error metrics can be calculated.
              </p>
            </div>
          </div>
        </section>

        <section className="panel table-panel">
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
                        : "No records found. Run the data sync and check the backend import results."}
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
              ? `Stored records — Actuals: ${actualsCount ?? "—"} · Forecasts: ${forecastsCount ?? "—"}`
              : "UK wind generation · January 2026"}
          </span>
        </footer>
      </main>
    </div>
  );
}

export default App;
