// pages/api/tilda-debug.js
/**
 * ВЕРСИЯ: Debug endpoint для заявок из Тильды
 * - Показывает "как есть" (received)
 * - Добавляет удобные метаданные (ip, userAgent, contentType)
 * - Пытается привести ключи к читаемому виду (normalized), НО ничего не выдумывает
 * - Все данные дублирует в логи Vercel (console.log)
 *
 * Подключение в Тильде:
 *   https://<ваш-домен>.vercel.app/api/tilda-debug?token=raskat_2025_secret
 */

export const config = {
  api: {
    bodyParser: true, // разбирает x-www-form-urlencoded и json (по умолчанию — да)
  },
};

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

// Мягкий геттер: вернет значение по любому из вариантов ключей (с учетом регистра и без)
function getAny(obj, variants = []) {
  const map = new Map(
    Object.keys(obj || {}).map((k) => [k.toLowerCase(), obj[k]]),
  );
  for (const v of variants) {
    const hit = map.get(String(v).toLowerCase());
    if (hit !== undefined) return first(hit);
  }
  return '';
}

export default async function handler(req, res) {
  // ===== 0) Безопасность (опционально): токен в query =====
  const REQUIRED_TOKEN = 'raskat_2025_secret'; // поменяй при необходимости
  const incomingToken = (req.query?.token || '').toString();
  if (!incomingToken || incomingToken !== REQUIRED_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ===== 1) Разрешаем только POST и GET (GET вернет подсказку) =====
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).end(
      JSON.stringify(
        {
          ok: true,
          how_to_use:
            'Отправь POST из Тильды сюда. Ответ покажет все поля как они пришли (received).',
          example_curl: `curl -X POST "https://${req.headers.host}/api/tilda-debug?token=${REQUIRED_TOKEN}" -H "Content-Type: application/x-www-form-urlencoded" --data "name=Ivan&email=ivan@example.com&Days=2&Start_Time=10:00&End_time=15:00&daterec=10.10.2025&delivery=Самовывоз&Products=FX3&Price=120 EUR&comment=Тест"`,
        },
        null,
        2,
      ),
    );
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  // ===== 2) Метаданные запроса =====
  const contentType = req.headers['content-type'] || '';
  const ip =
    (req.headers['x-forwarded-for'] || '')
      .toString()
      .split(',')[0]
      .trim() || req.socket?.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';

  // ===== 3) Что реально прислала Тильда =====
  // Next bodyParser уже распарсит x-www-form-urlencoded и JSON в req.body
  const received = req.body && typeof req.body === 'object' ? req.body : {};

  // ===== 4) Мягкая нормализация (для удобного чтения) =====
  // Ничего не "придумываем": только берём известные поля, если они есть
  const normalized = {
    // имена могут отличаться от формы к форме — ниже самые частые варианты:
    name: getAny(received, ['name', 'first_name', 'firstname']),
    last_name: getAny(received, ['last_name', 'lastname', 'surname']),
    email: getAny(received, ['email', 'mail']),
    phone: getAny(received, ['phone', 'tel', 'phone_number']),

    date: getAny(received, ['daterec', 'date', 'Дата аренды*']),
    days: getAny(received, ['days', 'Days', 'Кол-во суток']),
    start_time: getAny(received, ['start_time', 'Start_Time', 'Время начала аренды*']),
    end_time: getAny(received, ['end_time', 'End_time', 'Время конца аренды']),

    delivery_method: getAny(received, ['delivery', 'Доставка']),
    products_text: getAny(received, ['Products', 'products', 'Состав заказа']),
    total: getAny(received, ['Price', 'total', 'Итого']),
    comment: getAny(received, ['comment', 'Комментарий', 'message']),
  };

  const payload = {
    meta: { ip, userAgent, contentType, now: new Date().toISOString() },
    received, // всё как пришло
    normalized, // удобно читать
    hint:
      "Смотри ключи в 'received'. Если нужного поля нет в 'normalized', добавь его название в getAny(...). Поле 'received' — источник правды.",
  };

  // ===== 5) Логи Vercel =====
  console.log('🟢 /api/tilda-debug payload:\n', JSON.stringify(payload, null, 2));

  // ===== 6) Ответ =====
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).end(JSON.stringify(payload, null, 2));
}
