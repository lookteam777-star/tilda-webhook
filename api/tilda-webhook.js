import sendgrid from "@sendgrid/mail";

sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

export default async function handler(req, res) {
  const { token } = req.query;

  // Проверка токена
  if (token !== "raskat_2025_secret") {
    return res.status(401).send("unauthorized");
  }

  // Разрешаем только POST
  if (req.method !== "POST") {
    return res.status(405).send("method_not_allowed");
  }

  try {
    const data = req.body;

    // Формируем письмо
    const msg = {
      to: "manager@raskat.rent",        // куда отправлять
      from: "manager@raskat.rent",      // от кого (должен быть подтвержден в SendGrid)
      subject: "Новая заявка с формы Tilda",
      text: JSON.stringify(data, null, 2),
      html: `<pre>${JSON.stringify(data, null, 2)}</pre>`,
    };

    await sendgrid.send(msg);

    res.status(200).json({ status: "ok", received: data });
  } catch (error) {
    console.error("SendGrid error:", error);
    res.status(500).json({ error: "internal_error", details: error.message });
  }
}
