// api/tilda-webhook.js
module.exports = async (req, res) => {
  try {
    // 1) Токен
    const token = (req.query && req.query.token ? String(req.query.token) : "");
    if (token !== "raskat_2025_secret") {
      return res.status(401).send("unauthorized");
    }

    // 2) Только POST
    if (req.method !== "POST") {
      return res.status(405).send("method_not_allowed");
    }

    // 3) Парсинг тела (JSON и x-www-form-urlencoded)
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let data = {};
    try {
      if (ct.includes("application/json")) {
        data = req.body || {};
      } else {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString("utf8");
        if (ct.includes("application/x-www-form-urlencoded")) {
          data = Object.fromEntries(new URLSearchParams(raw));
        } else {
          try { data = JSON.parse(raw); } catch { data = { _raw: raw }; }
        }
      }
    } catch (e) {
      console.error("Body parse error:", e);
      data = {};
    }

    console.log("Webhook OK. Data:", data);
    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook fatal error:", err);
    // временно не валим заявку, чтобы Tilda видела 200
    return res.status(200).json({ status: "ok" });
  }
};
