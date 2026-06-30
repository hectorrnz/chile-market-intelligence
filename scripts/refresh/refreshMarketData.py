#!/usr/bin/env python3
"""
scripts/refresh/refreshMarketData.py

Fetches latest prices and performance data from Yahoo Finance via yfinance and
writes updated JSON files to src/data/. Run manually or via the GitHub Actions
workflow (.github/workflows/refresh-market-data.yml).

Schedule: weekdays at 13:30 UTC (mid-morning SCL) and 21:30 UTC (post-close SCL).

Usage:
    python scripts/refresh/refreshMarketData.py

Requirements:
    pip install -r scripts/refresh/requirements.txt

Safety: if Yahoo Finance returns no data for a ticker or index, the existing
static value is preserved. A complete Yahoo outage will cause the script to
exit non-zero; the GitHub Actions step will fail and skip the git commit,
leaving the last committed static JSON intact.
"""

import json
import sys
from datetime import datetime, timezone, date
from pathlib import Path

try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    print('ERROR: run "pip install -r scripts/refresh/requirements.txt" first', file=sys.stderr)
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / 'src' / 'data'

# ── Ticker map: internal app ticker → Yahoo Finance symbol (.SN = Bolsa de Santiago)
TICKERS: dict[str, str] = {
    'BSANTANDER': 'BSANTANDER.SN',
    'CHILE':      'CHILE.SN',
    'BCI':        'BCI.SN',
    'SECURITY':   'SECURITY.SN',
    'ITAUCORP':   'ITAUCORP.SN',
    'SQM-B':      'SQM-B.SN',
    'CAP':        'CAP.SN',
    'ENELAM':     'ENELAM.SN',
    'ENELCHILE':  'ENELCHILE.SN',
    'COLBUN':     'COLBUN.SN',
    'AGUAS-A':    'AGUAS-A.SN',
    'CMPC':       'CMPC.SN',
    'COPEC':      'COPEC.SN',
    'FALABELLA':  'FALABELLA.SN',
    'CENCOSUD':   'CENCOSUD.SN',
    'RIPLEY':     'RIPLEY.SN',
    'PARAUCO':    'PARAUCO.SN',
    'MALLPLAZA':  'MALLPLAZA.SN',
    'ENTEL':      'ENTEL.SN',
    'SONDA':      'SONDA.SN',
    'ANDINA-B':   'ANDINA-B.SN',
    'CCU':        'CCU.SN',
    'CONCHATORO': 'CONCHATORO.SN',
    'LTM':        'LTM.SN',
    'VAPORES':    'VAPORES.SN',
}

# ── Sector membership — only tracked tickers ───────────────────────────────────
SECTORS: dict[str, list[str]] = {
    'Banking':             ['BSANTANDER', 'CHILE', 'BCI', 'SECURITY', 'ITAUCORP'],
    'Retail':              ['FALABELLA', 'CENCOSUD', 'RIPLEY'],
    'Utilities':           ['ENELCHILE', 'ENELAM', 'COLBUN', 'AGUAS-A'],
    'Mining / Lithium':    ['SQM-B', 'CAP'],
    'Pulp & Forestry':     ['CMPC'],
    'Industrials':         ['COPEC', 'VAPORES'],
    'Real Estate / Malls': ['PARAUCO', 'MALLPLAZA'],
    'Telecom':             ['ENTEL', 'SONDA'],
    'Consumer':            ['CCU', 'ANDINA-B', 'CONCHATORO'],
    'Transport / Airlines': ['LTM'],
}

# ── Index map: JSON id → Yahoo Finance symbol ──────────────────────────────────
INDICES: dict[str, str] = {
    'ipsa':        '^IPSA',
    'sp500':       '^GSPC',
    'ibovespa':    '^BVSP',
    'ipc-mexico':  '^MXX',
    'colcap':      '^COLCAP',
    'bvl-peru':    '^BVL',
    'eurostoxx50': '^STOXX50E',
    'ftse100':     '^FTSE',
    'nikkei225':   '^N225',
    'hangseng':    '^HSI',
    'kospi':       '^KS11',
}

