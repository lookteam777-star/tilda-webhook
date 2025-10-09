// api/tilda-webhook.js
const FROM_EMAIL = "manager@raskat.rent";
const MANAGER_EMAIL = "manager@raskat.rent";
const TOKEN = "raskat_2025_secret";
const TEMPLATE_ID = "d-2c8c04c022584a6b8eb9ad5712f7b226"; // твой правильный ID

export default async function handler(req, res) {
  try {
    if (req.query.token !== TOKEN) return res.status(401).send("unauthorized");
    if (req.method !== "POST") return res.status(405).send("method_not_allowed");

    // Парсим тело
    const contentType = (req.headers["content-type"] || "").toLowerCase();
    let data = {};
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const raw = await new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => resolve(body));
      });
      data = Object.fromEntries(new URLSearchParams(raw));
    } else {
      data = req.body || {};
    }

    // Определяем email клиента
    const clientEmail = data.email || data.Email || "";
    if (!clientEmail) return res.status(400).send("missing email");

    // Формируем данные для шаблона
    const dynamicData = {
      name: data.name || "Клиент",
      email: clientEmail,
      phone: data.phone || "",
      message: data.message || "",
      submitted_at: new Date().toLocaleString("ru-RU"),
    };

    // Отправляем через SendGrid API
    const sendgridResp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: clientEmail }],
            bcc: [{ email: MANAGER_EMAIL }],
            dynamic_template_data: dynamicData,
            subject: "Ваша заявка — RASKAT RENTAL",
          },
        ],
        from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
        reply_to: { email: FROM_EMAIL },
        template_id: TEMPLATE_ID,
      }),
    });

    const text = await sendgridResp.text();
    console.log("SendGrid:", sendgridResp.status, text);
    if (!sendgridResp.ok) {
      return res.status(500).send(`sendgrid_error ${sendgridResp.status}: ${text}`);
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error(err);
    res.status(500).send("internal_error");
  }
}
