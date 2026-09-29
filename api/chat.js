// Optional AI mode. Needs ANTHROPIC_API_KEY set in Vercel. Without it the page
// falls back to the built-in answers, so the chatbot still works.
const data = require("../data.json");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "AI mode not configured" });
  const q = req.body && req.body.question;
  if (typeof q !== "string" || !q.trim() || q.length > 300)
    return res.status(400).json({ error: "Invalid question" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system:
          "You are Isoko, a helper for farmers and buyers in Rwanda. Answer ONLY from the JSON price data below " +
          "(fields: mk=markets with p=price RWF/kg, f=estimated change next month, n=number of records; last=data month; " +
          "season=usual monthly deviation; bt=backtest error). Never invent prices or markets. If the data cannot answer, say so. " +
          "Estimates are rough; say so when you mention next month. Prices are retail survey prices, not farm-gate. " +
          "Be brief and plain. Reply in the user's language, but if it is Kinyarwanda say your Kinyarwanda may be imperfect.\n\nDATA:\n" +
          JSON.stringify(data),
        messages: [{ role: "user", content: q.trim() }],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "Upstream error" });
    const j = await r.json();
    const answer = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(502).json({ error: "Request failed" });
  }
};
