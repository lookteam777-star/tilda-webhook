// api/tilda-registration-ru.js
// Вебхук для Tilda → отправка письма через SendGrid Dynamic Template (RU)

const SG_URL = 'https://api.sendgrid.com/v3/mail/send';

module.exports = async (req, res) => {
  try {
    // Разрешаем только POST
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    // --- Авторизация по секрету ---
    const getSecret = (req) => {
      const q = req.query || {};
      const fromQuery = (q.secret || q.token || '').toString().trim();
      const fromHeader = (req.headers['x-webhook-secret'] || '').toString().trim();
      return fromQuery || fromHeader;
    };

    const provided = getSecret(req);
    const expected = process.env.WEBHOOK_SECRET_RU;
    if (!expected) return res.status(500).send('Missing WEBHOOK_SECRET_RU env');
    if (!provided) return res.status(401).send('Unauthorized: no secret');
    if (provided !== expected) return res.status(401).send('Unauthorized: bad secret');

    // --- Параметры режима ---
    const debug = (req.query.debug || '') === '1'; // вернём текст ошибки SendGrid наружу
    const isCheck = (req.query.check || '') === '1'; // пропустим пустую проверку Webhook в Tilda

    // --- Чтение payload (Tilda может прислать строку/массив) ---
    const rawBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const data = Array.isArray(rawBody) ? rawBody[0] : rawBody;

    // --- Антиспам (honeypot) ---
    if (data && data.website) return res.status(200).send('OK');

    // --- Поля формы ---
    const name  = ((data && (data.name || data.fullname || data.Name)) || '').toString().trim();
    const email = ((data && (data.email || data.Email)) || '').toString().trim();
    const phone = ((data && (data.phone || data.Phone)) || '').toString().trim();
    const equipmentList = ((data && (data.equipment_list || data.equipment || data.items)) || '').toString().trim();

    // Для "Проверить Webhook" в Tilda разрешаем пустой email, если ?check=1
    if (!email && !isCheck) return res.status(400).send('Missing email');
    if (isCheck && !email) return res.status(200).send('OK');

    // --- Отправитель и шаблон из ENV ---
    const FROM_EMAIL = process.env.SEND_FROM_EMAIL_RU || 'manager@raskat.rent';
    const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID_RU || 'd-cb881e00e3f04d1faa169fe4656fc844';
    const API_KEY = process.env.SENDGRID_API_KEY;
    if (!API_KEY) return res.status(500).send('Missing SENDGRID_API_KEY env');

    // --- Формируем payload SendGrid ---
    const personalization = {
      to: email ? [{ email }] : [],            // при check=1 может быть пусто
      // bcc: [{ email: 'manager@raskat.rent' }], // включи, если нужна скрытая копия менеджеру
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
        phone_from_form: phone,
      },
    };

    const sgPayload = {
      from: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
      reply_to: { email: 'manager@raskat.rent', name: 'RASKAT RENTAL' }, // повышает deliverability
      personalizations: [personalization],
      template_id: TEMPLATE_ID,
    };

    // Если это check-запрос — мы уже ответили OK выше; но на всякий случай не дергаем API
    if (!email && isCheck) return res.status(200).send('OK');

    // --- Отправка в SendGrid ---
    const sgRes = await fetch(SG_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sgPayload),
    });

    if (!sgRes.ok) {
      const txt = await sgRes.text();
      console.error('SendGrid error:', sgRes.status, txt);
      return res.status(502).send(debug ? `SendGrid error ${sgRes.status}: ${txt}` : 'SendGrid error');
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
};
