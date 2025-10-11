// api/tilda-registration-ru.js
// Мини-вебхук регистрации: Tilda → SendGrid (только name + email)
// Авторизация: token из BODY (POST) + Query (?token=) + Header (X-Webhook-Token)

let sgMail = null;
try {
  sgMail = require('@sendgrid/mail');
} catch (e) {
  console.warn('SendGrid SDK not installed; email sending will be skipped.');
}

// ==== ENV ====
const {
  WEBHOOK_TOKEN = 'u6eZrVh0rN1m2uU7yN3qQ0vT8pJ4aW9k',
  SENDGRID_API_KEY,
  SEND_FROM_EMAIL_RU = 'manager@raskat.rent',
  SENDGRID_TEMPLATE_ID_RU = 'd-cb881e00e3f04d1faa169fe4656fc844',
  SENDGRID_TEMPLATE_ID_REG_RU = 'd-cb881e00e3f04d1faa169fe4656fc844',
} = process.env;

if (sgMail && SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// ==== helpers ====
const first = (v) => (Array.isArray(v) ? v[0] : v);
const getAny = (obj, variants = []) => {
  const map = new Map(Object.keys(obj || {}).map(k => [k.toLowerCase(), obj[k]]));
  for (const v of variants) {
    const hit = map.get(String(v).toLowerCase());
    if (hit !== undefined && String(hit).trim() !== '') return String(first(hit)).trim();
  }
  return '';
};

// JSON-строка или x-www-form-urlencoded → объект
function asObject(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  const s = String(body);

  try { // JSON
    const j = JSON.parse(s);
    return Array.isArray(j) ? j[0] || {} : j;
  } catch {}

  try { // urlencoded
    const params = new URLSearchParams(s);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    return obj;
  } catch {}

  return {};
}

function ok(res, body = 'OK') {
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

// ==== handler ====
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return fail(res, 'method_not_allowed', 405);

    // Парсим body СРАЗУ — токен может лежать в POST
    const received = asObject(req.body);

    // Авторизация: body / query / header (любое из имён ниже подойдёт)
    const tokenFromBody =
      getAny(received, ['x-webhook-token', 'X-Webhook-Token', 'webhook_token', 'token', 'api_key']);

    const tokenFromQuery  = (req.query && req.query.token) || '';
    const tokenFromHeader = req.headers['x-webhook-token'] || '';

    const providedToken = String(tokenFromBody || tokenFromQuery || tokenFromHeader).trim();
    if (providedToken !== String(WEBHOOK_TOKEN)) return fail(res, 'unauthorized', 401);

    // Поля формы: берём только name и email (с разными системными именами)
    const name  = getAny(received, ['name','Name','fullname','fio','first_name','firstname']);
    const email = getAny(received, ['email','Email','e-mail','mail','client_email','email-1','email1']);

    // Honeypot
    const website = getAny(received, ['website','Website']);
    if (website) return ok(res);

    // Пустые проверки Тильды → просто OK, чтобы attach проходил
    if (!email) return ok(res);

    if (!sgMail || !SENDGRID_API_KEY) {
      console.warn('SendGrid not configured — skip sending');
      return ok(res);
    }

    const templateId = SENDGRID_TEMPLATE_ID_RU || SENDGRID_TEMPLATE_ID_REG_RU ||
      'd-cb881e00e3f04d1faa169fe4656fc844';

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
      const details = e?.response?.body ? JSON.stringify(e.response.body) : (e.message || 'sendgrid_error');
      return fail(res, details, 502);
    }

    return ok(res);
  } catch (err) {
    return fail(res, err, 500);
  }
};

// Явный runtime
module.exports.config = { runtime: 'nodejs18.x' };
