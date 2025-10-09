// api/tilda-webhook.js

const FROM_EMAIL = "manager@raskat.rent";     // подтверждённый sender в SendGrid
const MANAGER_EMAIL = "manager@raskat.rent";  // bcc менеджеру (можно убрать)
const TOKEN = "raskat_2025_secret";

// из окружения
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || "";
const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID || "";

/**
 * Dynamic Template ID может быть двух видов:
 * - d-<32 hex> (как у тебя)
 * - d-<uuid с дефисами>
 */
const isDynTpl =
  /^d-([0-9a-fA-F]{32}|[0-9a-fA-F-]{36})$/.test(TEMPLATE_ID);

export default async function handler(req, res) {
  try {
    // защита токеном
    if ((req.query?.token || "") !== TOKEN) {
      return res.status(401).send("unauthorized");
    }
    if (req.method !== "POST") {
      return res.status(405).send("method_not_allowed");
    }

    // --- парсинг тела ---
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
      // vercel уже парсит JSON, но на всякий случай fallback
      data = req.body ?? {};
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { data = { _raw: data }; }
      }
    }

    // --- извлекаем основные поля ---
    const pick = (o, names) => {
      for (const n of names) {
        const v = o?.[n];
        if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return "";
    };

    const clientEmail = pick(data, ["email", "Email", "e-mail", "mail", "client_email"]);
    if (!clientEmail) return res.status(400).send("no_email");

    const name = pick(data, ["name", "Name", "Имя"]) || "Клиент";
    const phone = pick(data, ["phone", "Телефон"]) || "";
    const message = pick(data, ["message", "Message", "сообщение", "Комментарий"]) || "";
    const submitted_at = new Date().toLocaleString("ru-RU");

    // --- готовим html/text fallback ---
    const rowsHtml = Object.entries(data).map(([k, v]) =>
      `<tr>
        <td style="padding:6px 10px;border:1px solid #eee;background:#fafafa"><b>${escapeHtml(k)}</b></td>
        <td style="padding:6px 10px;border:1px solid #eee">${escapeHtml(String(v ?? "")).replace(/\n/g, "<br>")}</td>
      </tr>`
    ).join("");

    const htmlFallback = `
      <div style="font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial">
        <h2 style="margin:0 0 12px">Ваша заявка принята</h2>
        <p>Имя: ${escapeHtml(name)}<br>Email: ${escapeHtml(clientEmail)}<br>Телефон: ${escapeHtml(phone)}</p>
        ${message ? `<p>Сообщение: ${escapeHtml(message)}</p>` : ""}
        <h3 style="margin:16px 0 8px">Детали</h3>
        <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:320px">${rowsHtml}</table>
        <p style="color:#888;margin-top:12px">RASKAT RENTAL • ${escapeHtml(submitted_at)}</p>
      </div>`;

    const textFallback =
      `Ваша заявка принята\n\n` +
      `Имя: ${name}\nEmail: ${clientEmail}\nТелефон: ${phone}\n` +
      (message ? `Сообщение: ${message}\n\n` : `\n`) +
      `RASKAT RENTAL • ${submitted_at}`;

    const subject = `Ваша заявка — RASKAT RENTAL • ${submitted_at}`;

    // --- personalization общая ---
    const personalization = {
      to: [{ email: clientEmail }],
      bcc: MANAGER_EMAIL ? [{ email: MANAGER_EMAIL }] : undefined,
      subject
    };

    // --- собираем payload ---
    let payload;
    if (isDynTpl) {
      // отправка по Dynamic Template
      payload = {
        personalizations: [{
          ...personalization,
          dynamic_template_data: { name, email: clientEmail, phone, message, submitted_at }
        }],
        from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
        reply_to: { email: FROM_EMAIL },
        template_id: TEMPLATE_ID
      };
    } else {
      // fallback: обычное письмо
      payload = {
        personalizations: [personalization],
        from: { email: FROM_EMAIL, name: "RASKAT RENTAL" },
        reply_to: { email: FROM_EMAIL },
        content: [
          { type: "text/plain", value: textFallback },
          { type: "text/html",  value: htmlFallback }
        ]
      };
    }

    // --- диагностические заголовки ---
    res.setHeader("X-Build", process.env.VERCEL_GIT_COMMIT_SHA || "no-sha");
    res.setHeader("X-Template", TEMPLATE_ID || "no-template");
    res.setHeader("X-UseTemplate", String(isDynTpl));

    // --- отправка в SendGrid ---
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
    if (!sgResp.ok) {
      return res.status(500).send(`sendgrid_error ${sgResp.status}: ${sgText}`);
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook fatal error:", err);
    return res.status(500).send("internal_error");
  }
}

// простая экранизация html
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
