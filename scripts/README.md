# Data Ingestion Scripts

Python scripts for fetching and transforming data from external sources into the format expected by `src/data/*.json`.

These scripts run locally and are not called by the Next.js app. They are part of Phase 4.

## Scripts (planned)

| Script | Source | Output |
|---|---|---|
| `fetch_bcch.py` | Banco Central BDE API | `macro_indicators.json` |
| `fetch_cmf_hechos.py` | CMF API / scraper | `hechos_esenciales.json` |
| `fetch_prices.py` | Bolsa de Santiago / Brain Data | `stock_prices.json` |
| `fetch_earnings.py` | CMF FECU / manual CSV | `earnings.json` |

## Setup (Phase 4)

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

## Environment variables needed (Phase 4)

Add these to a `.env` file inside `scripts/` (not the project root `.env.local`):

```
BCCH_USER=your_bde_api_user
BCCH_PASS=your_bde_api_password
CMF_API_KEY=your_cmf_api_key
```

Do not commit credentials.
