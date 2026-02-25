# Volume 8 — API Specification (Detailed)

This section consolidates merchant and admin APIs for knowledge transfer. Data shapes reflect `PAYMENT_API_DOCUMENTATION.md` and related DTOs.

---

## 1. Common Conventions

### 1.1 Base URL
- Example: `https://api.example.com`

### 1.2 Authentication Headers (Merchant)
- `x-merchant-id`
- `x-timestamp` (ms epoch)
- `x-signature` (HMAC‑SHA256)

### 1.3 Signature Algorithm

**Standard**:
```
HMAC_SHA256(raw_body + "|" + timestamp, API_SECRET)
```

**Legacy** (fallback):
```
HMAC_SHA256(amount|currency|orderId|API_SECRET)
```

### 1.4 Timestamp Window
- Requests outside ±60 seconds are rejected.

### 1.5 IP Whitelist
- Optional per merchant for payin/payout.
- Enforced by `payment-security.middleware.ts`.

---

## 2. Payin APIs

### 2.1 Initiate Payin
**Endpoint**: `POST /api/payment/payin/initiate`

**Required fields**
- `amount` (integer, >= 1)
- `orderId` (10–25 chars)
- `paymentMode` (UPI/QR/INTENT)
- `customerName`
- `customerEmail`
- `customerPhone`

**Optional fields**
- `remarks`
- `redirectUrl`

**Response**
- `transactionId`
- `orderId`
- `paymentUrl` (if provider supports)
- `amount`
- `status`

### 2.2 Payin Status
**Endpoint**: `GET /api/payment/payin/status/:orderId`

**Response**
- `transactionId`, `orderId`, `status`, `amount`, `utr?`

---

## 3. Payout APIs

### 3.1 Initiate Payout
**Endpoint**: `POST /api/payment/payout/initiate`

**Required fields**
- `amount` (integer)
- `orderId`
- `paymentMode` (UPI/NEFT/RTGS/IMPS)
- `beneficiaryName`
- `beneficiaryAccountNumber`
- `beneficiaryIfsc`
- `beneficiaryBankName`

**Optional fields**
- `beneficiaryPhone`
- `remarks`

**Response**
- `transactionId`, `orderId`, `status`, `utr?`

### 3.2 Payout Status
**Endpoint**: `GET /api/payment/payout/status/:orderId`

---

## 4. Unified Status API

**Endpoint**: `GET /api/payment/:orderId`

- Returns a consolidated transaction view regardless of type.

---

## 5. UAT APIs

UAT endpoints simulate payment flows and callbacks.

**Endpoints**
- `POST /api/payment/uat/payin/initiate`
- `POST /api/payment/uat/payout/initiate`
- `GET /api/payment/uat/:orderId`
- `GET /api/payment/uat/payin/status/:orderId`
- `GET /api/payment/uat/payout/status/:orderId`

Notes:
- Uses same signature headers
- Rate limited (per documentation)
- UAT callbacks sent after ~2 seconds

---

## 6. Merchant Profile / API Keys

**Endpoints**
- `GET /merchant/api-keys` (returns merchantId + apiSecret)
- `POST /merchant/api-keys` (rotate API secret)

---

## 7. Manual Admin APIs

### 7.1 Manual Status Update
`POST /api/payment/manual/status/update`

Body fields:
- `orderId`
- `status` (SUCCESS/FAILED)
- `utr?`
- `providerTransactionId?`
- `providerMsg?`
- `reason?`

### 7.2 Manual Status Sync
`POST /api/payment/manual/status/sync`

Body fields:
- `transactionId`
- `confirm?`

### 7.3 Expire Pending Previous Day (IST)
`POST /api/payment/manual/expire/pending-previous-day`

Body fields:
- `date?` (YYYY‑MM‑DD)
- `reason?`

### 7.4 Provider Fee Settlement
`POST /api/payment/manual/provider-fee-settlement`

Body fields:
- `date?` (YYYY‑MM‑DD)

---

## 8. Callback Payloads

Merchant callback payloads include:
- `orderId`, `transactionId`
- `amount`
- `status`
- `utr`
- `type`
- `timestamp`

Signatures:
- Legacy `hash` field
- `x-signature` header with body + timestamp

---

## 9. Error Handling

Payment errors are normalized through `payment-errors.util.ts` with standardized codes and HTTP statuses.

Typical error categories:
- Validation errors (400)
- Authentication errors (401/403)
- Rate limiting (429)
- Provider errors (500)
- Ledger failures (500)

---

End of Volume 8.


---
