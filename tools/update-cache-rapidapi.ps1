Param(
  [string]$RapidApiKey = "",
  [string]$Host = "free-api-live-football-data.p.rapidapi.com",
  [string]$LeagueId = "47",
  [string]$OutFile = "rapidCache.json"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $RapidApiKey) { $RapidApiKey = $env:RAPIDAPI_KEY }
if (-not $RapidApiKey) { throw "Missing RapidApiKey. Pass -RapidApiKey or set env:RAPIDAPI_KEY" }

$headers = @{
  "X-RapidAPI-Key"  = $RapidApiKey
  "X-RapidAPI-Host" = $Host
}

function Invoke-Rapid([string]$Path, [hashtable]$Query = $null) {
  $uri = "https://$Host$Path"
  if ($Query) {
    $pairs = @()
    foreach ($k in $Query.Keys) {
      $pairs += ("{0}={1}" -f [Uri]::EscapeDataString([string]$k), [Uri]::EscapeDataString([string]$Query[$k]))
    }
    if ($pairs.Count -gt 0) { $uri = $uri + "?" + ($pairs -join "&") }
  }
  return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 30 -Method Get -ErrorAction Stop
}

Write-Host "Host=$Host"
Write-Host "Testing endpoints..."

$result = [ordered]@{
  provider   = "RapidAPI:Free API Live Football Data"
  host       = $Host
  leagueId   = "$LeagueId"
  fetchedAt  = (Get-Date).ToString("o")
  endpoints  = [ordered]@{}
  _note      = "This file is a raw dump for inspection. Convert it into leagueCache.js after confirming response shapes."
}

try {
  $result.endpoints.popularLeagues = Invoke-Rapid "/football-popular-leagues"
  Write-Host "OK /football-popular-leagues"
} catch {
  $result.endpoints.popularLeaguesError = $_.Exception.Message
  Write-Host "FAIL /football-popular-leagues"
}

try {
  $result.endpoints.currentLive = Invoke-Rapid "/football-current-live"
  Write-Host "OK /football-current-live"
} catch {
  $result.endpoints.currentLiveError = $_.Exception.Message
  Write-Host "FAIL /football-current-live"
}

try {
  $result.endpoints.standingsHome = Invoke-Rapid "/football-get-standing-home" @{ leagueid = "$LeagueId" }
  Write-Host "OK /football-get-standing-home?leagueid=$LeagueId"
} catch {
  $result.endpoints.standingsHomeError = $_.Exception.Message
  Write-Host "FAIL /football-get-standing-home"
}

try {
  $result.endpoints.live = Invoke-Rapid "/football-live" @{ leagueid = "$LeagueId" }
  Write-Host "OK /football-live?leagueid=$LeagueId"
} catch {
  $result.endpoints.liveError = $_.Exception.Message
  Write-Host "FAIL /football-live"
}

$json = $result | ConvertTo-Json -Depth 20
Set-Content -Path $OutFile -Value $json -Encoding UTF8
Write-Host "Wrote $OutFile"
