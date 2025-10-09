// api/tilda-webhook.js

const FROM_EMAIL = "manager@raskat.rent";
const MANAGER_EMAIL = "manager@raskat.rent";
const TOKEN = "raskat_2025_secret";

// читаем ID из env
const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID || "";
// валидный dynamic template id: d-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const isDynTpl = /^d-[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$/.test(TEMPLATE_ID);

export default async function handler(req, res) {
  try {
    if (req.query.token !== TOKEN) return res.status(401).send("unauthorized");
    if (req.method !== "POST") return res.status(405).send("method_not_allowed");

    // парсинг x-www-form-urlencoded и json
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let data = {};
    if (ct.includes("application/x-www-form-urlencoded")) {
      const raw = await new Promise((resolve) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => resolve(b));
      });
      data = Object.fromEntries(new URLSearchParams(raw));
    } else {
      data = req.body || {};
    }

    const email = (data.email || data.Email || "").trim();
    if (!email) return res.status(400).send("no_email");

    const name = (data.name || data.Name || "Клиент").trim();
    const phone = (data.phone || "").trim();
    const message = (data.message || data.Message || "").trim();
    const submitted_at = new Date().toLocaleString("ru-RU");

    // готовим fallback-контент
    const fields = Object.entries(data).map(([k, v]) => `<tr>
      <td style="padding:6px 10px;border:1px solid #eee;background:#fafafa"><b>${k}</b></td>
      <td style="padding:6px 10px;border:1px solid #eee">${String(v ?? "").replace(/\n/g,"<br>")}</td>
    </tr>`).join("");

    const htmlFallback = `
      <div style="font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial">
        <h2 style="margin:0 0 12px">Ваша заявка принята</h2>
        <p>Имя: ${name}<br>Email: ${email}<br>Телефон: ${phone}</p>
        <p>Сообщение: ${message}</p>
        <h3 style="margin:16px 0 8px">Детали</h3>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:320px">${fields}</table>
        <p style="color:#888;margin-top:12px">RASKAT RENTAL • ${submitted_at}</p>
      </div>`;
    const textFallback =
      `Ваша заявка принята\n\n` +
      `Имя: ${name}\nEmail: ${email}\nТелефон: ${phone}\nСообщение: ${message}\n\n` +
      `RASKAT RENTAL • ${submitted_at}`;

    const subject = `Ваша заявка — RASKAT RENTAL • ${submitted_at}`;

    // общие personalization
    const personalization = {
      to: [{ email }],
      bcc: [{ email: MANAGER_EMAIL }],
      subject
    };

    // собираем payload: если ID валиден — шлём по шаблону, иначе контентом
    const payload = isDynTpl
      ? {
          personalizations: [
            { ...personalization, dynamic_template_data: { name, email, phone, message, submitted_at } }
          ],
          from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
          reply_to: { email: FROM_EMAIL },
          template_id: TEMPLATE_ID
        }
      : {
          personalizations: [personalization],
          from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
          reply_to: { email: FROM_EMAIL },
          content: [
            { type: "text/plain", value: textFallback },
            { type: "text/html",  value: htmlFallback }
          ]
        };

    // небольшая диагностика в заголовках ответа
    res.setHeader("X-Build", process.env.VERCEL_GIT_COMMIT_SHA || "no-sha");
    res.setHeader("X-Template", TEMPLATE_ID || "no-template");
    res.setHeader("X-UseTemplate", String(isDynTpl));

    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await resp.text();
    console.log("SendGrid:", resp.status, body);
    if (!resp.ok) return res.status(500).send(`sendgrid_error ${resp.status}: ${body}`);

    return res.status(200).send("ok");
  } catch (e) {
    console.error(e);
    return res.status(500).send("internal_error");
  }
}
