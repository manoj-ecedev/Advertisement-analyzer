from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import numpy as np
import io
import os
from datetime import datetime, timedelta

app = Flask(__name__)

REQUIRED_COLS = ["date", "campaign", "impressions", "clicks", "spend", "conversions", "revenue"]
NUMERIC_COLS = ["impressions", "clicks", "spend", "conversions", "revenue"]


def normalize_columns(df):
    df.columns = [str(c).strip().lower() for c in df.columns]
    return df


def missing_columns(df):
    return [c for c in REQUIRED_COLS if c not in df.columns]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sample-csv")
def sample_csv():
    """Generate a small, realistic-looking sample dataset so people without
    their own data can still try the tool."""
    campaigns = ["Campaign A", "Campaign B", "Campaign C"]
    rng = np.random.default_rng(42)
    start = datetime.today() - timedelta(days=29)

    rows = []
    for i in range(30):
        d = start + timedelta(days=i)
        for c in campaigns:
            impressions = int(rng.integers(2000, 20000))
            clicks = int(impressions * rng.uniform(0.01, 0.08))
            spend = round(clicks * rng.uniform(5, 25), 2)
            conversions = int(clicks * rng.uniform(0.02, 0.15))
            revenue = round(conversions * rng.uniform(200, 900), 2)
            rows.append([d.strftime("%Y-%m-%d"), c, impressions, clicks, spend, conversions, revenue])

    df = pd.DataFrame(rows, columns=["Date", "Campaign", "Impressions", "Clicks", "Spend", "Conversions", "Revenue"])
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return send_file(buf, mimetype="text/csv", as_attachment=True, download_name="sample_ad_data.csv")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files or request.files["file"].filename == "":
        return jsonify({"error": "No file was uploaded."}), 400

    f = request.files["file"]
    try:
        df = pd.read_csv(f)
    except Exception as exc:
        return jsonify({"error": f"That file couldn't be read as a CSV. ({exc})"}), 400

    if df.empty:
        return jsonify({"error": "The uploaded CSV has no rows."}), 400

    df = normalize_columns(df)
    missing = missing_columns(df)
    if missing:
        return jsonify({
            "error": "Your file is missing these columns: " + ", ".join(missing) +
                     ". Expected: Date, Campaign, Impressions, Clicks, Spend, Conversions, Revenue."
        }), 400

    for col in NUMERIC_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    before = len(df)
    df = df.dropna(subset=["date"])
    dropped = before - len(df)

    if df.empty:
        return jsonify({"error": "None of the rows had a readable date."}), 400

    total_spend = float(df["spend"].sum())
    total_revenue = float(df["revenue"].sum())
    total_impressions = float(df["impressions"].sum())
    total_clicks = float(df["clicks"].sum())
    total_conversions = float(df["conversions"].sum())

    ctr = (total_clicks / total_impressions * 100) if total_impressions else 0
    cpc = (total_spend / total_clicks) if total_clicks else 0
    cpa = (total_spend / total_conversions) if total_conversions else 0
    roas = (total_revenue / total_spend) if total_spend else 0

    daily = (
        df.groupby(df["date"].dt.strftime("%Y-%m-%d"))
        .agg(spend=("spend", "sum"), revenue=("revenue", "sum"))
        .reset_index()
        .sort_values("date")
    )

    camp = (
        df.groupby("campaign")
        .agg(
            spend=("spend", "sum"),
            revenue=("revenue", "sum"),
            impressions=("impressions", "sum"),
            clicks=("clicks", "sum"),
            conversions=("conversions", "sum"),
        )
        .reset_index()
    )
    camp["ctr"] = camp.apply(lambda r: (r["clicks"] / r["impressions"] * 100) if r["impressions"] else 0, axis=1)
    camp["cpc"] = camp.apply(lambda r: (r["spend"] / r["clicks"]) if r["clicks"] else 0, axis=1)
    camp["cpa"] = camp.apply(lambda r: (r["spend"] / r["conversions"]) if r["conversions"] else 0, axis=1)
    camp["roas"] = camp.apply(lambda r: (r["revenue"] / r["spend"]) if r["spend"] else 0, axis=1)
    camp = camp.sort_values("spend", ascending=False)

    return jsonify({
        "kpis": {
            "spend": round(total_spend, 2),
            "revenue": round(total_revenue, 2),
            "impressions": int(total_impressions),
            "clicks": int(total_clicks),
            "conversions": int(total_conversions),
            "ctr": round(ctr, 2),
            "cpc": round(cpc, 2),
            "cpa": round(cpa, 2),
            "roas": round(roas, 2),
        },
        "timeseries": {
            "dates": daily["date"].tolist(),
            "spend": [round(v, 2) for v in daily["spend"].tolist()],
            "revenue": [round(v, 2) for v in daily["revenue"].tolist()],
        },
        "campaigns": [
            {
                "campaign": r["campaign"],
                "spend": round(r["spend"], 2),
                "revenue": round(r["revenue"], 2),
                "impressions": int(r["impressions"]),
                "clicks": int(r["clicks"]),
                "conversions": int(r["conversions"]),
                "ctr": round(r["ctr"], 2),
                "cpc": round(r["cpc"], 2),
                "cpa": round(r["cpa"], 2),
                "roas": round(r["roas"], 2),
            }
            for r in camp.to_dict(orient="records")
        ],
        "meta": {
            "rows_used": int(len(df)),
            "rows_dropped": int(dropped),
        },
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
