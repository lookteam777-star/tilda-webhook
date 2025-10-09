// api/tilda-webhook.js
module.exports = async (req, res) => {
  try {
    // 0) токен
    const token = (req.query && req.query.token ? String(req.query.token) : "");
    if (token !== "raskat_2025_secret") return res.status(401).send("unauthorized");

    // 1) метод
    if (req.method !== "POST") return res.status(405).send("method_not_allowed");

    // 2) парсинг тела (x-www-form-urlencoded / json)
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

    // 3) HTML + текст
    const rows = Object.entries(data).map(([k, v]) => {
      const key = String(k);
      const val = String(v ?? "").replace(/\n/g, "<br>");
      return `<tr><td style="padding:6px 10px;border:1px solid #eee;"><b>${key}</b></td><td style="padding:6px 10px;border:1px solid #eee;">${val}</td></tr>`;
    }).join("");

    const html = `
      <div style="font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial">
        <h2 style="margin:0 0 12px">Тестовое сообщение</h2>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table>
        <p style="color:#888;margin-top:12px">Tilda → Vercel → SendGrid • ${new Date().toISOString()}</p>
      </div>`;

    const text = Object.entries(data).map(([k, v]) => `${k}: ${String(v ?? "")}`).join("\n");

    // 4) адреса
    const TO = "lookteam777@gmail.com"; // тест-получатель
    const FROM = "manager@raskat.rent"; // подтверждённый отправитель
    const replyTo = (data.email || data.Email || "").toString().trim();

    // 5) отправка через SendGrid REST API (+ детальная ошибка наружу)
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: TO }],
          subject: `Тест заявки • ${new Date().toLocaleString("ru-RU")}`
        }],
        from: { email: FROM, name: "RASKAT RENTAL" },
        ...(replyTo ? { reply_to: { email: replyTo } } : {}),
        content: [
          { type: "text/plain", value: `Новая заявка\n\n${text}\n` },
          { type: "text/html",  value: html }
        ],
        tracking_settings: {
          click_tracking: { enable: false },
          open_tracking:  { enable: false }
        },
        mail_settings: {
          bypass_list_management: { enable: true }
        }
      })
    });

    const sgText = await resp.text();
    console.log("SendGrid resp:", resp.status, sgText);

    if (!resp.ok) return res.status(500).send(`sendgrid_error ${resp.status}: ${sgText}`);

    return res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook fatal error:", err);
    return res.status(500).send("internal_error");
  }
};
