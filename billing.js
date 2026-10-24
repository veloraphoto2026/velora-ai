const { randomUUID } = require('node:crypto');

function rubles(kopeks) { return Math.floor(kopeks / 100) + '.' + String(kopeks % 100).padStart(2, '0'); }
function kopeks(value) {
  if (!/^\d+\.\d{2}$/.test(value || '')) return null;
  const amount = Number(value.replace('.', ''));
  return Number.isSafeInteger(amount) ? amount : null;
}

async function initBilling(pool) {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_credits INTEGER NOT NULL DEFAULT 0 CHECK (paid_credits >= 0)');
  await pool.query(`CREATE TABLE IF NOT EXISTS billing_orders (
    id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), request_key UUID NOT NULL,
    amount_total INTEGER NOT NULL CHECK (amount_total > 0), test_mode BOOLEAN NOT NULL,
    provider_payment_id TEXT UNIQUE, checkout_url TEXT, credited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (user_id,request_key)
  )`);
}

function billingFromEnv(env) {
  if (env.PAYMENTS_ENABLED !== 'true') return null;
  if (env.PAYMENT_PROVIDER !== 'yookassa') throw new Error('The explicitly selected payment provider must be yookassa');
  const amount = Number(env.PAID_GENERATION_PRICE_KOPEKS);
  const origin = new URL(env.PUBLIC_APP_URL);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000 ||
      !['test', 'live'].includes(env.PAYMENTS_MODE) || origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash || !env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY) {
    throw new Error('Incomplete payment configuration; payments remain unavailable');
  }
  if (env.NODE_ENV === 'production' && env.ENABLE_GENERATION === 'true' && env.PAYMENTS_MODE === 'test') {
    throw new Error('Test payments cannot fund production generation');
  }
  const authorization = 'Basic ' + Buffer.from(env.YOOKASSA_SHOP_ID + ':' + env.YOOKASSA_SECRET_KEY).toString('base64');
  const request = async (path, method = 'GET', body, key) => {
    const response = await fetch('https://api.yookassa.ru/v3' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: authorization, 'Content-Type': 'application/json', ...(key ? { 'Idempotence-Key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error('Payment provider request failed');
    return response.json();
  };
  return { amount, currency: 'RUB', origin: origin.origin, testMode: env.PAYMENTS_MODE === 'test',
    client: { createPayment: (body, key) => request('/payments', 'POST', body, key),
      getPayment: id => request('/payments/' + encodeURIComponent(id)) } };
}

function matches(payment, order) {
  return payment.id === order.provider_payment_id && payment.amount?.currency === 'RUB' &&
    kopeks(payment.amount?.value) === order.amount_total && payment.test === order.test_mode &&
    payment.metadata?.application === 'velora-ai' && payment.metadata?.order_id === order.id;
}

async function confirmOrder(pool, billing, found) {
  if (found.credited_at) return true;
  const payment = await billing.client.getPayment(found.provider_payment_id);
  if (!matches(payment, found)) throw new Error('Payment does not match order');
  if (payment.status !== 'succeeded' || payment.paid !== true) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await client.query('SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE', [found.id])).rows[0];
    if (!order.credited_at) {
      await client.query('UPDATE users SET paid_credits=paid_credits+1 WHERE id=$1', [order.user_id]);
      await client.query('UPDATE billing_orders SET credited_at=NOW() WHERE id=$1', [order.id]);
    }
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

function webhookHandler(pool, billing) {
  return async (req, res) => {
    if (!billing) return res.status(503).json({ success: false, error: 'Оплата пока не подключена' });
    let notification;
    try { notification = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).json({ success: false, error: 'Некорректное уведомление' }); }
    if (notification.type !== 'notification' || notification.event !== 'payment.succeeded') return res.json({ received: true });
    const id = notification.object?.id;
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) return res.status(400).json({ success: false });
    try {
      const found = (await pool.query('SELECT * FROM billing_orders WHERE provider_payment_id=$1', [id])).rows[0];
      if (!found || found.credited_at) return res.json({ received: true });
      // Notification bodies are untrusted; only authenticated YooKassa API can authorize credits.
      const confirmed = await confirmOrder(pool, billing, found);
      return res.status(confirmed ? 200 : 503).json({ received: confirmed });
    } catch { return res.status(503).json({ success: false, error: 'Подтверждение платежа временно недоступно' }); }
  };
}

