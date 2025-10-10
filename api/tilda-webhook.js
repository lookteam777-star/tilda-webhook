// api/tilda-webhook.js (CommonJS, Vercel Node runtime)

let sgMail = null;
try {
  sgMail = require('@sendgrid/mail'); // ленивое подключение; если нет пакета — не упадём
} catch (e) {
  console.warn('SendGrid SDK is not installed; email sending will be skipped.');
}

const {
  SENDGRID_API_KEY,
  FROM_EMAIL = 'manager@raskat.rent',
  FROM_NAME  = 'RASKAT RENTAL',
  SG_TEMPLATE_ID = 'd-2c8c04c022584a6b8eb9ad5712f7b226',                        // динам. шаблон для клиента
  WEBHOOK_TOKEN = 'raskat_2025_secret',  // токен в URL ?token=
} = process.env;

if (sgMail && SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// ---------- helpers ----------
const first = (v) => (Array.isArray(v) ? v[0] : v);
const getAny = (obj, variants = []) => {
  const map = new Map(Object.keys(obj || {}).map(k => [k.toLowerCase(), obj[k]]));
  for (const v of variants) {
    const hit = map.get(String(v).toLowerCase());
    if (hit !== undefined) return first(hit);
  }
  return '';
};
function asObject(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return Object.fromEntries(new URLSearchParams(String(body)));
  } catch {
    return {};
  }
}
// парсим JSON-строку из поля Tilda "payment"
function parsePaymentJSON(paymentRaw, days) {
  if (!paymentRaw) return { items: [], products_text: '', total: '', delivery_method: '' };
  let p;
  try {
    p = typeof paymentRaw === 'string' ? JSON.parse(paymentRaw) : paymentRaw;
  } catch {
    return { items: [], products_text: '', total: '', delivery_method: '' };
  }
  const prod = Array.isArray(p.products) ? p.products : [];
  const d = Number.isFinite(+days) ? +days : 1;

  const items = prod.map((s, i) => {
    const src = String(s);
    const idx = src.lastIndexOf('=');
    const title = idx > -1 ? src.slice(0, idx).trim() : src.trim();
    const priceStr = idx > -1 ? src.slice(idx + 1).trim() : '';
    const price = Number(priceStr.replace(',', '.')) || 0;
    const sum = price * d;
    return {
      n: i + 1,
      title,
      price_per_day: price ? `${price} EUR` : '',
      days: d,
      sum: sum ? `${sum} EUR` : '',
    };
  });

  const products_text = items
    .map(it => (it.price_per_day ? `${it.title} — ${it.price_per_day}` : it.title))
    .join('; ');

  const total = (p.amount ?? p.subtotal ?? '').toString();
  const delivery_method = (p.delivery ?? '').toString();

  return { items, products_text, total, delivery_method };
}
function ok(res, body = 'ok') {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(body);
}
function fail(res, error, status = 500) {
  const msg = typeof error === 'string' ? error : (error?.message || 'server_error');
  console.error('WEBHOOK_ERROR:', error?.stack || error);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(status).send(msg);
}

// ---------- handler ----------
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return fail(res, 'method_not_allowed', 405);

    const token = (req.query && req.query.token) || req.headers['x-webhook-token'] || '';
    if (String(token) !== String(WEBHOOK_TOKEN)) return fail(res, 'unauthorized', 401);

    const received = asObject(req.body);

    // поля формы Тильды
    const nameRaw = getAny(received, ['name', 'Name', 'first_name', 'firstname']);
    const email   = getAny(received, ['email', 'Email', 'mail']);
    const phone   = getAny(received, ['phone', 'Phone', 'tel', 'phone_number']);

    const date      = getAny(received, ['daterec', 'date', 'Дата аренды*']);
    const daysStr   = getAny(received, ['days', 'Days', 'Кол-во суток']);
    const startTime = getAny(received, ['start_time', 'Start_Time', 'Время начала аренды*']);
    const endTime   = getAny(received, ['end_time', 'End_time', 'Время конца аренды']);
    const deliveryCyr = getAny(received, ['Доставка', 'delivery']);
    const comment   = getAny(received, ['comment', 'Комментарий', 'message']);
    const productsFallback = getAny(received, ['Products', 'products', 'Состав заказа']);
    const priceFallback    = getAny(received, ['Price', 'total', 'Subtotal', 'Итого']);

    // товары и суммы из payment JSON
    const paymentRaw = received.payment || '';
    const fromPayment = parsePaymentJSON(paymentRaw, daysStr);

    // имя/фамилия
    let first_name = nameRaw;
    let last_name  = '';
    if (nameRaw && nameRaw.includes(' ')) {
      const [f, ...rest] = nameRaw.split(' ').filter(Boolean);
      first_name = f; last_name = rest.join(' ');
    }

    const normalized = {
      first_name,
      last_name,
      email,
      phone,
      date,
      days: daysStr,
      start_time: startTime,
      end_time: endTime,
      delivery_method: fromPayment.delivery_method || deliveryCyr || getAny(received, ['delivery']),
      items: fromPayment.items,                                        // массив для таблицы
      products_text: fromPayment.products_text || productsFallback,    // фолбэк строкой
      total: fromPayment.total || priceFallback,
      comment
    };

    console.log('normalized →', JSON.stringify(normalized));

    // если SendGrid не сконфигурирован — не падаем
    if (!sgMail || !SENDGRID_API_KEY) {
      console.warn('SendGrid is not configured — skip sending');
      return ok(res);
    }

    const messages = [];

    // письмо клиенту
    if (SG_TEMPLATE_ID && email) {
      messages.push({
        to: email,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        replyTo: email ? { email } : undefined, // ответ клиенту улетит менеджеру, если поменяешь сюда
        templateId: SG_TEMPLATE_ID,
        dynamicTemplateData: normalized
      });
    }

    // письмо менеджеру (копия)
    const managerTo = MANAGER_EMAIL || FROM_EMAIL;
    if (managerTo) {
      messages.push({
        to: managerTo,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        templateId: SG_TEMPLATE_MANAGER_ID || SG_TEMPLATE_ID,
        replyTo: email ? { email } : undefined,
        dynamicTemplateData: { ...normalized, manager_copy: true }
      });
    }

    for (const m of messages) {
      const r = await sgMail.send(m);
      console.log('SendGrid status:', r[0]?.statusCode);
    }

    return ok(res);
  } catch (err) {
    return fail(res, err, 500);
  }
};

// Явно укажем Node runtime
module.exports.config = { runtime: 'nodejs18.x' };
