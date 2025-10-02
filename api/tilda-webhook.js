export default function handler(req, res) {
  const { token } = req.query;

  // Проверяем токен
  if (token !== "raskat_2025_secret") {
    return res.status(401).send("unauthorized");
  }

  // Проверяем метод
  if (req.method !== "POST") {
    return res.status(405).send("method_not_allowed");
  }

  // Данные из Тильды
  const data = req.body;

  console.log("Webhook received:", data);

  return res.status(200).json({ status: "ok", received: data });
}
