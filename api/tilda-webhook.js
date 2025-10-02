export default function handler(req, res) {
  const { token } = req.query;

  // 🔑 Проверка токена
  if (token !== "raskat_2025_secret") {
    return res.status(401).send("unauthorized");
  }

  // Разрешаем только POST
  if (req.method !== "POST") {
    return res.status(405).send("method_not_allowed");
  }

  // Получаем данные от Tilda
  const data = req.body;

  // Логируем для проверки (увидишь в Vercel → Logs)
  console.log("Tilda Webhook Data:", data);

  // Отправляем ответ
  res.status(200).json({
    success: true,
    received: data
  });
}
