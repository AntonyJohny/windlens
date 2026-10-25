# WindLens — UK Wind Power Forecast Analysis

**WindLens** is a web application for analysing UK wind power generation forecasts against actual generation. It helps electricity procurement teams evaluate the quality of the wind forecasts available when making day-ahead electricity purchasing decisions.

**Live application:** https://windlens-hazel.vercel.app/  
**Backend API:** https://windlens-6yeg.vercel.app/  
**API documentation:** https://windlens-6yeg.vercel.app/docs  
**GitHub repository:** https://github.com/AntonyJohny/windlens

---

## 1. Problem Statement

UK electricity utilities need to procure enough electricity to meet consumer demand. Because wind generation depends on weather conditions, the amount of electricity available from wind can differ from the forecast.

Procurement decisions for the day-ahead market must be made before the delivery day. The team therefore needs to understand:

- The wind generation forecast available at the time of the purchasing decision.
- The difference between forecast and actual wind generation.
- The historical accuracy and systematic error of the forecasts.

WindLens addresses these needs by providing a dashboard for forecast analysis and quantitative accuracy evaluation.

## 2. Features

- **Forecast vs. Actual Analysis:** Compare forecast wind generation with actual generation for each delivery period.
- **Decision-Time Analysis:** Evaluate forecasts using a selected decision hour.
- **Forecast Publication-Time Awareness:** Account for when forecasts were published so that forecasts unavailable at the decision cutoff are not used.
- **Forecast Accuracy Metrics:** Calculate MAE, RMSE, WAPE, and forecast bias for matched delivery periods.
- **Interactive Dashboard:** Explore wind generation data and forecast performance.
- **Historical Data Support:** Analyse the available January 2026 delivery periods and historical forecast versions.
- **REST API:** Access summary statistics and forecast analysis through the Python backend.

## 3. Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite, JavaScript, CSS |
| Backend | Python, FastAPI |
| Database | MongoDB |
| Containerisation | Docker, Docker Compose |
| Deployment | Vercel |
| API Documentation | FastAPI / Swagger UI |

## 4. Architecture

The application follows a frontend–backend–database architecture.

1. The **React frontend** provides the dashboard, date and decision-time selection, and visualisation of analysis results.
2. The **FastAPI backend** exposes REST endpoints, retrieves stored generation data, selects eligible forecasts, matches delivery periods, and calculates accuracy metrics.
3. **MongoDB** stores the actual generation data and forecast records used by the analysis.
4. **Docker Compose** provides a way to run the application services locally.
5. **Vercel** hosts the deployed application components.

### Architecture overview

```text
User
 |
 v
React + Vite Frontend
 |
 | HTTP / REST API
 v
Python + FastAPI Backend
 |
 | Read generation actuals
 | Read historical forecasts
 v
MongoDB
 |
 v
Matched periods and accuracy metrics
 |
 v
Dashboard results
```

## 5. Project Structure

```text
windlens/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── package.json
│   └── ... frontend configuration files
├── backend/
│   ├── app/
│   │   └── main.py
│   ├── requirements.txt
│   └── ... backend configuration files
├── docker-compose.yml
├── .gitignore
└── README.md
```

The frontend directory contains the React application. The backend directory contains the FastAPI service, API routes, data-processing logic, and metric calculations. The Docker Compose configuration coordinates the local services.

## 6. Data Sources

This assignment focuses exclusively on national-level UK wind generation actuals and forecasts from Elexon, with analysis restricted to delivery dates in January 2026.

### Actual generation

Source: [Elexon FUELHH API documentation](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream)

Relevant fields:

- `startTime`: start time of the delivery period.
- `generation`: actual generation value.
- `fuelType`: fuel category, filtered to `WIND`.

### Forecast generation

Source: [Elexon WINDFOR API documentation](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream)

Relevant fields:

- `startTime`: target delivery period.
- `publishTime`: time the forecast was published.
- `generation`: forecast wind generation value.

### Forecast selection

