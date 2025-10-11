// api/tilda-registration-ru.js
// Мини-вебхук регистрации: Tilda → SendGrid (только name + email), авторизация по ?token= или X-Webhook-Token

let sgMail = null;
try {
  sgMail = require('@sendgrid/mail'); // если пакета нет — не упадём, но письма не уйдут
} catch (e) {
  console.warn('SendGrid SDK not installed; email sending will be skipped.');
}

// ==== ENV ====
const {
  // токен авторизации (как в старых рабочих вебхуках): ?token=...
  WEBHOOK_TOKEN = 'raskat_2025_secret',

  // SendGrid
  SENDGRID_API_KEY,
  SEND_FROM_EMAIL_RU = 'manager@raskat.rent',

  // ID динамического шаблона (можно задать любой из них; если оба пустые — возьмём дефолт ниже)
  SENDGRID_TEMPLATE_ID_RU = 'd-cb881e00e3f04d1faa169fe4656fc844',
  SENDGRID_TEMPLATE_ID_REG_RU = 'd-cb881e00e3f04d1faa169fe4656fc844',
} = process.env;

if (sgMail && SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// ==== helpers ====
const first = (v) => (Array.isArray(v) ? v[0] : v);

// вытянуть значение по любому из вариантов ключей (без регистра)
const getAny = (obj, variants = []) => {
  const map = new Map(Object.keys(obj || {}).map(k => [k.toLowerCase(), obj[k]]));
  for (const v of variants) {
    const hit = map.get(String(v).toLowerCase());
    if (hit !== undefined && String(hit).trim() !== '') return String(first(hit)).trim();
  }
  return '';
};

// принять JSON-строку или x-www-form-urlencoded → объект
function asObject(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  const s = String(body);

  // 1) JSON?
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? j[0] || {} : j;
  } catch {}

  // 2) urlencoded: a=1&b=2
  try {
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

    // Авторизация: поддерживаем ?token=... и заголовок X-Webhook-Token
    const tokenFromQuery = (req.query && req.query.token) || '';
    const tokenFromHeader = req.headers['x-webhook-token'] || '';
    const providedToken = String(tokenFromQuery || tokenFromHeader).trim();
    if (providedToken !== String(WEBHOOK_TOKEN)) return fail(res, 'unauthorized', 401);

    // Парсим тело
    const received = asObject(req.body);

    // Поля формы: берём только name и email (поддерживаем разные системные имена)
    const name  = getAny(received, ['name','Name','fullname','fio','first_name','firstname']);
    const email = getAny(received, ['email','Email','e-mail','mail','client_email','email-1','email1']);

    // Honeypot — если скрытое поле заполнено, просто говорим OK
    const website = getAny(received, ['website','Website']);
    if (website) return ok(res);

    // Важно: Tilda при “Проверить Webhook” часто шлёт пустой POST без полей → вернём OK,
    // чтобы URL прикрепился. Реальная отправка уже будет с email, и письмо уйдёт.
    if (!email) return ok(res);

    // Если SendGrid не сконфигурирован — не падаем; для attach это достаточно
    if (!sgMail || !SENDGRID_API_KEY) {
      console.warn('SendGrid not configured — skip sending');
      return ok(res);
    }

    // Определяем шаблон: ENV -> дефолт (ваш новый ID)
    const templateId =
      SENDGRID_TEMPLATE_ID_RU ||
      SENDGRID_TEMPLATE_ID_REG_RU ||
      'd-cb881e00e3f04d1faa169fe4656fc844'; // новый ID, который вы дали

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
      // Вернём текст ошибки наружу (удобно видеть в Tilda сразу причину)
      const msg = e?.response?.body ? JSON.stringify(e.response.body) : (e.message || 'sendgrid_error');
      return fail(res, msg, 502);
    }

    return ok(res);
  } catch (err) {
    return fail(res, err, 500);
  }
};

// Явно укажем Node runtime
module.exports.config = { runtime: 'nodejs18.x' };
