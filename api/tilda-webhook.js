// api/tilda-webhook.js
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Укажи актуальный Template ID из SendGrid (GUID вида d-xxxx...)
const TEMPLATE_ID = process.env.SENDGRID_TEMPLATE_ID; // лучше хранить в Vercel → Env

const FROM_EMAIL = 'manager@raskat.rent';   // верифицированный sender
const MANAGER_CC = 'manager@raskat.rent';   // опционально: копия менеджеру
const TOKEN = 'raskat_2025_secret';          // тот, что в URL ?token=

/** Нормализуем ключ: lowerCase, без пробелов/подчёркиваний */
const norm = (s) => String(s).toLowerCase().replace(/[\s_]+/g, '');

const getter = (form) => {
  // строим быстрый индекс по нормализованному ключу
  const idx = {};
  for (const k of Object.keys(form || {})) idx[norm(k)] = form[k];

  return (...keys) => {
    for (const k of keys) {
      const v = idx[norm(k)];
      if (v !== undefined && v !== '') return v;
    }
    return '';
  };
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('method_not_allowed');
    }
    if (req.query.token !== TOKEN) {
      return res.status(401).send('unauthorized');
    }

    // Тильда шлёт formdata в `req.body` (x-www-form-urlencoded)
    const F = req.body || {};
    const g = getter(F);

    // --- Маппинг под твои реальные имена переменных в Тильде ---
    const first_name      = g('name', 'first_name');     // Имя (name)
    const last_name       = g('lastname', 'secondname'); // если добавишь в форме
    const email           = g('email');
    const phone           = g('phone');
    const comment         = g('comment', 'message');

    const date            = g('daterec', 'date');        // Дата аренды (daterec)
    const days            = g('Days', 'days');           // Кол-во суток (Days)
    const start_time      = g('Start_Time', 'start_time');
    const end_time        = g('End_time',  'end_time');
    const delivery_method = g('delivery', 'dostavka');   // Доставка (delivery)

    // Состав заказа:
    // 1) Если в настройках вебхука Тильды включишь «Передавать товары массивом» —
    //    придёт F.products как массив. Тогда сформируем items.
    let items = null;
    if (Array.isArray(F.products)) {
      items = F.products.map((p, i) => ({
        n: i + 1,
        title:       p.title || p.name || '',
        price_per_day: p.price || p.price_per_day || '',
        days:        p.days || days || '',
        sum:         p.amount || p.sum || ''
      }));
    }

    // 2) Если массив НЕ включён, у Тильды будет только HTML/текст в одном поле:
    const products_text = g('Products', 'products', 'goods', 'order');

    const total = g('total', 'price', 'sum', 'subtotal');

    // — опционально: лог всего, что пришло, чтобы видеть точные ключи —
    console.log('RAW TILDA BODY KEYS:', Object.keys(F));

    // Куда слать подтверждение клиенту
    const toClient = email || MANAGER_CC;

    // Собираем данные для шаблона SendGrid (используй те же {{placeholders}} в шаблоне)
    const dynamic_template_data = {
      first_name,
      last_name,
      email,
      phone,
      comment,
      date,
      days,
      start_time,
      end_time,
      delivery_method,
      products_text, // употребляется в {{products_text}} — когда нет массива
      total,
      items         // если не null, в шаблоне можно {{#each items}} ... {{/each}}
    };

    // Если используешь динамический шаблон в SendGrid — subject задаётся в самом шаблоне.
    const msg = {
      from: { email: FROM_EMAIL, name: 'RASKAT RENTAL' },
      to:   toClient,
      // можно добавить копию менеджеру:
      // cc: MANAGER_CC,
      template_id: TEMPLATE_ID,
      dynamic_template_data,
      // Чтобы «Ответить» шло менеджеру, а сам e-mail клиента попадал в Reply-To:
      reply_to: email ? { email, name: `${first_name || ''} ${last_name || ''}`.trim() } : undefined,
    };

    await sgMail.send(msg);

    res.setHeader('x-usetemplate', 'true');  // для твоих curl-проверок
    return res.status(200).send('ok');

  } catch (err) {
    console.error('sendgrid_error', err?.response?.body || err);
    res.status(500).send('error');
  }
}