SOURCE = 'yfinance / Yahoo Finance'


# ── Helpers ────────────────────────────────────────────────────────────────────

def download_ytd(symbols: list[str]) -> dict[str, 'pd.Series']:
    """
    Download YTD close prices for a list of Yahoo Finance symbols.
    Returns {symbol: close_series} with NaNs dropped.
    Handles both MultiIndex (multiple symbols) and flat (single symbol) output.
    """
    year_start = f'{date.today().year}-01-01'
    raw = yf.download(symbols, start=year_start, progress=False, auto_adjust=True)

    out: dict[str, pd.Series] = {}
    if raw.empty:
        return out

    if isinstance(raw.columns, pd.MultiIndex):
        close_df = raw['Close']
        for sym in symbols:
            if sym in close_df.columns:
                s = close_df[sym].dropna()
                if not s.empty:
                    out[sym] = s
    else:
        # Single ticker — flat columns
        if 'Close' in raw.columns and len(symbols) == 1:
            s = raw['Close'].dropna()
            if not s.empty:
                out[symbols[0]] = s

    return out


def _day_pct(s: 'pd.Series') -> float | None:
    if len(s) < 2:
        return None
    prev, last = float(s.iloc[-2]), float(s.iloc[-1])
    return round((last - prev) / prev * 100, 2) if prev else None


def _ytd_pct(s: 'pd.Series') -> float | None:
    if len(s) < 2:
        return None
    first, last = float(s.iloc[0]), float(s.iloc[-1])
    return round((last - first) / first * 100, 2) if first else None


def _last(s: 'pd.Series') -> float | None:
    return round(float(s.iloc[-1]), 2) if not s.empty else None


# ── Refresh functions ──────────────────────────────────────────────────────────

