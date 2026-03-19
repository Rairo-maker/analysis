const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { buildSystemPrompt, buildUserPrompt } = require("./prompts");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".doc": "application/msword",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".xml": "application/xml; charset=utf-8",
  ".thmx": "application/octet-stream",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safePathname(urlPath) {
  const pathname = urlPath === "/" ? "/index.html" : urlPath;
  const fullPath = path.resolve(ROOT, `.${pathname}`);
  if (!fullPath.startsWith(ROOT)) return null;
  return fullPath;
}

async function serveStatic(req, res, url) {
  const filePath = safePathname(url.pathname);
  if (!filePath) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    provider: "gemini",
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
  });
}

async function handleAnalyze(req, res) {
  if (!GEMINI_API_KEY) {
    sendJson(res, 500, {
      error: "GEMINI_API_KEY is missing",
      hint: "Create a .env file or set the environment variable before starting the server.",
    });
    return;
  }

  try {
    const rawBody = await readBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const sport = String(payload?.sport || "soccer").toLowerCase();
    const requestBody = {
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      sendJson(res, response.status, {
        error: "Gemini request failed",
        details: errorText,
      });
      return;
    }

    const data = await response.json();
    const outputText =
      data.candidates?.[0]?.content?.parts
        ?.filter((content) => typeof content?.text === "string")
        ?.map((content) => content.text)
        ?.join("\n")
        ?.trim() ||
      "";

    sendJson(res, 200, {
      ok: true,
      provider: "gemini",
      model: GEMINI_MODEL,
      analysis: outputText,
      raw: data,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: "Analyze request failed",
      details: String(error?.message || error),
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    await handleHealth(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    await handleAnalyze(req, res);
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res, url);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, () => {
  console.log(`Future Sports Intel server running at http://localhost:${PORT}`);
});
