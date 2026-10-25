# 🌬️ WindLens — Wind Power Forecast Analysis

**WindLens** is a wind power forecast analysis platform designed to compare predicted wind generation with actual generation and evaluate forecast accuracy using key performance metrics.

The project helps users understand how closely wind power forecasts match real-world generation and analyze forecast errors for a selected delivery date and decision time.

## ✨ Features

- **Forecast vs. Actual Comparison** — Compare predicted wind generation with actual wind generation.
- **Forecast Accuracy Metrics** — Calculate Mean Absolute Error (MAE), Root Mean Squared Error (RMSE), Weighted Absolute Percentage Error (WAPE), and forecast bias.
- **Date-Based Analysis** — Analyze forecast performance for a selected delivery date.
- **Decision-Time Selection** — Evaluate forecasts based on the selected decision hour.
- **Interactive Dashboard** — Explore forecast performance through a web-based interface.
- **REST API** — Retrieve summary statistics and forecast analysis from the backend.
- **Historical Forecast Analysis** — Support analysis of forecast versions published at different times, provided the corresponding data is available.

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Python, FastAPI |
| Database | MongoDB |
| Infrastructure | Docker, Docker Compose |
| API Testing | FastAPI Swagger UI |

## 🏗️ Project Structure

```text
windlens/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   └── styles.css
│   ├── package.json
│   └── ...
├── backend/
│   ├── app/
│   │   └── main.py
│   └── requirements.txt
├── docker-compose.yml
├── .gitignore
└── README.md
```

*The structure above is illustrative. Adjust it to match the files in your repository.*

## ⚙️ Prerequisites

Install the following before running WindLens:

- [Git](https://git-scm.com/)
- [Node.js and npm](https://nodejs.org/)
- [Python](https://www.python.org/) (if running the backend outside Docker)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (if using Docker Compose)

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/windlens.git
cd windlens
```

Replace `YOUR_USERNAME` with your GitHub username.

### 2. Configure environment variables

If your project uses environment variables, create a local `.env` file based on your configuration or an `.env.example` template.

Do not commit credentials, passwords, or API keys.

### 3. Start the application with Docker

If your `docker-compose.yml` defines the frontend, backend, and MongoDB services, run:

```bash
docker compose up --build -d
```

Check the running containers:

```bash
docker compose ps
```

View application logs:

```bash
docker compose logs -f
```

Stop the services:

```bash
docker compose down
```

### 4. Access the application

When running with the default development ports:

| Service | URL |
|---|---|
| Frontend dashboard | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API documentation | http://localhost:8000/docs |

These URLs assume the services are configured to use those ports.

## 📊 Forecast Accuracy Metrics

WindLens uses forecast evaluation metrics to measure differences between forecast and actual generation.

| Metric | Description |
|---|---|
| **MAE** | Mean Absolute Error — average absolute difference between forecast and actual generation. |
| **RMSE** | Root Mean Squared Error — penalizes larger forecast errors more heavily. |
| **WAPE** | Weighted Absolute Percentage Error — expresses total absolute error relative to total actual generation. |
| **Bias** | Measures systematic overprediction or underprediction, depending on the sign convention used by the implementation. |

Lower MAE, RMSE, and WAPE generally indicate better forecast accuracy. Bias closer to zero generally indicates less systematic forecast error.

## 🔌 API Endpoints

The backend provides endpoints for retrieving summary information and evaluating forecasts.

| Endpoint | Purpose |
|---|---|
| `GET /api/summary` | Retrieve summary information for the available dataset. |
| `GET /api/analysis` | Analyze forecast performance for a selected delivery date and decision hour. |

Example request:

```http
GET http://localhost:8000/api/analysis?delivery_date=2026-01-15&decision_hour=12
```

Open the interactive API documentation at [http://localhost:8000/docs](http://localhost:8000/docs) to explore available endpoints and their parameters.

## 🗂️ Data

WindLens relies on wind generation actuals and forecast data to evaluate prediction performance.

The analysis depends on having matching delivery periods and the appropriate forecast version for the selected decision time. The exact input file formats, data sources, and import process depend on the dataset configuration used by the project.

Ensure that your dataset is available and loaded before running an analysis.

## 🔮 Future Improvements

- Add interactive forecast-versus-actual charts.
- Compare forecast accuracy across multiple delivery dates.
- Analyze forecast errors by decision time and forecast publication time.
- Add historical performance summaries and trend visualizations.
- Improve data ingestion and validation.
- Deploy the application to a cloud platform.

## 🤝 Contributing

Contributions and suggestions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Push the branch to GitHub.
5. Open a pull request.

## 📄 License

Choose a license before distributing the project. If you want others to use, modify, and distribute your code, consider adding an [MIT License](https://opensource.org/license/mit).

---

**WindLens** — Making wind power forecast performance easier to understand.
