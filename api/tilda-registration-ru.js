// Мини-вебхук: Tilda → SendGrid (берём только name и email)

const SG_URL = 'https://api.sendgrid.com/v3/mail/send';

// чтение значения по возможным ключам
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && `${v}`.trim() !== '') return `${v}`.trim();
  }
  return '';
};

// поиск в массивах вида [{name, value}]
const kvLookup = (arr, ...names) => {
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
};

// извлекаем name/email из разных форматов Tilda
function extractNameEmail(req) {
  let raw = req.body;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  const base = Array.isArray(raw) ? raw[0] : (raw || {});
  const dataArr = base?.data || base?.formdata || base?.fields || base?.form;

  const email =
    kvLookup(dataArr, 'email', 'Email') ||
    pick(base, 'email', 'Email', 'e-mail', 'mail');

  const name =
    kvLookup(dataArr, 'name', 'fullname', 'fio', 'Name') ||
    pick(base, 'name', 'fullname', 'fio', 'Name');

  const website =
    kvLookup(dataArr, 'website') ||
    pick(base, 'website'); // honeypot

  return { name, email, website, raw: base };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    // auth по секрету (query ?secret=... или заголовок X-Webhook-Secret)
    const q = req.query || {};
    const provided =
      (q.secret || q.token || '').toString().trim() ||
      (req.headers['x-webhook-secret'] || '').toString().trim();
    const expected = process.env.WEBHOOK_SECRET_RU;
    if (!expected) return res.status(500).send('Missing WEBHOOK_SECRET_RU env');
    if (!provided) return res.status(401).send('Unauthorized: no secret');
    if (provided !== expected) return res.status(401).send('Unauthorized: bad secret');

    const debug = (q.debug || '') === '1'; // возвращать текст ошибки SG
    const isCheck = (q.check || '') === '1'; // пропустить пустую проверку в UI Tilda
    const echo = (q.echo || '') === '1'; // вернуть распарсенное, без отправки

    // парсинг
    const { name, email, website, raw } = extractNameEmail(req);

    if (website) return res.status(200).send('OK'); // honeypot
    if (echo) return res.status(200).json({ parsed: { name, email }, raw });

    if (!email && isCheck) return res.status(200).send('OK'); // проверка в Tilda
    if (!email) return res.status(400).send('Missing email');

    // env
    const API_KEY = process.env.SENDGRID_API_KEY;
    const FROM_EMAIL = process.env.SEND_FROM_EMAIL_RU || 'manager@raskat.rent';
    const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID_RU || 'd-cb881e00e3f04d1faa169fe4656fc844';
    if (!API_KEY) return res.status(500).send('Missing SENDGRID_API_KEY env');

    // только name/email в dynamic_template_data
    const sgPayload = {
      from: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
      reply_to: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
      personalizations: [{
        to: [{ email }],
        // bcc: [{ email: FROM_EMAIL }], // включи, если нужна копия менеджеру
        dynamic_template_data: {
          name: name || 'клиент',
          year: new Date().getFullYear(),
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
  } catch (e) {
    console.error(e);
    return res.status(500).send('Server error');
  }
};
