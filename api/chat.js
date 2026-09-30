// Optional AI mode. Set GEMINI_API_KEY (Google) or ANTHROPIC_API_KEY on Vercel.
// If both are set, Gemini is used. With neither, the page falls back to its
// built-in answers, so the chatbot still works.
const data = require("../data.json");

const SYSTEM =
  "You are Isoko, a helper for farmers and buyers in Rwanda. Answer ONLY from the JSON price data below " +
  "(fields: mk=markets with d=district, m=market, p=price RWF/kg, f=estimated change next month, n=number of records; " +
  "last=data month; season=usual monthly deviation from the yearly average, January first; bt=backtest error). " +
  "Never invent prices or markets. If the data cannot answer, say so. Estimates are rough; say so when you mention next month. " +
  "Prices are retail survey prices, not farm-gate. Be brief and plain. Reply in the user's language, " +
  "but if it is Kinyarwanda say your Kinyarwanda may be imperfect.\n\nDATA:\n" +
  JSON.stringify(data);

async function gemini(q, key) {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest"; // alias that follows Google's current Flash model
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: q }] }],
        generationConfig: { maxOutputTokens: 1500 },
      }),
    }
  );
  if (!r.ok) { console.error("Gemini error", r.status, (await r.text()).slice(0, 300)); return null; }
  const j = await r.json();
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || "").join("\n").trim() || null;
}

async function claude(q, key) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: q }],
    }),
  });
  if (!r.ok) { console.error("Claude error", r.status, (await r.text()).slice(0, 300)); return null; }
  const j = await r.json();
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const gKey = process.env.GEMINI_API_KEY || process.env.Gemini_API, aKey = process.env.ANTHROPIC_API_KEY;
  if (!gKey && !aKey) return res.status(503).json({ error: "AI mode not configured" });
  const q = req.body && req.body.question;
  if (typeof q !== "string" || !q.trim() || q.length > 300)
    return res.status(400).json({ error: "Invalid question" });
  try {
    const answer = gKey ? await gemini(q.trim(), gKey) : await claude(q.trim(), aKey);
    if (!answer) return res.status(502).json({ error: "Upstream error" });
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(502).json({ error: "Request failed" });
  }
};
