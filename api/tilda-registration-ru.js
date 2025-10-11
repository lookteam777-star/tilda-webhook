// api/tilda-registration-ru.js
// Tilda → SendGrid (только name + email), многоязычно по токенам RU/EN/SR.
// Авторизация принимает token из BODY (POST), Header (X-Webhook-Token) или Query (?token=).

let sgMail = null;
try { sgMail = require('@sendgrid/mail'); } catch { console.warn('SendGrid SDK not installed; emails will be skipped.'); }

// ===== ENV =====
const {
  // Токены
  WEBHOOK_TOKEN,         // старый общий (опционально)
  WEBHOOK_TOKEN_RU,      // RU
  WEBHOOK_TOKEN_EN,      // EN
  WEBHOOK_TOKEN_SR,      // SR

  // SendGrid
  SENDGRID_API_KEY,
  SEND_FROM_EMAIL_RU = 'manager@raskat.rent',

  // Шаблоны
  SENDGRID_TEMPLATE_ID_RU = 'd-cb881e00e3f04d1faa169fe4656fc844',
  SENDGRID_TEMPLATE_ID_EN,
  SENDGRID_TEMPLATE_ID_SR,
} = process.env;

if (sgMail && SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

// ===== helpers =====
const first = (v) => (Array.isArray(v) ? v[0] : v);
const getAny = (obj, variants=[]) => {
  const map = new Map(Object.keys(obj || {}).map(k => [k.toLowerCase(), obj[k]]));
  for (const v of variants) {
    const hit = map.get(String(v).toLowerCase());
    if (hit !== undefined && String(hit).trim() !== '') return String(first(hit)).trim();
  }
  return '';
};
function asObject(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  const s = String(body);
  try { const j = JSON.parse(s); return Array.isArray(j) ? (j[0] || {}) : j; } catch {}
  try { const p = new URLSearchParams(s); const o = {}; for (const [k,v] of p) o[k]=v; return o; } catch {}
  return {};
}
const ok   = (res, body='OK') => { res.setHeader('Cache-Control','no-store'); res.status(200).send(body); };
const fail = (res, err, status=500) => { const msg = typeof err==='string'? err : (err?.message || 'server_error'); console.error('WEBHOOK_ERROR:', err?.stack || msg); res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','text/plain; charset=utf-8'); res.status(status).send(msg); };

// ===== handler =====
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return fail(res, 'method_not_allowed', 405);

    // 1) парсим тело сразу (токен может быть в BODY)
    const received = asObject(req.body);

    // 2) собираем токен из body/header/query
    const tokenBody   = getAny(received, ['x-webhook-token','X-Webhook-Token','webhook_token','token','api_key']);
    const tokenQuery  = (req.query && req.query.token) || '';
    const tokenHeader = req.headers['x-webhook-token'] || '';
    const provided    = String(tokenBody || tokenQuery || tokenHeader).trim();

    // 3) определяем локаль по токену
    let locale = null;
    if (provided && WEBHOOK_TOKEN_RU && provided === WEBHOOK_TOKEN_RU) locale = 'ru';
    if (provided && WEBHOOK_TOKEN_EN && provided === WEBHOOK_TOKEN_EN) locale = 'en';
    if (provided && WEBHOOK_TOKEN_SR && provided === WEBHOOK_TOKEN_SR) locale = 'sr';
    // совместимость со старым общим токеном
    if (!locale && WEBHOOK_TOKEN && provided === WEBHOOK_TOKEN) locale = 'ru';

    if (!locale) return fail(res, 'unauthorized', 401);

    // 4) поля формы
    const name   = getAny(received, ['name','Name','fullname','fio','first_name','firstname']);
    const email  = getAny(received, ['email','Email','e-mail','mail','client_email','email-1','email1']);
    const website= getAny(received, ['website','Website']); // honeypot

    const mask = (s)=> (s ? s.replace(/(.).+(@.*)/,'$1***$2') : '');
    console.log('[registration]', { locale, hasEmail: !!email, email: mask(email), keys: Object.keys(received||{}) });

    // Пустые проверки Тильды / honeypot — просто OK
    if (website) return ok(res);
    if (!email)  return ok(res);

    // 5) отправка
    if (!sgMail || !SENDGRID_API_KEY) { console.warn('SendGrid not configured — skip sending'); return ok(res); }

    // карта шаблонов по языкам
    const templates = {
      ru: SENDGRID_TEMPLATE_ID_RU || 'd-cb881e00e3f04d1faa169fe4656fc844',
      en: SENDGRID_TEMPLATE_ID_EN || SENDGRID_TEMPLATE_ID_RU,
      sr: SENDGRID_TEMPLATE_ID_SR || SENDGRID_TEMPLATE_ID_RU
    };
    const templateId = templates[locale] || templates.ru;

    const defaultName = locale === 'en' ? 'customer' : (locale === 'sr' ? 'klijent' : 'клиент');

    const msg = {
      to: email,
      from:   { email: SEND_FROM_EMAIL_RU, name: 'RASKAT RENTAL' },
      replyTo:{ email: SEND_FROM_EMAIL_RU, name: 'RASKAT RENTAL' },
      templateId,
      dynamicTemplateData: { name: name || defaultName, year: new Date().getFullYear() },
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

module.exports.config = { runtime: 'nodejs18.x' };
