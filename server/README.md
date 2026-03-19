# Gemini Proxy

This folder is for local Node usage. For Vercel deployment, use the `api/` functions:

- `api/analyze.mjs`
- `api/health.mjs`

## Start

1. Copy `.env.example` to `.env`
2. Fill `GEMINI_API_KEY`
3. Run `npm start`

Server entry:

- `server/ai-proxy.js`

## Endpoints

- `GET /api/health`
- `POST /api/analyze`

## Vercel

Set these variables in Vercel Project Settings:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`

## Request body example

```json
{
  "sport": "soccer",
  "match": {
    "homeTeam": "Arsenal",
    "awayTeam": "Chelsea",
    "kickoff": "2026-03-20T20:00:00+08:00"
  },
  "modelInputs": {
    "homeWinPct": 48,
    "drawPct": 27,
    "awayWinPct": 25,
    "expectedGoalsHome": 1.72,
    "expectedGoalsAway": 1.11
  },
  "playerNotes": [
    "Home striker scored 4 in last 5 matches",
    "Away defender suspended"
  ]
}
```

## Response shape

```json
{
  "ok": true,
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "analysis": "..."
}
```
