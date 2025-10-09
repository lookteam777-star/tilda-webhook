// api/tilda-debug.js
export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

function toObject(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    // Тильда чаще всего шлёт x-www-form-urlencoded
    // но на всякий случай парсим JSON, если пришёл
    return JSON.parse(body);
  } catch {
    // Преобразуем form-urlencoded в объект
    return Object.fromEntries(
      String(body)
        .split('&')
        .map((pair) => pair.split('=').map(decodeURIComponent))
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // (Опционально) токен, чтобы не светить публично
  const ok = req.query.token === 'raskat_2025_secret';
  if (!ok) return res.status(401).json({ error: 'unauthorized' });

  const src = toObject(req.body);

  // Нормализация ключей: создаём удобные алиасы
  const pick = (...keys) => {
    for (const k of keys) {
      if (src[k] != null && String(src[k]).trim() !== '') return String(src[k]).trim();
    }
    return '';
  };

  const normalized = {
    // контакты
    email:       pick('email','Email','E-mail','mail'),
    phone:       pick('phone','Телефон','Phone','phone_number'),
    first_name:  pick('name','first_name','Имя','Ваше Имя*','Ваше имя','Ваше Имя'),
    last_name:   pick('last_name','Фамилия','Surname','Last Name'),

    // даты/время
    date:        pick('daterec','date','Дата аренды','Дата'),
    days:        pick('Days','days','Кол-во суток','Срок (дней)'),
    start_time:  pick('Start_Time','StartTime','start_time','Время начала аренды*','Начало'),
    end_time:    pick('End_time','EndTime','end_time','Время конца аренды','Конец'),

    // доставка
    delivery_method: pick('delivery','Доставка','Delivery','Способ доставки'),

    // товары/итог
    products_text:   pick('Products','products','Состав заказа','Товары'),
    total:           pick('Price','Subtotal','Итого','Total'),

    // прочее
    comment:    pick('comment','Комментарий','message','Сообщение'),
    source_ip:  req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    user_agent: req.headers['user-agent'] || '',
  };

  // Выводим всё, что пришло, + нормализованную версию
  return res.status(200).json({
    received: src,                 // сырые поля Тильды (как есть)
    normalized,                    // удобные алиасы для шаблона
    hint: "Смотри ключи в 'received'. Если нужного поля нет в 'normalized' — добавь его в pick().",
  });
}
