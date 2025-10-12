// api/tilda-registration-ru.js
// Tilda → SendGrid (только name + email), многоязычно (RU/EN/SR) по токенам.
// Авторизация: token из BODY (POST), Header (X-Webhook-Token) или Query (?token=).

let sgMail = null;
try { sgMail = require('@sendgrid/mail'); }
catch { console.warn('SendGrid SDK not installed; emails will be skipped.'); }

/* ===================== ENV + Aliases ===================== */
// SendGrid API key
const SG_API_KEY =
  process.env.SENDGRID_API_KEY ||
  process.env.SG_API_KEY; // на всякий случай

// From
const FROM_EMAIL =
  process.env.SEND_FROM_EMAIL_RU ||
  process.env.FROM_EMAIL ||
  'manager@raskat.rent';
const FROM_NAME =
  process.env.FROM_NAME ||
  'RASKAT RENTAL';

// Токены (поддерживаем TOKEN_* и SECRET_*)
const TOK_RU =
  process.env.WEBHOOK_TOKEN_RU  ||
  process.env.WEBHOOK_SECRET_RU ||
  process.env.WEBHOOK_TOKEN; // общий старый — как RU

const TOK_EN =
  process.env.WEBHOOK_TOKEN_EN  ||
  process.env.WEBHOOK_SECRET_EN;

const TOK_SR =
  process.env.WEBHOOK_TOKEN_SR  ||
  process.env.WEBHOOK_SECRET_SR;

// ID динамических шаблонов (поддерживаем *_REG_*)
const TPL_RU =
  process.env.SENDGRID_TEMPLATE_ID_RU      ||
  process.env.SENDGRID_TEMPLATE_ID_REG_RU  ||
  'd-cb881e00e3f04d1faa169fe4656fc844';

const TPL_EN =
  process.env.SENDGRID_TEMPLATE_ID_EN      ||
  process.env.SENDGRID_TEMPLATE_ID_REG_EN  ||
  TPL_RU;

const TPL_SR =
  process.env.SENDGRID_TEMPLATE_ID_SR      ||
  process.env.SENDGRID_TEMPLATE_ID_REG_SR  ||
  TPL_RU;

if (sgMail && SG_API_KEY) sgMail.setApiKey(SG_API_KEY);

/* ===================== helpers ===================== */
const first = (v) => (Array.isArray(v) ? v[0] : v);

const getAny = (obj, variants = []) => {
  const map = new Map(Object.keys(obj || {}).map(k => [k.toLowerCase(), obj[k]]));
  for (const key of variants) {
    const hit = map.get(String(key).toLowerCase());
    if (hit !== undefined && String(hit).trim() !== '') return String(first(hit)).trim();
  }
  return '';
};

function asObject(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;

  const s = String(body);

  // JSON
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? (j[0] || {}) : j;
  } catch {}

  // x-www-form-urlencoded
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

/* ===================== handler ===================== */
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return fail(res, 'method_not_allowed', 405);

    // Парсим тело (токен может быть в POST)
    const received = asObject(req.body);

    // Токен из body/header/query
    const tokenBody   = getAny(received, ['x-webhook-token','X-Webhook-Token','webhook_token','token','api_key']);
    const tokenHeader = req.headers['x-webhook-token'] || '';
    const tokenQuery  = (req.query && req.query.token) || '';
    const providedToken = String(tokenBody || tokenHeader || tokenQuery).trim();

    // Определение локали по токену
    let locale = null;
    if (providedToken && providedToken === TOK_RU) locale = 'ru';
    if (providedToken && providedToken === TOK_EN) locale = 'en';
    if (providedToken && providedToken === TOK_SR) locale = 'sr';

    if (!locale) return fail(res, 'unauthorized', 401);

    // Поля формы
    const name  = getAny(received, ['name','Name','fullname','fio','first_name','firstname']);
    const email = getAny(received, ['email','Email','e-mail','mail','client_email','email-1','email1']);
    const website = getAny(received, ['website','Website']); // honeypot

    const mask = (s) => (s ? s.replace(/(.).+(@.*)/, '$1***$2') : '');
    console.log('[registration]', {
      locale, hasEmail: !!email, email: mask(email),
      keys: Object.keys(received || {})
    });

    // Отладочный echo-режим: ?echo=1
    if (String(req.query?.echo || '') === '1') {
      return res.status(200).json({ locale, parsed: { name, email }, raw: received });
    }

    // Бот / пустые проверки из Tilda → OK
    if (website) return ok(res);
    if (!email)  return ok(res);

    // Если SendGrid не настроен — не падаем
    if (!sgMail || !SG_API_KEY) {
      console.warn('SendGrid not configured — skip sending');
      return ok(res);
    }

    // Шаблон и дефолтное имя по языку
    const templateId = locale === 'en' ? TPL_EN : (locale === 'sr' ? TPL_SR : TPL_RU);
    const defaultName = locale === 'en' ? 'customer' : (locale === 'sr' ? 'klijent' : 'клиент');

    const msg = {
      to: email,
      from:   { email: FROM_EMAIL, name: FROM_NAME },
      replyTo:{ email: FROM_EMAIL, name: FROM_NAME },
      templateId,
      dynamicTemplateData: {
        name: name || defaultName,
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
