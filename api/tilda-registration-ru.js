// Вебхук Tilda → SendGrid (RU). Извлекаем ТОЛЬКО name и email максимально надёжно.

const SG_URL = 'https://api.sendgrid.com/v3/mail/send';

// --- утилиты поиска значения по «похожим» ключам ---
const EMAIL_RX = /(^|\b)email(\d+)?($|\b)/i;
const NAME_RX  = /(^|\b)(name|fullname|fio)($|\b)/i;
const HONEYPOT_RX = /(^|\b)website($|\b)/i;

// ищем в массиве вида [{name,value}] или [{key,val}] с "похожими" именами
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

// ищем по объекту: перебираем ВСЕ ключи и берём первый, чьё имя подходит по regex
function findInObject(obj, rx) {
  if (!obj || typeof obj !== 'object') return '';
  for (const [k, v] of Object.entries(obj)) {
    if (rx.test(k) && `${v ?? ''}`.trim() !== '') return `${v}`.trim();
  }
  return '';
}

// глубокий поиск: обходим произвольную структуру (объекты/массивы) и пытаемся вытащить по regex
function deepFind(node, rx) {
  if (!node) return '';
  // прямое совпадение в объекте
  const direct = findInObject(node, rx);
  if (direct) return direct;

  // массив пар?
  const kv = findInKVArray(node, rx);
  if (kv) return kv;

  // известные контейнеры tilda
  const containers = [node?.data, node?.formdata, node?.fields, node?.form];
  for (const c of containers) {
    const fromContainer = deepFind(c, rx);
    if (fromContainer) return fromContainer;
  }

  // обычные вложенные структуры
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

// нормализуем body из Tilda (string | array | object)
function normalizeBody(req) {
  let raw = req.body;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  // Tilda часто шлёт массив с одним объектом
  const base = Array.isArray(raw) ? raw[0] : (raw || {});
  return base;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    // auth по секрету
    const q = req.query || {};
    const provided =
      (q.secret || q.token || '').toString().trim() ||
      (req.headers['x-webhook-secret'] || '').toString().trim();
    const expected = process.env.WEBHOOK_SECRET_RU;
    if (!expected) return res.status(500).send('Missing WEBHOOK_SECRET_RU env');
    if (!provided) return res.status(401).send('Unauthorized: no secret');
    if (provided !== expected) return res.status(401).send('Unauthorized: bad secret');

    const debug = (q.debug || '') === '1';
    const isCheck = (q.check || '') === '1';
    const echo = (q.echo || '') === '1';

    const base = normalizeBody(req);

    // honeypot (если вдруг Tilda/браузер что-то подставил — письмо не шлём)
    const honeypot =
      deepFind(base, HONEYPOT_RX);
    if (honeypot) return res.status(200).send('OK');

    // достаём email / name из любых мест
    const email = deepFind(base, EMAIL_RX);
    const name  = deepFind(base, NAME_RX);

    if (echo) {
      return res.status(200).json({ parsed: { name, email }, raw: base });
    }

    if (!email && isCheck) return res.status(200).send('OK');
    if (!email) return res.status(400).send('Missing email');

    // env
    const API_KEY    = process.env.SENDGRID_API_KEY;
    const FROM_EMAIL = process.env.SEND_FROM_EMAIL_RU || 'manager@raskat.rent';
    const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID_REG_RU || 'd-cb881e00e3f04d1faa169fe4656fc84';
    if (!API_KEY) return res.status(500).send('Missing SENDGRID_API_KEY env');

    // отправляем только name/email
    const sgPayload = {
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