function mountBilling(app, pool, billing, authenticate) {
  app.get('/api/billing', authenticate, async (req, res) => {
    try {
      let lastOrderPaid = false;
      if (req.query.request_key && /^[0-9a-f-]{36}$/i.test(req.query.request_key)) {
        const {rows} = await pool.query('SELECT credited_at FROM billing_orders WHERE user_id=$1 AND request_key=$2', [req.userId, req.query.request_key]);
        lastOrderPaid = Boolean(rows[0]?.credited_at);
      }
      return res.json({ success: true, enabled: Boolean(billing), last_order_paid: lastOrderPaid,
        ...(billing ? { provider: 'yookassa', amount: billing.amount, currency: 'RUB', test_mode: billing.testMode, generations: 1 } : {}) });
    } catch { return res.status(503).json({ success: false, error: 'Баланс оплаты временно недоступен' }); }
  });
  app.post('/api/billing/reconcile', authenticate, async (req, res) => {
    if (!billing) return res.status(503).json({success:false,error:'Оплата пока не подключена'});
    const key = req.body?.request_key;
    if (!/^[0-9a-f-]{36}$/i.test(key || '')) return res.status(400).json({success:false});
    try {
      const order = (await pool.query('SELECT * FROM billing_orders WHERE user_id=$1 AND request_key=$2', [req.userId,key])).rows[0];
      if (!order || !order.provider_payment_id) return res.status(404).json({success:false});
      const credited = await confirmOrder(pool,billing,order);
      return res.json({success:true,credited});
    } catch { return res.status(503).json({success:false,error:'Подтверждение оплаты пока недоступно'}); }
  });
  app.post('/api/billing/checkout', authenticate, async (req, res) => {
    if (!billing) return res.status(503).json({ success: false, error: 'Оплата пока не подключена. Списаний нет' });
    const key = req.get('idempotency-key');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '')) {
      return res.status(400).json({ success: false, error: 'Нужен уникальный ключ запроса оплаты' });
    }
    try {
      await pool.query(`INSERT INTO billing_orders (id,user_id,request_key,amount_total,test_mode)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,request_key) DO NOTHING`,
      [randomUUID(), req.userId, key, billing.amount, billing.testMode]);
      const order = (await pool.query('SELECT * FROM billing_orders WHERE user_id=$1 AND request_key=$2', [req.userId, key])).rows[0];
      if (order.credited_at) return res.status(409).json({ success: false, error: 'Этот заказ уже оплачен' });
      if (order.checkout_url) return res.json({ success: true, url: order.checkout_url });
      const payment = await billing.client.createPayment({
        amount: { value: rubles(order.amount_total), currency: 'RUB' }, capture: true,
        confirmation: { type: 'redirect', return_url: billing.origin + '/?payment=return' },
        description: 'Velora AI: 1 генерация фотографии', metadata: { application: 'velora-ai', order_id: order.id }
      }, order.id);
      const url = new URL(payment.confirmation?.confirmation_url);
      if (url.protocol !== 'https:' || !['yoomoney.ru', 'yookassa.ru'].includes(url.hostname) || url.username || url.password ||
          !/^[0-9a-f-]{36}$/i.test(payment.id || '') || payment.test !== order.test_mode ||
          kopeks(payment.amount?.value) !== order.amount_total || payment.amount?.currency !== 'RUB') throw new Error('Invalid checkout');
      await pool.query('UPDATE billing_orders SET provider_payment_id=$1,checkout_url=$2 WHERE id=$3', [payment.id, url.href, order.id]);
      return res.json({ success: true, url: url.href });
    } catch {
      return res.status(503).json({ success: false, error: 'Не удалось открыть оплату. Попробуйте повторить запрос' });
    }
  });
}
module.exports = { initBilling, billingFromEnv, webhookHandler, mountBilling, rubles, kopeks };
