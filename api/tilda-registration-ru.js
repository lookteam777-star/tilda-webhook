// Вебхук для Tilda → SendGrid (RU). Понимает разные форматы Tilda.

const SG_URL = 'https://api.sendgrid.com/v3/mail/send';

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && `${v}`.trim() !== '') return `${v}`.trim();
  }
  return '';
}

function kvLookup(arr, ...names) {
  if (!Array.isArray(arr)) return '';
  const lower = names.map((n) => n.toLowerCase());
  for (const it of arr) {
    const n = (it?.name || it?.key || '').toString().toLowerCase();
    if (lower.includes(n)) {
      const v = it?.value ?? it?.val ?? it?.content ?? '';
      if (`${v}`.trim() !== '') return `${v}`.trim();
    }
  }
  return '';
}

function extractPayload(req) {
  // Tilda может прислать: строку, объект, массив объектов, объект с data/fields/form
  let raw = req.body;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  // Часто Tilda присылает массив с одним объектом
  const base = Array.isArray(raw) ? raw[0] : raw;

  // Возможные контейнеры с парами name/value:
  const dataArr   = base?.data || base?.formdata || base?.fields || base?.form;
  const flat      = base || {};

  // Достаём стандартные поля (множество вариантов имён)
  const email = (
    kvLookup(dataArr, 'email', 'Email') ||
    pick(flat, 'email', 'Email', 'e-mail', 'mail')
  );

  const name = (
    kvLookup(dataArr, 'name', 'fullname', 'fio', 'Name') ||
    pick(flat, 'name', 'fullname', 'fio', 'Name')
  );

  const phone = (
    kvLookup(dataArr, 'phone', 'tel', 'Phone') ||
    pick(flat, 'phone', 'tel', 'Phone')
  );

  const equipmentList = (
    kvLookup(dataArr, 'equipment_list', 'equipment', 'items') ||
    pick(flat, 'equipment_list', 'equipment', 'items')
  );

  // Honeypot часто кладут как website
  const website = (
    kvLookup(dataArr, 'website') ||
    pick(flat, 'website')
  );

  return { email, name, phone, equipmentList, website, raw: base };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    // --- auth ---
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

    const debug = (req.query.debug || '') === '1'; // вернём текст ошибки SG
    const isCheck = (req.query.check || '') === '1'; // пропустить пустую проверку в UI Tilda
    const echo = (req.query.echo || '') === '1';     // вернуть распарсенный payload

    // --- parse incoming ---
    const { email, name, phone, equipmentList, website, raw } = extractPayload(req);

    // anti-bot
    if (website) return res.status(200).send('OK');

    // для «Проверить Webhook» (пустой email) — не шлём письма, просто OK
    if (!email && isCheck) return res.status(200).send('OK');

    if (echo) {
      return res.status(200).json({ parsed: { email, name, phone, equipmentList }, raw });
    }

    if (!email) return res.status(400).send('Missing email');

    // --- SendGrid payload ---
    const FROM_EMAIL = process.env.SEND_FROM_EMAIL_RU || 'manager@raskat.rent';
    const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID_RU || 'd-cb881e00e3f04d1faa169fe4656fc844';
    const API_KEY = process.env.SENDGRID_API_KEY;
    if (!API_KEY) return res.status(500).send('Missing SENDGRID_API_KEY env');

    const sgPayload = {
      from: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
      reply_to: { email: 'manager@raskat.rent', name: 'RASKAT RENTAL' },
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
          phone_from_form: phone,
        },
      }],
      template_id: TEMPLATE_ID,
    };

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
