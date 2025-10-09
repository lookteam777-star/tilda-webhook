// api/tilda-webhook.js
// Vercel / Next.js API route

const sgMail = require('@sendgrid/mail');

// ==== ENV ====
const {
  SENDGRID_API_KEY,
  FROM_EMAIL = 'manager@raskat.rent',
  FROM_NAME = 'RASKAT RENTAL',
  MANAGER_EMAIL,                     // необязательно (например: "manager@raskat.rent")
  SG_TEMPLATE_ID,                    // шаблон для клиента (динамический template id)
  SG_TEMPLATE_MANAGER_ID,            // отдельный шаблон для менеджера (необязательно)
  WEBHOOK_TOKEN = 'raskat_2025_secret',
} = process.env;

if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

// ==== helpers ====
const first = (v) => (Array.isArray(v) ? v[0] : v);
const getAny = (obj, variants = []) => {
  const map = new Map(Object.keys(obj || {}).map((k) => [k.toLowerCase(), obj[k]]));
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

// Разбор JSON-строки от Тильды в поле "payment"
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
    .map((it) => (it.price_per_day ? `${it.title} — ${it.price_per_day}` : it.title))
    .join('; ');

  const total = (p.amount ?? p.subtotal ?? '').toString();
  const delivery_method = (p.delivery ?? '').toString();

  return { items, products_text, total, delivery_method };
}

function ok(res, body = 'ok') {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(body);
}
function bad(res, code, msg) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).send(msg);
}

// ==== main handler ====
module.exports = async (req, res) => {
  if (req.method !== 'POST') return bad(res, 405, 'method_not_allowed');

  // защита по токену
  const token = (req.query && req.query.token) || (req.headers['x-webhook-token'] || '');
  if (String(token) !== String(WEBHOOK_TOKEN)) return bad(res, 401, 'unauthorized');

  // распарсить тело
  const received = asObject(req.body);
  const meta = {
    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
    contentType: req.headers['content-type'] || '',
    now: new Date().toISOString(),
  };

  // Базовые поля (как в твоей форме)
  const nameRaw   = getAny(received, ['name', 'Name', 'first_name', 'firstname']);
  const email     = getAny(received, ['email', 'Email', 'mail']);
  const phone     = getAny(received, ['phone', 'Phone', 'tel', 'phone_number']);
  const date      = getAny(received, ['daterec', 'date', 'Дата аренды*']);
  const daysStr   = getAny(received, ['days', 'Days', 'Кол-во суток']);
  const startTime = getAny(received, ['start_time', 'Start_Time', 'Время начала аренды*']);
  const endTime   = getAny(received, ['end_time', 'End_time', 'Время конца аренды']);
  const deliveryCyr = getAny(received, ['Доставка', 'delivery']);
  const comment   = getAny(received, ['comment', 'Комментарий', 'message']);
  const productsFallback = getAny(received, ['Products', 'products', 'Состав заказа']);
  const priceFallback = getAny(received, ['Price', 'total', 'Итого']);

  // Payment JSON от Тильды
  const paymentRaw = received.payment || '';
  const fromPayment = parsePaymentJSON(paymentRaw, daysStr);

  // Имя / Фамилия
  let first_name = nameRaw;
  let last_name  = '';
  if (nameRaw && nameRaw.includes(' ')) {
    const [f, ...rest] = nameRaw.split(' ').filter(Boolean);
    first_name = f;
    last_name  = rest.join(' ');
  }

  // Нормализованные данные (динамика для SendGrid)
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
    items: fromPayment.items, // массив для таблицы
    products_text: fromPayment.products_text || productsFallback,
    total: fromPayment.total || priceFallback,
    comment,
    source_ip: meta.ip,
    user_agent: meta.userAgent,
  };

  // Логи в Vercel (видно в "Runtime logs")
  console.log('SendGrid dynamic_template_data:', normalized);

  // Если нет ключа — просто завершаем (для прогонов без отправки)
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY is missing — skip email send');
    return ok(res);
  }

  // --- Письмо клиенту ---
  const messages = [];
  if (SG_TEMPLATE_ID && email) {
    messages.push({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      replyTo: email ? { email } : undefined,
      templateId: SG_TEMPLATE_ID,
      dynamicTemplateData: normalized,
    });
  }

  // --- Письмо менеджеру (опционально) ---
  const managerTo = MANAGER_EMAIL || FROM_EMAIL;
  if (managerTo) {
    const managerMsg = {
      to: managerTo,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      templateId: SG_TEMPLATE_MANAGER_ID || SG_TEMPLATE_ID, // можно тот же шаблон
      dynamicTemplateData: {
        ...normalized,
        // можно пометить, что это копия для менеджера
        manager_copy: true,
      },
    };
    // Если хочется отвечать менеджеру прямо клиенту — добавим Reply-To
    if (email) managerMsg.replyTo = { email };
    messages.push(managerMsg);
  }

  // Отправка
  try {
    if (messages.length) {
      // по очереди, чтобы видеть точные ошибки
      for (const m of messages) {
        const resp = await sgMail.send(m);
        console.log('SendGrid:', resp[0]?.statusCode);
      }
    }
    return ok(res);
  } catch (err) {
    console.error('sendgrid_error', err?.response?.body || err);
    return bad(res, 500, 'sendgrid_error');
  }
};
