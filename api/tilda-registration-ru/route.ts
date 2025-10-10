import type { NextRequest } from "next/server";

const SG_URL = "https://api.sendgrid.com/v3/mail/send";

export async function POST(req: NextRequest) {
  // 1) auth по shared secret
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== process.env.WEBHOOK_SECRET_RU) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2) payload от Tilda (могут прислать массив)
  const raw = await req.json().catch(() => ({} as any));
  const data = Array.isArray(raw) ? raw[0] : raw;

  // honeypot
  if (data.website) return new Response("OK", { status: 200 });

  // 3) поля формы
  const name  = (data.name || data.fullname || data["Name"] || "").toString().trim();
  const email = (data.email || data["Email"] || "").toString().trim();
  const equipmentList = (data.equipment_list || data.equipment || data.items || "").toString().trim();

  if (!email) return new Response("Missing email", { status: 400 });

  // 4) SendGrid Dynamic Template (RU)
  const payload = {
    from: {
      email: process.env.SEND_FROM_EMAIL_RU || "noreply@raskat.rent",
      name: "RASKAT RENTAL",
    },
    personalizations: [
      {
        to: [{ email }],
        // при необходимости: bcc менеджеру
        // bcc: [{ email: "manager@raskat.rent" }],
        dynamic_template_data: {
          name: name || "клиент",
          year: new Date().getFullYear(),
          phone_display: "+381 61 114 26 94",
          phone_href: "+381611142694",
          address_label: "Белград, Terazije 5",
          address_url: "https://maps.app.goo.gl/wGcHPfaN5cknK8F38",
          whatsapp_url: "https://wa.me/381611142694",
          viber_url: "viber://chat?number=%2B381611142694",
          telegram_url: "https://t.me/raskat_manager",
          equipment_list: equipmentList,
        },
      },
    ],
    template_id:
      process.env.SENDGRID_TEMPLATE_ID_RU ||
      "d-cb881e00e3f04d1faa169fe4656fc84",
  };

  const r = await fetch(SG_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    console.error("SendGrid error", r.status, await r.text());
    return new Response("SendGrid error", { status: 502 });
  }
  return new Response("OK", { status: 200 });
}