def refresh_stocks(today: str) -> tuple[int, dict[str, float], dict[str, float]]:
    """
    Fetch all tracked tickers and overwrite price/dayChangePct/ytdChangePct.
    Returns (ok_count, day_pct_by_ticker, ytd_pct_by_ticker).
    """
    print(f'[1/3] Fetching {len(TICKERS)} tickers from Yahoo Finance...', flush=True)
    closes = download_ytd(list(TICKERS.values()))

    existing = json.loads((DATA_DIR / 'stockPrices.json').read_text(encoding='utf-8'))
    updated = []
    day_map: dict[str, float] = {}
    ytd_map: dict[str, float] = {}
    ok = 0

    for entry in existing:
        internal = entry['ticker']
        yf_sym = TICKERS.get(internal)
        s = closes.get(yf_sym, pd.Series(dtype=float)) if yf_sym else pd.Series(dtype=float)

        p = _last(s)
        dp = _day_pct(s)
        yp = _ytd_pct(s)

        if p is not None:
            day_map[internal] = dp if dp is not None else 0.0
            ytd_map[internal] = yp if yp is not None else 0.0
            entry = {
                **entry,
                'price': p,
                'dayChangePct': dp if dp is not None else entry.get('dayChangePct', 0),
                'ytdChangePct': yp if yp is not None else entry.get('ytdChangePct', 0),
                'lastUpdated': today,
                'source': SOURCE,
            }
            dp_str = f'{dp:+.2f}%' if dp is not None else 'n/a'
            yp_str = f'{yp:+.2f}%' if yp is not None else 'n/a'
            print(f'  ✓ {internal}: {p}  day={dp_str}  ytd={yp_str}', flush=True)
            ok += 1
        else:
            print(f'  – {internal}: no data, keeping static value', flush=True)

        updated.append(entry)

    (DATA_DIR / 'stockPrices.json').write_text(
        json.dumps(updated, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )
    print(f'  → stockPrices.json updated ({ok}/{len(TICKERS)} live)', flush=True)
    return ok, day_map, ytd_map


def refresh_sectors(day_map: dict[str, float], ytd_map: dict[str, float], today: str) -> None:
    """Aggregate sector performance from individual stock day/ytd %s."""
    print(f'\n[2/3] Aggregating {len(SECTORS)} sectors...', flush=True)
    existing = json.loads((DATA_DIR / 'sectorPerformance.json').read_text(encoding='utf-8'))
    updated = []

    for entry in existing:
        name = entry['sector']
        members = [t for t in SECTORS.get(name, []) if t in day_map]

        if not members:
            updated.append(entry)
            print(f'  – {name}: no live data, keeping static', flush=True)
            continue

        day_avg = round(sum(day_map[t] for t in members) / len(members), 2)
        ytd_avg = round(sum(ytd_map.get(t, 0.0) for t in members) / len(members), 1)
        best   = max(members, key=lambda t: day_map[t])
        worst  = min(members, key=lambda t: day_map[t])

        updated.append({
            **entry,
            'dayChangePct':      day_avg,
            'ytdChangePct':      ytd_avg,
            'numberOfStocks':    len(members),
            'topContributor':    best,
            'topContributorPct': round(day_map[best], 2),
            'worstContributor':  worst,
            'worstContributorPct': round(day_map[worst], 2),
            'lastUpdated':       today,
        })
        print(f'  ✓ {name}: {day_avg:+.2f}% (n={len(members)})', flush=True)

    (DATA_DIR / 'sectorPerformance.json').write_text(
        json.dumps(updated, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )
    print(f'  → sectorPerformance.json updated', flush=True)


def refresh_indices(today: str) -> int:
    """Fetch index performance and update value/dayChangePct/ytdChangePct."""
    print(f'\n[3/3] Fetching {len(INDICES)} indices...', flush=True)
    closes = download_ytd(list(INDICES.values()))

    existing = json.loads((DATA_DIR / 'indexPerformance.json').read_text(encoding='utf-8'))
    updated = []
    ok = 0

    for entry in existing:
        idx_id = entry['id']
        yf_sym = INDICES.get(idx_id)
        s = closes.get(yf_sym, pd.Series(dtype=float)) if yf_sym else pd.Series(dtype=float)

        p = _last(s)
        dp = _day_pct(s)
        yp = _ytd_pct(s)

        if p is not None:
            entry = {
                **entry,
                'value':         p,
                'dayChangePct':  dp if dp is not None else entry.get('dayChangePct', 0),
                'ytdChangePct':  yp if yp is not None else entry.get('ytdChangePct', 0),
                'date':          today,
                'source':        SOURCE,
            }
            dp_str = f'{dp:+.2f}%' if dp is not None else 'n/a'
            print(f'  ✓ {idx_id} ({yf_sym}): {p}  day={dp_str}', flush=True)
            ok += 1
        else:
            print(f'  – {idx_id} ({yf_sym}): no data, keeping static', flush=True)

        updated.append(entry)

    (DATA_DIR / 'indexPerformance.json').write_text(
        json.dumps(updated, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )
    print(f'  → indexPerformance.json updated ({ok}/{len(INDICES)} live)', flush=True)
    return ok


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> None:
    print('=== refreshMarketData.py ===\n', flush=True)
    now_iso = datetime.now(timezone.utc).isoformat()
    today   = date.today().isoformat()

    ok_stocks, day_map, ytd_map = refresh_stocks(today)
    refresh_sectors(day_map, ytd_map, today)
    ok_indices = refresh_indices(today)

    meta = {
        'lastUpdated':      now_iso,
        'source':           SOURCE,
        'tickersRefreshed': ok_stocks,
        'indicesRefreshed': ok_indices,
    }
    (DATA_DIR / 'marketMeta.json').write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + '\n', encoding='utf-8'
    )

    print(f'\n=== Done ===', flush=True)
    print(f'  Stocks  : {ok_stocks}/{len(TICKERS)}', flush=True)
    print(f'  Indices : {ok_indices}/{len(INDICES)}', flush=True)
    print(f'  Updated : {now_iso}', flush=True)


if __name__ == '__main__':
    main()
