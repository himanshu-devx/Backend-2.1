import 'dotenv/config';
import crypto from 'crypto';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

const API = process.env.API_BASE || 'http://localhost:4000';
const PAYMENT = process.env.PAYMENT_BASE || 'http://localhost:3000';

const adminPassword = 'Admin#12345';
const merchantPassword = 'Merchant#12345';
const deviceId = 'e2e-device-1';

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, url, { headers = {}, body, rawBody } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  } else if (rawBody !== undefined) {
    init.body = rawBody;
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, text };
}

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function getResetToken(redis, kind, email) {
  const keys = await redis.keys(`reset-password:${kind}:*`);
  for (const key of keys) {
    const val = await redis.get(key);
    if (val === email) return key.split(':').pop();
  }
  return null;
}

async function getOtp(redis, kind, email) {
  return redis.get(`otp:${kind}:${email}`);
}

async function run() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db(process.env.MONGO_DB_NAME || 'smartFintech');

  // Health checks
  {
    const r1 = await request('GET', `${API}/health`);
    record('health-api', r1.status === 200, r1.status);
    const r2 = await request('GET', `${PAYMENT}/health`);
    record('health-payment', r2.status === 200, r2.status);
  }

  // Admin bootstrap
  let adminEmail = `admin+${Date.now()}@test.local`;
  {
    const r = await request('POST', `${API}/api/auth/admin/create-super-admin`, {
      body: { name: 'Test Super Admin', email: adminEmail }
    });
    if (r.data?.success) {
      record('admin-create-super', true, r.status);
    } else if (r.data?.error?.message?.includes('Super Admin already exists')) {
      record('admin-create-super', true, 'already-exists');
      const existing = await db.collection('admins').findOne({});
      if (!existing?.email) {
        record('admin-existing-email', false, 'no admin found in db');
        throw new Error('No admin in db');
      }
      adminEmail = existing.email;
    } else {
      record('admin-create-super', false, r.text);
    }

    await request('POST', `${API}/api/auth/admin/forgot-password`, {
      body: { email: adminEmail }
    });
    const resetToken = await getResetToken(redis, 'admin', adminEmail);
    if (!resetToken) throw new Error('Admin reset token not found');
    const r2 = await request('POST', `${API}/api/auth/admin/confirm-reset-password`, {
      body: { token: resetToken, newPassword: adminPassword }
    });
    record('admin-reset-password', r2.data?.success === true, r2.status);
  }

  // Admin login (OTP)
  let adminToken = '';
  {
    const r = await request('POST', `${API}/api/auth/admin/login`, {
      body: { email: adminEmail, password: adminPassword, deviceId }
    });
    if (r.data?.data?.token) {
      adminToken = r.data.data.token;
      record('admin-login-direct', true, r.status);
    } else if (r.data?.data?.requireOtp) {
      const otp = await getOtp(redis, 'admin', adminEmail);
      const r2 = await request('POST', `${API}/api/auth/admin/verify-login-otp`, {
        body: { email: adminEmail, otp, deviceId }
      });
      adminToken = r2.data?.data?.token || '';
      record('admin-login-otp', !!adminToken, r2.status);
    } else {
      record('admin-login', false, r.text);
    }
  }

  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  // Merchant register + password reset + login
  let merchantEmail = `merchant+${Date.now()}@test.local`;
  let merchantId = '';
  let merchantToken = '';
  {
    const r = await request('POST', `${API}/api/auth/merchant/register`, {
      body: { name: 'Test Merchant', email: merchantEmail }
    });
    if (r.data?.success) {
      merchantId = r.data?.data?.id || '';
      record('merchant-register', true, r.status);
    } else {
      record('merchant-register', false, r.text);
    }

    await request('POST', `${API}/api/auth/merchant/forgot-password`, {
      body: { email: merchantEmail }
    });
    const resetToken = await getResetToken(redis, 'merchant', merchantEmail);
    if (!resetToken) throw new Error('Merchant reset token not found');
    const r2 = await request('POST', `${API}/api/auth/merchant/confirm-reset-password`, {
      body: { token: resetToken, newPassword: merchantPassword }
    });
    record('merchant-reset-password', r2.data?.success === true, r2.status);

    const r3 = await request('POST', `${API}/api/auth/merchant/login`, {
      body: { email: merchantEmail, password: merchantPassword, deviceId }
    });
    if (r3.data?.data?.token) {
      merchantToken = r3.data.data.token;
      record('merchant-login-direct', true, r3.status);
    } else if (r3.data?.data?.requireOtp) {
      const otp = await getOtp(redis, 'merchant', merchantEmail);
      const r4 = await request('POST', `${API}/api/auth/merchant/verify-otp`, {
        body: { email: merchantEmail, otp, deviceId }
      });
      merchantToken = r4.data?.data?.token || '';
      record('merchant-login-otp', !!merchantToken, r4.status);
    } else {
      record('merchant-login', false, r3.text);
    }
  }

  const merchantHeaders = { Authorization: `Bearer ${merchantToken}` };

  // Admin: create/fetch provider + legal entity (prefer dummy/default for provider config)
  let providerId = '';
  let legalEntityId = '';
  {
    const existingProvider = await db.collection('providers').findOne({ id: 'dummy' });
    if (existingProvider?.id) {
      providerId = existingProvider.id;
      record('admin-create-provider', true, 'existing-used');
    } else {
      const r1 = await request('POST', `${API}/api/admin/providers`, {
        headers: adminHeaders,
        body: { name: 'dummy', type: 'GATEWAY', capabilities: { payin: true, payout: true } }
      });
      if (r1.data?.success) {
        providerId = r1.data.data.id;
        record('admin-create-provider', true, r1.status);
      } else {
        const fallback = await db.collection('providers').findOne({ name: 'dummy' });
        if (fallback?.id) {
          providerId = fallback.id;
          record('admin-create-provider', true, 'fallback-used');
        } else {
          record('admin-create-provider', false, r1.text);
        }
      }
    }

    const existingLe = await db.collection('legalentities').findOne({ id: 'default' });
    if (existingLe?.id) {
      legalEntityId = existingLe.id;
      record('admin-create-legal-entity', true, 'existing-used');
    } else {
      const r2 = await request('POST', `${API}/api/admin/legal-entities`, {
        headers: adminHeaders,
        body: { name: 'default', identifier: `LE-${Date.now()}` }
      });
      if (r2.data?.success) {
        legalEntityId = r2.data.data.id;
        record('admin-create-legal-entity', true, r2.status);
      } else {
        const fallback = await db.collection('legalentities').findOne({ name: 'default' });
        if (fallback?.id) {
          legalEntityId = fallback.id;
          record('admin-create-legal-entity', true, 'fallback-used');
        } else {
          record('admin-create-legal-entity', false, r2.text);
        }
      }
    }
  }

  // Admin: create provider legal entity + add fees
  let pleId = '';
  {
    const existing = await db.collection('providerlegalentities').findOne({ providerId, legalEntityId });
    if (existing?.id) {
      pleId = existing.id;
      record('admin-create-ple', true, 'existing-used');
    } else {
      const r = await request('POST', `${API}/api/admin/provider-legal-entity`, {
        headers: adminHeaders,
        body: { providerId, legalEntityId, isActive: true }
      });
      if (r.data?.success) {
        pleId = r.data.data.id;
        record('admin-create-ple', true, r.status);
      } else {
        record('admin-create-ple', false, r.text);
      }
    }

    const feeTier = { fromAmount: 0, toAmount: -1, charge: { flat: 0, percentage: 0, taxRate: 0 } };
    if (pleId) {
      await request('DELETE', `${API}/api/admin/provider-legal-entity/${pleId}/payin/fees`, {
        headers: adminHeaders,
        body: { fromAmount: 0 }
      });
      await request('DELETE', `${API}/api/admin/provider-legal-entity/${pleId}/payout/fees`, {
        headers: adminHeaders,
        body: { fromAmount: 0 }
      });

      const r1 = await request('POST', `${API}/api/admin/provider-legal-entity/${pleId}/payin/fees`, {
        headers: adminHeaders,
        body: feeTier
      });
      record('admin-ple-payin-fee', r1.data?.success === true, r1.status);
      const r2 = await request('POST', `${API}/api/admin/provider-legal-entity/${pleId}/payout/fees`, {
        headers: adminHeaders,
        body: feeTier
      });
      record('admin-ple-payout-fee', r2.data?.success === true, r2.status);

      const r3 = await request('PUT', `${API}/api/admin/provider-legal-entity/${pleId}/payin`, {
        headers: adminHeaders,
        body: { isActive: true }
      });
      record('admin-ple-payin-active', r3.data?.success === true, r3.status);
      const r4 = await request('PUT', `${API}/api/admin/provider-legal-entity/${pleId}/payout`, {
        headers: adminHeaders,
        body: { isActive: true }
      });
      record('admin-ple-payout-active', r4.data?.success === true, r4.status);
    }
  }

  // Admin: onboard merchant
  if (!merchantId) {
    const m = await db.collection('merchants').findOne({ email: merchantEmail });
    merchantId = m?.id || '';
  }
  {
    const r = await request('POST', `${API}/api/admin/merchants/${merchantId}/onboard`, {
      headers: adminHeaders
    });
    record('admin-onboard-merchant', r.data?.success === true, r.status);
  }

  // Admin: merchant fees + routing
  {
    const feeTier = { fromAmount: 0, toAmount: -1, charge: { flat: 0, percentage: 0, taxRate: 0 } };
    await request('DELETE', `${API}/api/admin/merchants/${merchantId}/payin-config/fees`, {
      headers: adminHeaders,
      body: { fromAmount: 0 }
    });
    await request('DELETE', `${API}/api/admin/merchants/${merchantId}/payout-config/fees`, {
      headers: adminHeaders,
      body: { fromAmount: 0 }
    });

    const r1 = await request('POST', `${API}/api/admin/merchants/${merchantId}/payin-config/fees`, {
      headers: adminHeaders,
      body: feeTier
    });
    record('admin-merchant-payin-fee', r1.data?.success === true, r1.status);

    const r2 = await request('POST', `${API}/api/admin/merchants/${merchantId}/payout-config/fees`, {
      headers: adminHeaders,
      body: feeTier
    });
    record('admin-merchant-payout-fee', r2.data?.success === true, r2.status);

    const r3 = await request('PUT', `${API}/api/admin/merchants/${merchantId}/routing`, {
      headers: adminHeaders,
      body: {
        payinRouting: { providerId, legalEntityId },
        payoutRouting: { providerId, legalEntityId }
      }
    });
    record('admin-merchant-routing', r3.data?.success === true, r3.status);
  }

  // Admin: rotate api secret
  let apiSecret = '';
  {
    const r = await request('POST', `${API}/api/admin/merchants/${merchantId}/rotate-api-secret`, {
      headers: adminHeaders
    });
    apiSecret = r.data?.data?.apiSecret || '';
    record('admin-merchant-rotate-secret', !!apiSecret, r.status);
  }

  // Merchant: bank account and profile endpoints
  let bankAccountId = '';
  {
    const r = await request('POST', `${API}/api/merchant/bank-accounts`, {
      headers: merchantHeaders,
      body: {
        accountNumber: '1234567890',
        ifsc: 'HDFC0001234',
        bankName: 'HDFC',
        beneficiaryName: 'Test Merchant'
      }
    });
    bankAccountId = r.data?.data?.id || '';
    record('merchant-create-bank-account', r.data?.success === true, r.status);

    await request('GET', `${API}/api/merchant/bank-accounts`, { headers: merchantHeaders });
    await request('GET', `${API}/api/merchant/profile/basic`, { headers: merchantHeaders });
    await request('GET', `${API}/api/merchant/profile/payin`, { headers: merchantHeaders });
    await request('GET', `${API}/api/merchant/profile/payout`, { headers: merchantHeaders });
    await request('GET', `${API}/api/merchant/profile/api-keys`, { headers: merchantHeaders });
    await request('GET', `${API}/api/merchant/dashboard/stats`, { headers: merchantHeaders });
    await request('PUT', `${API}/api/merchant/profile`, { headers: merchantHeaders, body: { displayName: 'Test Merchant Updated' } });
  }

  // Admin: approve bank account
  if (bankAccountId) {
    const r1 = await request('PUT', `${API}/api/admin/merchant-bank-accounts/${bankAccountId}/status`, {
      headers: adminHeaders,
      body: { status: 'APPROVED' }
    });
    record('admin-merchant-bank-status', r1.data?.success === true, r1.status);

    const r2 = await request('PUT', `${API}/api/admin/merchant-bank-accounts/${bankAccountId}/active`, {
      headers: adminHeaders,
      body: { isActive: true }
    });
    record('admin-merchant-bank-active', r2.data?.success === true, r2.status);
  }

  // Fetch merchant accounts directly from DB for ledger tests
  let merchantAccounts = null;
  {
    const m = await db.collection('merchants').findOne({ id: merchantId });
    merchantAccounts = m?.accounts || null;
  }

  if (merchantAccounts?.payinAccountId) {
    await request('GET', `${API}/api/admin/ledger/accounts/${merchantAccounts.payinAccountId}/entries`, { headers: adminHeaders });
    await request('GET', `${API}/api/admin/ledger/accounts/${merchantAccounts.payinAccountId}/statement`, { headers: adminHeaders });
    await request('GET', `${API}/api/admin/ledger/accounts/${merchantAccounts.payinAccountId}/general-ledger`, { headers: adminHeaders });
    await request('GET', `${API}/api/merchant/ledger/accounts/${merchantAccounts.payinAccountId}/entries`, { headers: merchantHeaders });
    await request('GET', `${API}/api/merchant/ledger/accounts/${merchantAccounts.payinAccountId}/statement`, { headers: merchantHeaders });
    await request('GET', `${API}/api/merchant/ledger/accounts/${merchantAccounts.payinAccountId}/general-ledger`, { headers: merchantHeaders });
  }

  // Payment tests (payin + webhook + payout)
  let payinOrderId = `ORDER${Date.now()}`;
  let payoutOrderId = `ORDERP${Date.now()}`;
  let payinTxId = '';
  {
    const payinBody = {
      amount: 100,
      orderId: payinOrderId,
      paymentMode: 'UPI',
      customerName: 'Test Customer',
      customerEmail: 'cust@test.local',
      customerPhone: '9876543210',
      remarks: 'test payin'
    };
    const timestamp = Date.now().toString();
    const raw = JSON.stringify(payinBody);
    const signature = hmacHex(apiSecret, `${raw}|${timestamp}`);

    const r = await request('POST', `${PAYMENT}/api/payment/payin/initiate`, {
      rawBody: raw,
      headers: {
        'x-merchant-id': merchantId,
        'x-timestamp': timestamp,
        'x-signature': signature
      }
    });
    payinTxId = r.data?.data?.transactionId || '';
    record('payment-payin', r.data?.success === true, r.status);

    if (payinTxId) {
      const payload = {
        payment_id: `DUMMY_${Date.now()}`,
        status: 'SUCCESS',
        amount: 100,
        ref_id: payinTxId,
        utr: `UTR${Date.now()}`
      };
      const rWebhook = await request('POST', `${API}/webhook/payin/${providerId}/${legalEntityId}`, {
        body: payload
      });
      record('webhook-payin', rWebhook.data?.success === true, rWebhook.status);
    }

    // invalid signature
    const r2 = await request('POST', `${PAYMENT}/api/payment/payin/initiate`, {
      rawBody: raw,
      headers: {
        'x-merchant-id': merchantId,
        'x-timestamp': timestamp,
        'x-signature': '00'.repeat(32)
      }
    });
    record('payment-payin-invalid-signature', r2.status === 403, r2.status);

    // old timestamp
    const oldTs = (Date.now() - 5 * 60 * 1000).toString();
    const sigOld = hmacHex(apiSecret, `${raw}|${oldTs}`);
    const r3 = await request('POST', `${PAYMENT}/api/payment/payin/initiate`, {
      rawBody: raw,
      headers: {
        'x-merchant-id': merchantId,
        'x-timestamp': oldTs,
        'x-signature': sigOld
      }
    });
    record('payment-payin-old-timestamp', r3.status === 403, r3.status);
  }

  {
    const payoutBody = {
      amount: 100,
      orderId: payoutOrderId,
      paymentMode: 'IMPS',
      beneficiaryName: 'Test Beneficiary',
      beneficiaryAccountNumber: '1234567890',
      beneficiaryIfsc: 'HDFC0001234',
      beneficiaryBankName: 'HDFC',
      remarks: 'test payout'
    };
    const timestamp = Date.now().toString();
    const raw = JSON.stringify(payoutBody);
    const signature = hmacHex(apiSecret, `${raw}|${timestamp}`);

    const r = await request('POST', `${PAYMENT}/api/payment/payout/initiate`, {
      rawBody: raw,
      headers: {
        'x-merchant-id': merchantId,
        'x-timestamp': timestamp,
        'x-signature': signature
      }
    });
    record('payment-payout', r.data?.success === true, r.status);
  }

  // Status check
  {
    const timestamp = Date.now().toString();
    const signature = hmacHex(apiSecret, `|${timestamp}`);
    const r = await request('GET', `${PAYMENT}/api/payment/${payinOrderId}`, {
      headers: {
        'x-merchant-id': merchantId,
        'x-timestamp': timestamp,
        'x-signature': signature
      }
    });
    record('payment-status', r.data?.success === true, r.status);
  }

  // Malicious / injection tests (expected failures)
  {
    const r1 = await request('GET', `${API}/api/admin/merchants/list-merchants?page=0`, { headers: adminHeaders });
    record('admin-list-merchants-invalid-page', r1.status === 400, r1.status);

    const r2 = await request('POST', `${PAYMENT}/api/payment/payin/initiate`, {
      body: { amount: -1, orderId: "' OR 1=1 --", paymentMode: 'UPI', customerName: 'x', customerEmail: 'bad', customerPhone: '123' },
      headers: { 'x-merchant-id': merchantId, 'x-timestamp': Date.now().toString(), 'x-signature': '00'.repeat(32) }
    });
    record('payment-payin-malicious', r2.status === 400 || r2.status === 403, r2.status);

    const r3 = await request('GET', `${API}/api/admin/ledger/reports/trial-balance`, { headers: adminHeaders });
    record('admin-trial-balance', r3.data?.success === true, r3.status);
  }

  // Cleanup connections
  await redis.quit();
  await mongo.close();

  // Print summary
  const failed = results.filter(r => !r.ok);
  console.log(`\nTest results: ${results.length - failed.length}/${results.length} passed`);
  for (const r of results) {
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(`${tag} - ${r.name} (${r.detail})`);
  }

  if (failed.length) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
