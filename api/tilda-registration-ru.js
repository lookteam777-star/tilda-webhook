// api/tilda-registration-ru.js
const SG_URL = 'https://api.sendgrid.com/v3/mail/send';

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    // 1) auth по shared secret в query
    const secret = (req.query.secret || '').toString();
    if (!secret || secret !== process.env.WEBHOOK_SECRET_RU) {
      return res.status(401).send('Unauthorized');
    }

    // 2) payload (Tilda иногда присылает массив; body может быть строкой)
    const rawBody = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const data = Array.isArray(rawBody) ? rawBody[0] : rawBody;

    // honeypot
    if (data && data.website) return res.status(200).send('OK');

    // 3) поля
    const name  = ((data && (data.name || data.fullname || data.Name)) || '').toString().trim();
    const email = ((data && (data.email || data.Email)) || '').toString().trim();
    const equipmentList = ((data && (data.equipment_list || data.equipment || data.items)) || '').toString().trim();

    if (!email) return res.status(400).send('Missing email');

    // 4) SendGrid Dynamic Template (RU)
    const sgPayload = {
      from: { email: process.env.SEND_FROM_EMAIL_RU || 'noreply@raskat.rent', name: 'RASKAT RENTAL' },
      personalizations: [{
        to: [{ email }],
        // bcc: [{ email: 'manager@raskat.rent' }],
        dynamic_template_data: {
          name: name || 'клиент',
          year: new Date().getFullYear(),
          phone_display: '+381 61 114 26 94',
          phone_href: '+381611142694',
          address_label: 'Белград, Terazije 5',
          address_url: 'https://maps.app.goo.gl/wGcHPfaN5cknK8F38',
          whatsapp_url: 'https://wa.me/381611142694',
          viber_url: 'viber://chat?number=%2B381611142694',
          telegram_url: 'https://t.me/raskat_manager',
          equipment_list: equipmentList,
        },
      }],
      template_id: process.env.SENDGRID_TEMPLATE_ID_RU || 'd-cb881e00e3f04d1faa169fe4656fc844',
    };

    const sgRes = await fetch(SG_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sgPayload),
    });

    if (!sgRes.ok) {
      const txt = await sgRes.text();
      console.error('SendGrid error:', sgRes.status, txt);
      return res.status(502).send('SendGrid error');
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
};
