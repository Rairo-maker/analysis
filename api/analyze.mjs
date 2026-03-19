import { buildSystemPrompt, buildUserPrompt } from "./_lib/prompts.mjs";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "medium";

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(
      {
        error: "OPENAI_API_KEY is missing",
        hint: "Set the environment variable in Vercel Project Settings.",
      },
      { status: 500 }
    );
  }

  try {
    const payload = await readJson(request);
    const sport = String(payload?.sport || "soccer").toLowerCase();

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: OPENAI_REASONING_EFFORT },
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: buildSystemPrompt(sport) }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: buildUserPrompt(payload) }],
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const details = await upstream.text();
      return json({ error: "OpenAI request failed", details }, { status: upstream.status });
    }

    const data = await upstream.json();
    const analysis =
      data.output_text ||
      data.output
        ?.flatMap((item) => item.content || [])
        ?.filter((item) => item.type === "output_text")
        ?.map((item) => item.text)
        ?.join("\n")
        ?.trim() ||
      "";

    return json({
      ok: true,
      model: OPENAI_MODEL,
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
