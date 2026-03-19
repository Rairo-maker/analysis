import { buildSystemPrompt, buildUserPrompt } from "./_lib/prompts.mjs";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function POST(request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(
      {
        error: "GEMINI_API_KEY is missing",
        hint: "Set the environment variable in Vercel Project Settings.",
      },
      { status: 500 }
    );
  }

  try {
    const payload = await readJson(request);
    const sport = String(payload?.sport || "soccer").toLowerCase();
    const body = {
      system_instruction: {
        parts: [{ text: buildSystemPrompt(sport) }],
      },
      contents: [
        {
          parts: [{ text: buildUserPrompt(payload) }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    };

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    }
    );

    if (!upstream.ok) {
      const details = await upstream.text();
      return json({ error: "Gemini request failed", details }, { status: upstream.status });
    }

    const data = await upstream.json();
    const analysis =
      data.candidates?.[0]?.content?.parts
        ?.filter((item) => typeof item?.text === "string")
        ?.map((item) => item.text)
        ?.join("\n")
        ?.trim() ||
      "";

    return json({
      ok: true,
      provider: "gemini",
      model: GEMINI_MODEL,
      analysis,
      raw: data,
    });
  } catch (error) {
    return json(
      {
        error: "Analyze request failed",
        details: String(error?.message || error),
      },
      { status: 500 }
    );
  }
}
