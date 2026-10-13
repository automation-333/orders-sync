// Мини-синхронизатор заявок: забирает /api/orders, нормализует телефоны,
// схлопывает дубли и отдаёт результат. Состояния нет: каждый запрос считает
// всё заново из источника, поэтому повторный запуск даёт тот же результат.

const SOURCE_URL = process.env.SOURCE_URL || "https://test.ooobs.ru/api/orders";

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 10) d = "7" + d;                       // 9991234567
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); // 89991234567
  if (d.length !== 11 || d[0] !== "7") return null;
  return "+" + d;
}

function toAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toTime(v) {
  const t = Date.parse(v);
  return Number.isNaN(t) ? -Infinity : t;
}

function build(orders) {
  const list = Array.isArray(orders) ? orders : (orders && orders.orders) || [];
  const byPhone = new Map();
  let invalid = 0;

  for (const o of list) {
    const phone = normalizePhone(o && o.phone);
    if (!phone) { invalid++; continue; }
    const rec = {
      name: typeof o.name === "string" ? o.name.trim() : (o.name ?? ""),
      phone,
      email: typeof o.email === "string" ? o.email.trim() : (o.email ?? ""),
      amount: toAmount(o.amount),
      _t: toTime(o.created_at),
      _id: o.id,
    };
    const cur = byPhone.get(phone);
    if (!cur || rec.amount > cur.amount || (rec.amount === cur.amount && rec._t > cur._t)) {
      byPhone.set(phone, rec);
    }
  }

  const clients = [...byPhone.values()]
    .sort((a, b) => a.phone.localeCompare(b.phone))
    .map(({ name, phone, email, amount }) => ({ name, phone, email, amount }));

  const valid = list.length - invalid;
  return {
    clients,
    stats: {
      received: list.length,
      unique: clients.length,
      duplicates_merged: valid - clients.length,
      invalid_dropped: invalid,
    },
  };
}

module.exports = async (req, res) => {
  try {
    const r = await fetch(SOURCE_URL, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("source returned " + r.status);
    const data = await r.json();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(JSON.stringify(build(data)));
  } catch (e) {
    res.status(502).json({ error: "cannot load orders", detail: String(e.message || e) });
  }
};
module.exports.build = build;
module.exports.normalizePhone = normalizePhone;
