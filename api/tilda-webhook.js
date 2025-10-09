// api/tilda-webhook.js — Vercel Serverless (CommonJS)

// ===== Настройки =====
const TOKEN = process.env.TILDA_TOKEN || "raskat_2025_secret"; // ?token=...
const FROM_EMAIL = "manager@raskat.rent";                      // подтверждённый sender в SendGrid
const MANAGER_EMAIL = "manager@raskat.rent";                   // BCC (можно "")

// ===== ENV =====
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || "";
const TEMPLATE_ID  = process.env.SENDGRID_TEMPLATE_ID || "";
const IS_DYNAMIC_TPL = /^d-([0-9a-fA-F]{32}|[0-9a-fA-F-]{36})$/.test(TEMPLATE_ID);

// ===== Handler =====
module.exports = async (req, res) => {
  try {
    // Защита и метод
    if ((req.query?.token || "") !== TOKEN) return res.status(401).send("unauthorized");
    if (req.method !== "POST") return res.status(405).send("method_not_allowed");

    // Парсинг тела
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let body = {};
    if (ct.includes("application/x-www-form-urlencoded")) {
      const raw = await readRaw(req);
      body = Object.fromEntries(new URLSearchParams(raw));
    } else if (ct.includes("application/json")) {
      body = req.body || {};
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = { _raw: body }; }
      }
    } else {
      // на всякий — попытаемся прочесть
      const raw = await readRaw(req);
      try { body = JSON.parse(raw); } catch { body = Object.fromEntries(new URLSearchParams(raw)); }
    }

    // Диагностика: какие ключи реально пришли
    const bodyKeys = Object.keys(body || {});
    console.log("Tilda BODY keys:", bodyKeys);
    res.setHeader("X-Body-Keys", bodyKeys.join(","));

    // Режим быстрого просмотра (временно, для отладки):
    if (String(req.query.debug) === "1") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(200).send(JSON.stringify({ keys: bodyKeys, body }, null, 2));
    }

    // ============ Алиасы и геттеры ============
    function normalizeKey(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[_\-]+/g, "")
        .replace(/[ё]/g, "е");
    }
    function pick(_body, aliases) {
      const map = {};
      Object.keys(_body || {}).forEach(k => {
        map[normalizeKey(k)] = _body[k];
      });
      for (const a of aliases) {
        const v = map[normalizeKey(a)];
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          return String(v).trim();
        }
      }
      return "";
    }
    const aliases = {
      first_name: ["First Name","first_name","Имя","name","Name","contact_name","fio","ФИО","Фамилия и имя"],
      last_name:  ["Last Name","last_name","Фамилия","surname","Surname","last"],
      email:      ["Email","E-mail","email","Почта","mail","contact_email"],
      date:       ["Date","date","Дата","Дата аренды","rental_date","date_rent","Дата начала аренды","Дата получения"],
      days:       ["Days","days","Срок","Дней","Кол-во дней","rental_days","duration","srok"],
      start_time: ["Start Time","start_time","Start","Начало","Время начала","Время получения","pickup time","Начало аренды"],
      end_time:   ["End Time","end_time","End","Конец","Время окончания","Время возврата","return time","Конец аренды"],
      delivery_method: ["Delivery","delivery_method","Доставка","Способ доставки","Delivery Method","Dostavka"],
      products_text:   ["Products","products_text","Состав заказа","Товары","Order","Order Items","Basket","Корзина"],
      total:      ["Price","Subtotal","Total","Итого","Сумма","Стоимость","order_total","amount"],
      phone:      ["Phone","Телефон","phone","contact_phone"],
      products_json: ["ProductsJSON","products_json","basket","items_json"]
    };
    const g = (key) => pick(body, aliases[key]);

    // ============ Формируем данные для шаблона ============
    const tplData = {
      first_name:      g("first_name"),
      last_name:       g("last_name"),
      email:           g("email"),
      date:            g("date"),
      days:            g("days"),
      start_time:      g("start_time"),
      end_time:        g("end_time"),
      delivery_method: g("delivery_method"),
      products_text:   g("products_text"),
      total:           g("total"),
      phone:           g("phone"),
      submitted_at:    new Date().toLocaleString("ru-RU")
    };

    // Email обязателен
    const clientEmail = tplData.email;
    if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(clientEmail)) {
      return res.status(400).send("no_email");
    }

    // ============ Собираем items ============
    let items;
    const toNum = (v) => {
      const s = String(v ?? "").replace(/\s/g,"").replace(/,/g,".").replace(/[^\d.]/g,"");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    };

    // 1) JSON
    const productsJsonRaw = g("products_json");
    if (productsJsonRaw) {
      try {
        const arr = JSON.parse(productsJsonRaw);
        if (Array.isArray(arr) && arr.length) {
          items = arr.map((it, i) => ({
            n: i + 1,
            title: String(it.title ?? it.name ?? ""),
            price_per_day: it.price_per_day ?? it.price ?? it.cost ?? "",
            days: it.days ?? it.qty ?? it.quantity ?? "",
            sum: it.sum ?? it.total ?? ""
          }));
        }
      } catch {}
    }
    // 2) Плоский текст
    if (!items && tplData.products_text) {
      const lines = tplData.products_text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (lines.length) {
        items = lines.map((line, i) => {
          const price = toNum((line.match(/(\d[\d\s.,]*)/g) || [])[0] || "");
          const days  = toNum((line.match(/(?:x|×|\b)(\d{1,3})\b/) || [])[1] || "");
          const sum   = toNum((line.match(/=\s*([\d\s.,]+)/) || [])[1] || "");
          const title = line.split(/(\d)/)[0].trim().replace(/[—\-:]+$/,"") || line;
          return {
            n: i + 1,
            title,
            price_per_day: price === undefined ? "" : String(price),
            days:          days  === undefined ? "" : String(days),
            sum:           sum   === undefined ? "" : String(sum)
          };
        });
      }
    }
    if (items && items.length) tplData.items = items;

    // ============ Fallback-письмо ============
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
        <td style="padding:6px 10px;border:1px solid #eee">${escapeHtml(String(v ?? "")).replace(/\n/g,"<br>")}</td>
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

    // ============ Payload для SendGrid ============
    const personalization = { to: [{ email: clientEmail }], subject };
    if (MANAGER_EMAIL) personalization.bcc = [{ email: MANAGER_EMAIL }];

    const payload = IS_DYNAMIC_TPL
      ? {
          personalizations: [{
            ...personalization,
            dynamic_template_data: tplData
          }],
          from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
          reply_to: { email: FROM_EMAIL },
          template_id: TEMPLATE_ID,
          tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
          mail_settings: { bypass_list_management: { enable: true } }
        }
      : {
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

    // Диагностические заголовки
    res.setHeader("X-Build", process.env.VERCEL_GIT_COMMIT_SHA || "no-sha");
    res.setHeader("X-Template", TEMPLATE_ID || "no-template");
    res.setHeader("X-UseTemplate", String(IS_DYNAMIC_TPL));

    // Отправка в SendGrid
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

// ===== Utils =====
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
