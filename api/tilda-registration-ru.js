// api/tilda-registration-ru.js
// Вебхук Tilda → SendGrid (RU). Извлекаем ТОЛЬКО name и email, остальное игнорируем.

const SG_URL = 'https://api.sendgrid.com/v3/mail/send';

// --- утилиты извлечения полей (работают с любыми форматами Tilda) ---
const EMAIL_RX = /(^|\b)email(\d+)?($|\b)/i;
const NAME_RX  = /(^|\b)(name|fullname|fio)($|\b)/i;
const HONEYPOT_RX = /(^|\b)website($|\b)/i;

function findInKVArray(arr, rx) {
  if (!Array.isArray(arr)) return '';
  for (const it of arr) {
    const key = (it?.name || it?.key || '').toString();
    if (rx.test(key)) {
      const v = it?.value ?? it?.val ?? it?.content ?? '';
      if (`${v}`.trim() !== '') return `${v}`.trim();
    }
  }
  return '';
}

function findInObject(obj, rx) {
  if (!obj || typeof obj !== 'object') return '';
  for (const [k, v] of Object.entries(obj)) {
    if (rx.test(k) && `${v ?? ''}`.trim() !== '') return `${v}`.trim();
  }
  return '';
}

function deepFind(node, rx) {
  if (!node) return '';
  const direct = findInObject(node, rx);
  if (direct) return direct;

  const kv = findInKVArray(node, rx);
  if (kv) return kv;

  // стандартные контейнеры Tilda
  const containers = [node?.data, node?.formdata, node?.fields, node?.form];
  for (const c of containers) {
    const got = deepFind(c, rx);
    if (got) return got;
  }

  // произвольные вложения
  if (Array.isArray(node)) {
    for (const item of node) {
      const got = deepFind(item, rx);
      if (got) return got;
    }
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) {
      const got = deepFind(v, rx);
      if (got) return got;
    }
  }
  return '';
}

function normalizeBody(req) {
  let raw = req.body;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  return Array.isArray(raw) ? raw[0] : (raw || {});
}

// --- обработчик ---
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    // auth
    const q = req.query || {};
    const provided =
      (q.secret || q.token || '').toString().trim() ||
      (req.headers['x-webhook-secret'] || '').toString().trim();
    const expected = process.env.WEBHOOK_SECRET_RU;
    if (!expected) return res.status(500).send('Missing WEBHOOK_SECRET_RU env');
    if (!provided) return res.status(401).send('Unauthorized: no secret');
    if (provided !== expected) return res.status(401).send('Unauthorized: bad secret');

    const debug = (q.debug || '') === '1'; // показать текст ошибки SendGrid
    const echo  = (q.echo  || '') === '1'; // вернуть распарсенные поля (без отправки)
    const allowEmptyCheck = process.env.ALLOW_EMPTY_TILDA_CHECK === '1';
    const ua = (req.headers['user-agent'] || '').toLowerCase();

    // parse
    const base = normalizeBody(req);

    // honeypot
    const honeypot = deepFind(base, HONEYPOT_RX);
    if (honeypot) return res.status(200).send('OK');

    const email = deepFind(base, EMAIL_RX);
    const name  = deepFind(base, NAME_RX);

    if (echo) return res.status(200).json({ parsed: { name, email }, raw: base });

    // пустая проверка из админки Tilda без email — отвечаем OK, если включено ENV
    if (!email && allowEmptyCheck && ua.includes('tilda')) {
      return res.status(200).send('OK');
    }
    if (!email) return res.status(400).send('Missing email');

    // env
    const API_KEY     = process.env.SENDGRID_API_KEY;
    const FROM_EMAIL  = process.env.SEND_FROM_EMAIL_RU || 'manager@raskat.rent';

    // Поддерживаем оба имени переменной; если не заданы — используем НОВЫЙ ID по умолчанию:
    const TEMPLATE_ID =
      process.env.SENDGRID_TEMPLATE_ID_REG_RU ||
      'd-cb881e00e3f04d1faa169fe4656fc844';

    if (!API_KEY) return res.status(500).send('Missing SENDGRID_API_KEY env');

    // если TEMPLATE_ID задан — шлём по шаблону; иначе fallback с subject/content
    let sgPayload;
    if (TEMPLATE_ID) {
      sgPayload = {
        from: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
        reply_to: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
        personalizations: [{
          to: [{ email }],
          // bcc: [{ email: FROM_EMAIL }], // включи при необходимости
          dynamic_template_data: {
            name: name || 'клиент',
            year: new Date().getFullYear(),
          },
        }],
        template_id: TEMPLATE_ID,
      };
    } else {
      // аварийный режим (если шаблон внезапно недоступен)
      sgPayload = {
        from: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
        reply_to: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
        personalizations: [{ to: [{ email }] }],
        subject: 'RASKAT RENTAL — регистрация получена',
        content: [{
          type: 'text/plain',
          value: `Здравствуйте, ${name || 'клиент'}!\nМы получили вашу регистрацию. Менеджер свяжется с вами в ближайшее время.`,
        }],
      };
    }

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