For a given delivery date and decision cutoff, the application should only use forecast records published by that cutoff. Where multiple eligible forecast versions exist for a delivery period, the latest eligible publication is the relevant forecast for that decision.

Forecasts are compared with actuals for matching delivery periods. Only valid matched periods should contribute to the accuracy metrics.

## 7. Forecast Accuracy Metrics

WindLens provides quantitative measures of forecast performance.

| Metric | Meaning | Interpretation |
|---|---|---|
| MAE | Mean Absolute Error | Average absolute difference between forecast and actual generation. |
| RMSE | Root Mean Squared Error | Gives larger errors greater weight. |
| WAPE | Weighted Absolute Percentage Error | Total absolute error relative to total actual generation. |
| Bias | Signed average forecast error | Indicates systematic overprediction or underprediction according to the implementation's sign convention. |

Lower MAE, RMSE, and WAPE generally indicate better forecast accuracy. Bias closer to zero indicates less systematic error.

The metrics are intended to help procurement teams understand forecast uncertainty. They are not, by themselves, a complete electricity procurement recommendation.

## 8. Running the Application Locally

### Prerequisites

Install:

- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

If running services outside Docker, you may also need [Node.js and npm](https://nodejs.org/) and [Python](https://www.python.org/).

### Step 1: Clone the repository

```bash
git clone https://github.com/AntonyJohny/windlens.git
cd windlens
```

### Step 2: Configure environment variables

Configure the environment variables required by your local deployment, including the MongoDB connection URI and database name.

The backend uses `MONGODB_URI` for its MongoDB connection and `DATABASE_NAME` for the database name. Check the Docker Compose configuration for any additional required variables.

Do not commit `.env` files, credentials, database passwords, or production secrets to GitHub.

### Step 3: Build and start the services

```bash
docker compose up --build -d
```

### Step 4: Check the services

```bash
docker compose ps
docker compose logs -f
```

### Step 5: Open the application

The default local URLs depend on the port mappings in the Docker Compose configuration. With the standard project development ports, use:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API documentation: http://localhost:8000/docs

If your Compose configuration maps different ports, use those configured values instead.

### Step 6: Stop the application

```bash
docker compose down
```

## 9. API Endpoints

The backend provides endpoints for summary information and date-based forecast analysis.

| Endpoint | Purpose |
|---|---|
| `GET /api/summary` | Returns available dataset summary information. |
| `GET /api/analysis` | Analyses forecasts and actuals for a selected delivery date and decision hour. |

Example analysis request:

```http
GET /api/analysis?delivery_date=2026-01-15&decision_hour=12
```

For the deployed API, the corresponding request is:

https://windlens-6yeg.vercel.app/api/analysis?delivery_date=2026-01-15&decision_hour=12

The exact response depends on the availability of matching records in the configured database.

Interactive API documentation is available at:

https://windlens-6yeg.vercel.app/docs

## 10. Screenshots

Screenshots of the running application can be stored in a `screenshots/` directory in the repository.

Suggested screenshots:

1. Main dashboard.
2. Forecast-versus-actual chart.
3. Forecast accuracy metrics.
4. Selected delivery date and decision cutoff.

Once screenshots have been added to the repository, they can be embedded here. For example:

```markdown
![WindLens dashboard](screenshots/dashboard.png)
```

## 11. Limitations and Future Improvements

The current assignment scope is deliberately limited to national wind generation actuals and forecasts for January 2026.

The application does not currently constitute a full procurement optimisation system. It does not include consumer demand forecasts, wholesale market prices, thermal plant constraints, or a complete calculation of the optimal volume to purchase.

Potential future improvements include:

- Comparing accuracy across multiple delivery dates and decision times.
- Adding confidence intervals and forecast-error distributions.
- Improving ingestion monitoring and data-quality checks.
- Supporting additional renewable generation sources.
- Integrating demand and market-price data for procurement scenario analysis.

---

**WindLens — Making wind power forecast performance easier to understand.**
