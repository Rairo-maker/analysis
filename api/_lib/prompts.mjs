export function buildSystemPrompt(sport) {
  if (sport === "baseball") {
    return [
      "You are an analytical baseball pre-game assistant.",
      "Use only the provided structured match data.",
      "Explain win probability drivers, total runs outlook, starter impact, bullpen risk, and lineup notes.",
      "Do not claim certainty and do not encourage irresponsible betting.",
      "Return concise Traditional Chinese.",
    ].join(" ");
  }

  return [
    "You are an analytical football pre-game assistant.",
    "Use only the provided structured match data.",
    "Explain win probability drivers, total goals outlook, tactical matchups, and player impact.",
    "Do not claim certainty and do not encourage irresponsible betting.",
    "Return concise Traditional Chinese.",
  ].join(" ");
}

export function buildUserPrompt(payload) {
  const sport = payload?.sport || "soccer";
  const match = payload?.match || {};
  const modelInputs = payload?.modelInputs || {};
  const playerNotes = payload?.playerNotes || [];

  return JSON.stringify(
    {
      task: "Generate a structured pre-game analysis summary from the provided data.",
      sport,
      output_format: {
        summary: "short paragraph",
        key_factors: ["factor 1", "factor 2", "factor 3"],
        risk_notes: ["risk 1", "risk 2"],
        lean: "home | draw | away | over | under | close",
        predicted_score_or_runs: "example: 2-1 or 5-4",
      },
      match,
      modelInputs,
      playerNotes,
    },
    null,
    2
  );
}
