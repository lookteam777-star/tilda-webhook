// api/tilda-webhook.js
module.exports = async (req, res) => {
  try {
    // 1) Токен (должен совпасть с тем, что в URL)
    const token = (req.query && req.query.token ? String(req.query.token) : "");
    if (token !== "raskat_2025_secret") {
      return res.status(401).send("unauthorized");
    }

    // 2) Только POST
    if (req.method !== "POST") {
      return res.status(405).send("method_not_allowed");
    }

    // 3) Парсим тело (Tilda шлёт form-urlencoded)
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let data = {};
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

    // 4) Формируем HTML с полями формы
    const rows = Object.entries(data).map(([k, v]) => {
      const key = String(k);
      const val = String(v ?? "").replace(/\n/g, "<br>");
      return `<tr>
        <td style="padding:6px 10px;border:1px solid #eee;"><b>${key}</b></td>
        <td style="padding:6px 10px;border:1px solid #eee;">${val}</td>
      </tr>`;
    }).join("");

    const html = `
      <div style="font:14px/1.45 -apple-system, Segoe UI, Roboto, Arial;">
        <h2 style="margin:0 0 12px">Новая заявка с сайта</h2>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table>
        <p style="color:#888;margin-top:12px">Tilda → Vercel → SendGrid • ${new Date().toISOString()}</p>
      </div>`;

    const subject = `Новая заявка • ${new Date().toLocaleString("ru-RU")}`;

    // 5) Отправляем письмо через SendGrid API (без зависимостей)
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: "manager@raskat.rent" }], subject }],
        from: { email: "manager@raskat.rent", name: "RASKAT RENTAL" },
        content: [{ type: "text/html", value: html }]
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("SendGrid error:", resp.status, txt);
      return res.status(500).send("sendgrid_error");
    }

    console.log("Mail sent via SendGrid");
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook fatal error:", err);
    return res.status(500).send("internal_error");
  }
};
