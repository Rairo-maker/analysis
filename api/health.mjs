const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";

export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      model: OPENAI_MODEL,
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
}
