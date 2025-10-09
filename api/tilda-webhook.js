const replyToEmail = (data.email || data.Email || "").trim();

const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    personalizations: [
      {
        to: [{ email: "lookteam777@gmail.com" }],
        subject: `Тест заявки с сайта RASKAT • ${new Date().toLocaleString("ru-RU")}`
      }
    ],
    from: { email: "manager@raskat.rent", name: "RASKAT RENTAL" },
    ...(replyToEmail ? { reply_to: { email: replyToEmail } } : {}),
    content: [
      {
        type: "text/html",
        value: `
          <h2>Тестовое сообщение</h2>
          <p>Это проверка отправки через SendGrid.</p>
          <p><strong>Дата:</strong> ${new Date().toLocaleString("ru-RU")}</p>
        `
      }
    ],
    tracking_settings: {
      click_tracking: { enable: false },
      open_tracking: { enable: false }
    }
  })
});

const text = await resp.text();
console.log("SendGrid resp:", resp.status, text);
if (!resp.ok) return res.status(500).send(`sendgrid_error ${resp.status}: ${text}`);
return res.status(200).send("ok");
