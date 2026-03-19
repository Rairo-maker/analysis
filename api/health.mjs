const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      provider: "gemini",
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      model: GEMINI_MODEL,
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
}
