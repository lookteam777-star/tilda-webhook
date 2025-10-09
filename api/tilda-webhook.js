// api/tilda-webhook.js
const FROM_EMAIL = "manager@raskat.rent";           // подтверждённый отправитель в SendGrid
const MANAGER_EMAIL = "manager@raskat.rent";        // bcc менеджеру (можно отключить флагом)
const SEND_BCC_TO_MANAGER = true;
const TOKEN = "raskat_2025_secret";

// ВСТАВЬ ТОЧНЫЙ ID из SendGrid UI:
const TEMPLATE_ID = "d-2c8c04c022584a6b8eb9ad5712f7b226"; // пример: d-04f2e0f2-6a44-4b9d-bf1a-2e7b5b3c0b1a

module.exports = async (req, res) => {
  try {
    const token = (req.query?.token || "").toString();
    if (token !== TOKEN) return res.status(401).send("unauthorized");
    if (req.method !== "POST") return res.status(405).send("method_not_allowed");

    // --- Парсинг тела ---
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

    // --- Достаём email клиента ---
    const pick = (o, keys) => { for (const k of keys) { const v = o?.[k]; if (v && String(v).trim()) return String(v).trim(); } return ""; };
    const clientEmail = pick(data, ["email","Email","e-mail","mail","client_email","contact[email]"]);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
    if (!clientEmail || !emailRe.test(clientEmail)) return res.status(400).send("no_email");

    // --- Готовим данные для письма/шаблона ---
    const normalizeKey = (k) => String(k).replace(/[_-]+/g," ").replace(/\b\w/g, s => s.toUpperCase());
    const fields = {};
    for (const [k,v] of Object.entries(data)) fields[normalizeKey(k)] = String(v ?? "");

    const dyn = {
      name: pick(data, ["name","Name","Имя"]) || "",
      message: pick(data, ["message","сообщение","comment","Комментарий"]) || "",
      phone: pick(data, ["phone","Телефон"]) || "",
      email: clientEmail,
      submitted_at: new Date().toLocaleString("ru-RU"),
      fields
    };

    // --- HTML/Plain fallback (если шаблон не пройдёт валидацию) ---
    const rowsHtml = Object.entries(fields).map(([k, v]) =>
      `<tr><td style="padding:6px 10px;border:1px solid #eee;background:#fafafa"><b>${k}</b></td><td style="padding:6px 10px;border:1px solid #eee;">${v.replace(/\n/g,"<br>")}</td></tr>`
    ).join("");
    const htmlFallback = `
      <div style="font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial">
        <h2 style="margin:0 0 12px">Ваша заявка принята ✅</h2>
        <p>Спасибо! Мы свяжемся с вами в ближайшее время.</p>
        <h3 style="margin:16px 0 8px">Детали заявки</h3>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:320px">${rowsHtml}</table>
        <p style="color:#888;margin-top:12px">RASKAT RENTAL • ${dyn.submitted_at}</p>
      </div>`;
    const textFallback = [
      "Ваша заявка принята",
      "",
      ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
      "",
      `RASKAT RENTAL • ${dyn.submitted_at}`
    ].join("\n");

    // --- Проверяем вид шаблона (грубая валидация ID) ---
    const templateLooksValid = /^d-[0-9a-fA-F-]{20,}$/.test(TEMPLATE_ID); // допускаем UUID-формат с дефисами

    // --- Personalization (общая часть) ---
    const personalization = {
      to: [{ email: clientEmail }],
      // даже если в шаблоне есть Subject, подставим тему сами — это снимет ошибку "subject required"
      subject: `Ваша заявка принята — RASKAT RENTAL • ${dyn.submitted_at}`
    };
    if (SEND_BCC_TO_MANAGER && MANAGER_EMAIL) {
      personalization.bcc = [{ email: MANAGER_EMAIL }];
    }

    // --- Сборка payload: или template, или контент-фолбэк ---
    const payload = {
      personalizations: [personalization],
      from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
      reply_to: { email: FROM_EMAIL },
      tracking_settings: {
        click_tracking: { enable: false },
        open_tracking:  { enable: false }
      },
      mail_settings: {
        bypass_list_management: { enable: true }
      }
    };

    if (templateLooksValid) {
      // Используем шаблон + переменные
      payload.template_id = TEMPLATE_ID;
      payload.personalizations[0].dynamic_template_data = dyn;
      // (контента не добавляем — его даёт шаблон)
    } else {
      // Фолбэк без шаблона: обязателен хотя бы один блок content
      payload.content = [
        { type: "text/plain", value: textFallback },
        { type: "text/html",  value: htmlFallback }
      ];
    }

    // --- Отправка ---
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
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
