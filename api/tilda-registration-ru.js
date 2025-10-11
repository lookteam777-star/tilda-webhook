// api/tilda-registration-ru.js
// Вебхук регистрации: Tilda → SendGrid (только name + email)

let sgMail = null;
try {
  sgMail = require('@sendgrid/mail'); // если пакета нет — письма не уйдут, но функция не упадёт
} catch (e) {
  console.warn('SendGrid SDK not installed; email sending will be skipped.');
}

/* ===== ENV ===== */
const {
  WEBHOOK_TOKEN = 'u6eZrVh0rN1m2uU7yN3qQ0vT8pJ4aW9k',    // авторизация по ?token= или X-Webhook-Token
  SENDGRID_API_KEY,
  SEND_FROM_EMAIL_RU = 'manager@raskat.rent',
  SENDGRID_TEMPLATE_ID_RU = 'd-cb881e00e3f04d1faa169fe4656fc844',
  SENDGRID_TEMPLATE_ID_REG_RU = 'd-cb881e00e3f04d1faa169fe4656fc844',
} = process.env;

if (sgMail && SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

/* ===== helpers ===== */
const first = (v) => (Array.isArray(v) ? v[0] : v);

const getAny = (obj, variants = []) => {
  const map = new Map(Object.keys(obj || {}).map(k => [k.toLowerCase(), obj[k]]));
  for (const v of variants) {
    const hit = map.get(String(v).toLowerCase());
    if (hit !== undefined && String(hit).trim() !== '') return String(first(hit)).trim();
  }
  return '';
};

// Парсим JSON-строку или x-www-form-urlencoded в объект
function asObject(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;

  const s = String(body);

  // JSON?
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? (j[0] || {}) : j;
  } catch {}

  // urlencoded a=1&b=2
  try {
    const params = new URLSearchParams(s);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    return obj;
  } catch {}

  return {};
}

const ok = (res, body = 'OK') => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(body);
};
const fail = (res, error, status = 500) => {
  const msg = typeof error === 'string' ? error : (error?.message || 'server_error');
  console.error('WEBHOOK_ERROR:', error?.stack || error);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(status).send(msg);
};

/* ===== handler ===== */
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return fail(res, 'method_not_allowed', 405);

    // --- auth: ?token=... или заголовок X-Webhook-Token ---
    const tokenFromQuery  = (req.query && req.query.token) || '';
    const tokenFromHeader = req.headers['x-webhook-token'] || '';
    const providedToken = String(tokenFromQuery || tokenFromHeader).trim();
    if (providedToken !== String(WEBHOOK_TOKEN)) return fail(res, 'unauthorized', 401);

    // --- echo-режим для диагностики ---
    const echo = String((req.query && req.query.echo) || '') === '1';

    // --- parse body ---
    const received = asObject(req.body);

    // --- pick fields ---
    const name  = getAny(received, ['name','Name','fullname','fio','first_name','firstname']);
    const email = getAny(received, ['email','Email','e-mail','mail','client_email','email-1','email1']);

    // honeypot
    const website = getAny(received, ['website','Website']);

    // логируем базовую диагностику
    const mask = (s) => (s ? s.replace(/(.).+(@.*)/, '$1***$2') : '');
    console.log('[reg-ru] parsed', {
      hasEmail: !!email,
      email: mask(email),
      hasName: !!name,
      keys: Object.keys(received || {})
    });

    if (echo) {
      // показываем, что реально прилетело с формы — без отправки письма
      return res.status(200).json({ parsed: { name, email }, raw: received });
    }

    if (website) {
      console.log('[reg-ru] skip: honeypot filled');
      return ok(res);
    }

    // Когда Tilda делает "Проверить Webhook" — часто полей нет.
    // Возвращаем OK, чтобы вебхук прикрепился. Реальная отправка будет с email.
    if (!email) {
      console.log('[reg-ru] skip: missing email');
      return ok(res);
    }

    // --- SendGrid ---
    if (!sgMail || !SENDGRID_API_KEY) {
      console.warn('SendGrid not configured — skip sending');
      return ok(res);
    }

    const templateId =
      SENDGRID_TEMPLATE_ID_RU ||
      SENDGRID_TEMPLATE_ID_REG_RU ||
      'd-cb881e00e3f04d1faa169fe4656fc844'; // дефолтный ID

    const msg = {
      to: email,
      from: { email: SEND_FROM_EMAIL_RU, name: 'RASKAT RENTAL' },
      replyTo: { email: SEND_FROM_EMAIL_RU, name: 'RASKAT RENTAL' },
      templateId,
      dynamicTemplateData: {
        name: name || 'клиент',
        year: new Date().getFullYear(),
      },
    };

    try {
      const r = await sgMail.send(msg);
      console.log('SendGrid status:', r[0]?.statusCode);
    } catch (e) {
      // вернём текст ошибки SG наружу, чтобы было видно прямо в Tilda
      const body = e?.response?.body ? JSON.stringify(e.response.body) : (e.message || 'sendgrid_error');
      return fail(res, body, 502);
    }

    return ok(res);
  } catch (err) {
    return fail(res, err, 500);
  }
};

// Явно укажем runtime
module.exports.config = { runtime: 'nodejs18.x' };
