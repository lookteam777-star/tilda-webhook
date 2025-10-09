// api/tilda-webhook.js  (CommonJS, Vercel Serverless)

// ——— настройки ———
const TOKEN = "raskat_2025_secret";            // должен совпасть с ?token=...
const FROM_EMAIL = "manager@raskat.rent";      // подтверждённый sender в SendGrid
const MANAGER_EMAIL = "manager@raskat.rent";   // BCC менеджеру (можно убрать/заменить)

// ——— ENV ———
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || "";
const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID || "";

/** Валидный dynamic template id: допускаем d-<uuid> И d-<32hex> */
const isDynTpl = TEMPLATE_ID && /^d-([0-9a-fA-F]{32}|[0-9a-fA-F-]{36})$/.test(TEMPLATE_ID);

module.exports = async (req, res) => {
  try {
    // 0) защита токеном и метод
    if ((req.query?.token || "") !== TOKEN) return res.status(401).send("unauthorized");
    if (req.method !== "POST") return res.status(405).send("method_not_allowed");

    // 1) парсинг тела (x-www-form-urlencoded / json)
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let body = {};
    if (ct.includes("application/x-www-form-urlencoded")) {
      const raw = await readRaw(req);
      body = Object.fromEntries(new URLSearchParams(raw));
    } else {
      body = req.body || {};
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = { _raw: body }; }
      }
    }

    // 2) хелперы для извлечения полей
    const get = (...keys) => {
      for (const k of keys) {
        const v = body?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
      return "";
    };

    // 3) собираем ТВОИ поля -> tplData (для SendGrid Template)
    const tplData = {
      first_name:      get("First Name", "first_name", "Имя"),
      last_name:       get("Last Name", "last_name", "Фамилия"),
      email:           get("Email", "email", "E-mail", "Почта"),
      date:            get("Date", "date", "Дата"),
      days:            get("Days", "days", "Кол-во дней", "Дней"),
      start_time:      get("Start Time", "start_time", "Начало", "Start"),
      end_time:        get("End Time", "end_time", "Конец", "Finish", "End"),
      delivery_method: get("Delivery", "Dostavka", "delivery_method", "Delivery Method", "Способ доставки", "Доставка"),
      products_text:   get("Products", "products_text", "Состав заказа", "Товары"),
      total:           get("Price", "Subtotal", "total", "Итого", "Сумма")
    };

    // 4) обязательные/служебные поля
    tplData.submitted_at = new Date().toLocaleString("ru-RU");
    tplData.phone        = get("Phone", "Телефон", "phone");
    tplData.name         = tplData.first_name || get("Name", "Имя") || "Клиент";

    // проверим email получателя (клиента)
    const clientEmail = tplData.email;
    if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(clientEmail)) {
      return res.status(400).send("no_email");
    }

    // 5) fallback контент (на случай невалидного TEMPLATE_ID)
    const rowsHtml = Object.entries({
      "First Name": tplData.first_name,
      "Last Name":  tplData.last_name,
      "Email":      tplData.email,
      "Date":       tplData.date,
      "Days":       tplData.days,
      "Start Time": tplData.start_time,
      "End Time":   tplData.end_time,
      "Delivery":   tplData.delivery_method,
      "Products":   tplData.products_text,
      "Total":      tplData.total,
      "Phone":      tplData.phone
    }).map(([k,v]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #eee;background:#fafafa"><b>${escapeHtml(k)}</b></td>
        <td style="padding:6px 10px;border:1px solid #eee">${escapeHtml(String(v ?? "")).replace(/\n/g, "<br>")}</td>
      </tr>`).join("");

    const htmlFallback = `
      <div style="font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial">
        <h2 style="margin:0 0 12px">Ваша заявка принята</h2>
        <h3 style="margin:16px 0 8px">Детали</h3>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:320px">${rowsHtml}</table>
        <p style="color:#888;margin-top:12px">RASKAT RENTAL • ${escapeHtml(tplData.submitted_at)}</p>
      </div>`;

    const textFallback = [
      "Ваша заявка принята",
      "",
      ...Object.entries({
        "First Name": tplData.first_name,
        "Last Name":  tplData.last_name,
        "Email":      tplData.email,
        "Date":       tplData.date,
        "Days":       tplData.days,
        "Start Time": tplData.start_time,
        "End Time":   tplData.end_time,
        "Delivery":   tplData.delivery_method,
        "Products":   tplData.products_text,
        "Total":      tplData.total,
        "Phone":      tplData.phone
      }).map(([k,v]) => `${k}: ${v ?? ""}`),
      "",
      `RASKAT RENTAL • ${tplData.submitted_at}`
    ].join("\n");

    const subject = `Ваша заявка — RASKAT RENTAL • ${tplData.submitted_at}`;

    // 6) personalizations
    const personalization = {
      to: [{ email: clientEmail }],
      subject
    };
    if (MANAGER_EMAIL) personalization.bcc = [{ email: MANAGER_EMAIL }];

    // 7) собираем payload: template (если доступен) или fallback
    let payload;
    if (isDynTpl) {
      payload = {
        personalizations: [{ ...personalization, dynamic_template_data: tplData }],
        from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
        reply_to: { email: FROM_EMAIL },
        template_id: TEMPLATE_ID,
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
        mail_settings: { bypass_list_management: { enable: true } }
      };
    } else {
      payload = {
        personalizations: [personalization],
        from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
        reply_to: { email: FROM_EMAIL },
        content: [
          { type: "text/plain", value: textFallback },
          { type: "text/html",  value: htmlFallback }
        ],
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
        mail_settings: { bypass_list_management: { enable: true } }
      };
    }

    // 8) диагностические заголовки (на время наладки)
    res.setHeader("X-Build", process.env.VERCEL_GIT_COMMIT_SHA || "no-sha");
    res.setHeader("X-Template", TEMPLATE_ID || "no-template");
    res.setHeader("X-UseTemplate", String(isDynTpl));

    // 9) отправляем в SendGrid
    const sgResp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const sgText = await sgResp.text();
    console.log("SendGrid:", sgResp.status, sgText);
    if (!sgResp.ok) return res.status(500).send(`sendgrid_error ${sgResp.status}: ${sgText}`);

    return res.status(200).send("ok");
  } catch (e) {
    console.error("Webhook fatal error:", e);
    return res.status(500).send("internal_error");
  }
};

// ——— utils ———
function readRaw(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
