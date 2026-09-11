# Ad Performance Analyzer

A small Flask website that turns an ad-campaign CSV into a KPI dashboard:
CTR, CPC, CPA, ROAS, a spend-vs-revenue trend line, and a per-campaign
ROAS bar chart.

## Run it

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000** in your browser.

## CSV format

Your file needs these columns (case-insensitive):

```
Date, Campaign, Impressions, Clicks, Spend, Conversions, Revenue
```

Don't have data handy? Click **"Download a sample CSV"** on the page —
it generates 30 days of randomized data for three campaigns.

## How it's built

- `app.py` — Flask routes. `/api/analyze` reads the uploaded CSV with
  pandas, computes the KPIs, and returns JSON. `/api/sample-csv` streams
  a generated sample file.
- `templates/index.html` + `static/` — a single-page frontend. Uploading
  a file calls `/api/analyze` over `fetch()`, then Chart.js draws the
  charts — no page reload.

## Notes for your presentation

Frame it as solving a problem, not just "an app": marketing teams waste
money on campaigns they can't easily compare. This tool turns a raw
export into an instant read on which campaigns are profitable (ROAS)
and which are burning budget for little return.
