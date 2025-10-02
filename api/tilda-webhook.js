export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("method_not_allowed");
  if (req.query.token !== process.env.WEBHOOK_TOKEN) return res.status(401).send("unauthorized");

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
      try { data = JSON.parse(raw); } catch { data = {}; }
    }
  }

  let to = "manager@raskat.rent";
  const category = (data.category || "").toString().toLowerCase();
  if (category.includes("light") || category.includes("свет")) to = "light@raskat.rent";
  if (category.includes("camera") || category.includes("камера")) to = "camera@raskat.rent";

  const rows = Object.entries(data).map(([k, v]) =>
    `<tr><td><b>${k}</b></td><td>${String(v ?? "").replace(/\n/g, "<br>")}</td></tr>`
  ).join("");

  const html = `<h2>Новая заявка</h2><table border="1">${rows}</table>`;
  const subject = `Новая заявка • ${new Date().toLocaleString("ru-RU")}`;

  const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject }],
      from: { email: "manager@raskat.rent", name: "RASKAT RENTAL" },
      content: [{ type: "text/html", value: html }]
    })
  });

  if (r.ok) return res.status(200).send("ok");
  const text = await r.text();
  console.error("SendGrid error:", r.status, text);
  return res.status(500).send("sendgrid_error");
}
