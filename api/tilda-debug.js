// api/tilda-debug.js (CommonJS)

module.exports = async (req, res) => {
  const REQUIRED_TOKEN = 'raskat_2025_secret';

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      how_to_use: 'Отправь POST из Тильды сюда с ?token=...',
      example: `curl -X POST "https://${req.headers.host}/api/tilda-debug?token=${REQUIRED_TOKEN}" -H "Content-Type: application/x-www-form-urlencoded" --data "name=Ivan&email=ivan@example.com&Days=2&Start_Time=10:00&End_time=15:00&daterec=10.10.2025&delivery=Самовывоз&Products=FX3&Price=120 EUR&comment=Тест"`
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });
  if ((req.query?.token || '') !== REQUIRED_TOKEN) return res.status(401).json({ error: 'unauthorized' });

  const received = (req.body && typeof req.body === 'object') ? req.body : {};

  const lower = new Map(Object.keys(received).map(k => [k.toLowerCase(), received[k]]));
  const get = (...keys) => {
    for (const k of keys) {
      const v = lower.get(String(k).toLowerCase());
      if (v !== undefined && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  const normalized = {
    name: get('name', 'first_name'),
    last_name: get('last_name', 'surname'),
    email: get('email', 'e-mail'),
    phone: get('phone', 'tel'),
    date: get('daterec', 'date'),
    days: get('days', 'Days'),
    start_time: get('start_time', 'Start_Time'),
    end_time: get('end_time', 'End_time'),
    delivery_method: get('delivery', 'Доставка'),
    products_text: get('products', 'Products', 'Состав заказа'),
    total: get('price', 'total', 'subtotal', 'Итого'),
    comment: get('comment', 'message'),
    payment_raw: received.payment || ''
  };

  // Попробуем распарсить payment, чтобы увидеть товары
  let paymentParsed = null;
  try { paymentParsed = received.payment ? JSON.parse(received.payment) : null; } catch {}
  if (paymentParsed) {
    normalized.payment_products = paymentParsed.products || [];
    normalized.payment_amount = paymentParsed.amount ?? paymentParsed.subtotal ?? '';
    normalized.payment_delivery = paymentParsed.delivery ?? '';
  }

  const payload = {
    meta: {
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      userAgent: req.headers['user-agent'] || '',
      contentType: req.headers['content-type'] || '',
      now: new Date().toISOString()
    },
    received,
    normalized,
    hint: "Смотри ключи в 'received'. Если нужного поля нет в 'normalized', добавь новый ключ в get(...)."
  };

  console.log('🟢 /api/tilda-debug payload:\n', JSON.stringify(payload, null, 2));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).end(JSON.stringify(payload, null, 2));
};

module.exports.config = { runtime: 'nodejs18.x' };
