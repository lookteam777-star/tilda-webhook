// api/tilda-webhook.js
const FROM_EMAIL = "manager@raskat.rent";           // подтверждённый отправитель
const MANAGER_EMAIL = "manager@raskat.rent";        // bcc для менеджера
const SEND_BCC_TO_MANAGER = true;                   // выключить копию → false
const TOKEN = "raskat_2025_secret";                 // должен совпасть с ?token=...
const TEMPLATE_ID = "d_xxxxxxxxxxxxxxxxxxxxxxxxx";  // <-- вставь свой SendGrid Dynamic Template ID

module.exports = async (req, res) => {
  try {
    const token = (req.query?.token || "").toString();
    if (token !== TOKEN) return res.status(401).send("unauthorized");
    if (req.method !== "POST") return res.status(405).send("method_not_allowed");

    // Парсинг тела (x-www-form-urlencoded / json)
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

    // Достаём email клиента
    const pick = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v && String(v).trim()) return String(v).trim(); } return ""; };
    const clientEmail = pick(data, ["email","Email","e-mail","mail","client_email","contact[email]"]);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
    if (!clientEmail || !emailRe.test(clientEmail)) return res.status(400).send("no_email");

    // Подготовим объект для {{fields}} и “красивые” ключи
    const normalizeKey = (k) => String(k).replace(/[_-]+/g," ").replace(/\b\w/g, s => s.toUpperCase());
    const fields = {};
    for (const [k,v] of Object.entries(data)) fields[normalizeKey(k)] = String(v ?? "");

    // Данные для шаблона (доступны как {{name}}, {{message}}, {{fields}}, {{submitted_at}} и т.д.)
    const dyn = {
      name: pick(data, ["name","Name","Имя"]) || "",
      message: pick(data, ["message","сообщение","comment","Комментарий"]) || "",
      phone: pick(data, ["phone","Телефон"]) || "",
      email: clientEmail,
      submitted_at: new Date().toLocaleString("ru-RU"),
      fields // {{#each fields}} для таблицы всех полей
    };

    // Personalization
    const personalization = {
      to: [{ email: clientEmail }],
      dynamic_template_data: dyn
    };
    if (SEND_BCC_TO_MANAGER && MANAGER_EMAIL) {
      personalization.bcc = [{ email: MANAGER_EMAIL }];
    }

    // Отправка по шаблону
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [personalization],
        from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
        reply_to: { email: FROM_EMAIL },
        template_id: TEMPLATE_ID,
        // Можно отключить трекинг для «натуральности»
        tracking_settings: {
          click_tracking: { enable: false },
          open_tracking:  { enable: false }
        },
        mail_settings: {
          bypass_list_management: { enable: true } // транзакционное письмо
        }
      })
    });

    const text = await resp.text();
    console.log("SendGrid resp:", resp.status, text);
    if (!resp.ok) return res.status(500).send(`sendgrid_error ${resp.status}: ${text}`);

    return res.status(200).send("ok");
  } catch (e) {
    console.error("Webhook fatal error:", e);
    return res.status(500).send("internal_error");
  }
};
