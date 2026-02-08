# Payment API Documentation

This document provides merchant integration details for the Payment API, including request signing (hashing), endpoints, request/response formats, and merchant-facing error codes.

## 1. Base URL & Endpoints

Base URL (example): `https://api.example.com`

Merchant Payment endpoints:
- `POST /api/payment/payin/initiate`
- `POST /api/payment/payout/initiate`
- `GET /api/payment/:orderId` (status)
- `GET /api/payment/payin/status/:orderId` (payin status)
- `GET /api/payment/payout/status/:orderId` (payout status)

## 2. Authentication & Security Headers

All requests must include these headers:

| Header | Description | Required |
|--------|-------------|----------|
| `x-merchant-id` | Your Merchant ID (e.g., `MER-XXXXX`) | Yes |
| `x-timestamp` | Current Unix timestamp in milliseconds | Yes |
| `x-signature` | HMAC-SHA256 signature (see below) | Yes |
| `Content-Type` | `application/json` | Yes (for POST) |

**Timestamp window:** The server only accepts timestamps within **60 seconds** of server time. Requests outside the window return `403 FORBIDDEN`.

**IP whitelisting:** If enabled for your account, requests must originate from whitelisted IPs or you will receive `403 IP Not Whitelisted`.

> Status endpoints under `/api/payment/payin/status/:orderId` and `/api/payment/payout/status/:orderId` **require signatures** and are rate‑limited by TPS. Use these endpoints for polling.

## 3. Request Signing (Hashing)

### 3.1 Standard Signature (Recommended)

Signature is computed using the exact raw HTTP request body and the timestamp.

**Algorithm**
```
HMAC-SHA256( raw_body + "|" + timestamp, API_SECRET )
```

**Important**
- `raw_body` must be the exact string sent on the wire.
- Do not re-serialize JSON differently before hashing (spacing/ordering changes will break the signature).
- The server also accepts `x-signature: sha256=<hex>` (the prefix is stripped).

**Steps**
1. Build the JSON request body.
2. Serialize it to a string (this exact string will be sent).
3. Get the current timestamp in milliseconds.
4. Concatenate: `body_string + "|" + timestamp_string`.
5. Compute HMAC-SHA256 using your API secret.
6. Put the hex string in `x-signature`.

### 3.2 Legacy Body Hash (Backward Compatibility)

If `x-signature` is missing, the system checks a legacy `hash` field in the body:

```
HMAC-SHA256( amount + "|" + currency + "|" + orderId + "|" + API_SECRET, API_SECRET )
```

This is supported only for older integrations. New integrations must use `x-signature`.

## 4. Order ID Rules

- Must be **unique per merchant**.
- Length **10 to 25** characters.
- Duplicate `orderId` returns `409 CONFLICT`.

## 5. Payin Initiate

**Endpoint:** `POST /api/payment/payin/initiate`

**Body**
- `amount` (number, integer, >= 1)
- `orderId` (string, 10-25 chars)
- `paymentMode` (`UPI` or `QR`)
- `customerName` (string, min 3 chars)
- `customerEmail` (valid email)
- `customerPhone` (10-digit Indian mobile)
- `remarks` (optional)
- `redirectUrl` (optional URL)

**Response (Success)**
```json
{
  "success": true,
  "data": {
    "orderId": "ORDER_12345",
    "transactionId": "TXN-101",
    "paymentUrl": "https://checkout.example.com/...",
    "amount": 500,
    "status": "PENDING"
  }
}
```

## 6. Payout Initiate

**Endpoint:** `POST /api/payment/payout/initiate`

**Body**
- `amount` (number, integer, >= 1)
- `orderId` (string, 10-25 chars)
- `paymentMode` (`UPI`, `NEFT`, `RTGS`, `IMPS`)
- `beneficiaryName` (string, min 3 chars)
- `beneficiaryAccountNumber` (string, required)
- `beneficiaryIfsc` (string, 11 chars, IFSC format)
- `beneficiaryBankName` (string, min 3 chars)
- `remarks` (optional)

**Response (Success)**
```json
{
  "success": true,
  "data": {
    "transactionId": "TXN-202",
    "orderId": "ORDER_98765",
    "status": "PENDING",
    "utr": null
  }
}
```

## 7. Status Check

**Endpoints:**  
- `GET /api/payment/:orderId`  
- `GET /api/payment/payin/status/:orderId`  
- `GET /api/payment/payout/status/:orderId`

**Headers:** `x-merchant-id`, `x-timestamp`, `x-signature`

**Note:** For `GET` status calls, the request body is empty. Signature should be computed with `raw_body = ""`.

**Response (Success)**
```json
{
  "success": true,
  "data": {
    "id": "TXN-202",
    "orderId": "ORDER_98765",
    "type": "PAYOUT",
    "status": "SUCCESS",
    "amount": 1000,
    "netAmount": 1000,
    "currency": "INR",
    "utr": "UTR123456789",
    "createdAt": "2026-02-01T10:10:10.000Z"
  }
}
```

## 8. Merchant Webhook Callback (Outgoing)

When a transaction completes, we notify your callback URL (`payin.callbackUrl` or `payout.callbackUrl`) with a signed payload.

**Headers**
- `x-merchant-id`
- `x-timestamp`
- `x-signature` = `HMAC-SHA256(raw_body + "|" + timestamp, API_SECRET)`

**Body**
```json
{
  "orderId": "ORDER_12345",
  "transactionId": "TXN-101",
  "amount": 500,
  "currency": "INR",
  "status": "SUCCESS",
  "utr": "UTR123456",
  "type": "PAYIN",
  "timestamp": "2026-02-01T10:10:10.000Z",
  "hash": "legacy_hash_for_verification"
}
```

**Legacy Hash (Body)**
```
HMAC-SHA256(amount + "|" + currency + "|" + orderId + "|" + API_SECRET, API_SECRET)
```

## 9. Error Handling (Merchant-Facing)

**Error Format (Payment Workflow Errors)**
```json
{
  "success": false,
  "error": {
    "code": "PAY_1202",
    "message": "Amount exceeds maximum limit",
    "description": "The transaction amount exceeds the maximum allowed limit",
    "retryable": false
  }
}
```

**Error Format (Security/Validation Errors)**
```json
{
  "success": false,
  "error": "Missing x-merchant-id",
  "code": "BAD_REQUEST",
  "details": {}
}
```

### 9.1 Security & Validation Errors

| HTTP | Code | When |
|------|------|------|
| 400 | `BAD_REQUEST` | Missing/invalid headers, malformed JSON, invalid fields |
| 401 | `UNAUTHORIZED` | Invalid `x-merchant-id` |
| 403 | `FORBIDDEN` | Invalid signature, timestamp out of range, IP not whitelisted, merchant inactive |
| 409 | `CONFLICT` | Duplicate `orderId` |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

### 9.2 Payment Workflow Error Codes (PAY_xxxx)

These codes are merchant-facing unless stated otherwise. Internal errors are masked to `PAY_1901` with message "Unable to process payment".

**Validation (PAY_100x)**
- `PAY_1001` Invalid transaction amount
- `PAY_1002` Invalid customer information
- `PAY_1003` Invalid payment mode
- `PAY_1004` Invalid beneficiary information
- `PAY_1005` Duplicate order ID
- `PAY_1006` Invalid order ID format

**Configuration (PAY_110x)**
- `PAY_1101` Service disabled
- `PAY_1102` Routing not configured (masked)
- `PAY_1103` Channel not found (masked)
- `PAY_1104` Channel inactive
- `PAY_1105` Fee config missing (masked)
- `PAY_1106` Provider config missing (masked)

**Limits & Balance (PAY_120x)**
- `PAY_1201` Amount below minimum limit
- `PAY_1202` Amount exceeds maximum limit
- `PAY_1203` Daily limit exceeded
- `PAY_1204` Monthly limit exceeded
- `PAY_1205` Insufficient balance

**Provider Errors (PAY_130x)**
- `PAY_1301` Provider unavailable (retryable)
- `PAY_1302` Provider timeout (retryable)
- `PAY_1303` Provider rejected
- `PAY_1304` Provider invalid response (masked)
- `PAY_1305` Provider maintenance (retryable)

**Ledger Errors (PAY_140x)** (masked)
- `PAY_1401` Ledger hold failed
- `PAY_1402` Ledger commit failed
- `PAY_1403` Ledger rollback failed
- `PAY_1404` Ledger unavailable

**Database Errors (PAY_150x)** (masked except duplicate)
- `PAY_1501` DB write failed
- `PAY_1502` DB read failed
- `PAY_1503` Duplicate transaction detected
- `PAY_1504` DB connection failed

**Workflow Errors (PAY_160x)** (masked)
- `PAY_1601` Workflow validation failed
- `PAY_1602` Workflow execution failed
- `PAY_1603` Workflow invalid state

**Generic**
- `PAY_1901` Internal error (masked)
- `PAY_1999` Unknown error

## 10. Sample Signature (Node.js)

```javascript
const crypto = require("crypto");
const axios = require("axios");

const API_SECRET = "your_secret_key";
const MERCHANT_ID = "your_merchant_id";
const BASE_URL = "https://api.example.com/api/payment";

async function initiatePayin(orderData) {
  const timestamp = Date.now();
  const rawBody = JSON.stringify(orderData);

  const payload = rawBody + "|" + timestamp;
  const signature = crypto
    .createHmac("sha256", API_SECRET)
    .update(payload)
    .digest("hex");

  const response = await axios.post(
    `${BASE_URL}/payin/initiate`,
    orderData,
    {
      headers: {
        "Content-Type": "application/json",
        "x-merchant-id": MERCHANT_ID,
        "x-timestamp": timestamp,
        "x-signature": signature,
      },
    }
  );

  console.log(response.data);
}
```

## 11. Sample Signature (PHP cURL)

```php
<?php
$apiSecret = 'your_secret_key';
$merchantId = 'your_merchant_id';
$baseUrl = 'https://api.example.com/api/payment';

$orderData = [
  "amount" => 500,
  "orderId" => "ORDER_" . time(),
  "paymentMode" => "UPI",
  "customerName" => "John Doe",
  "customerEmail" => "john@example.com",
  "customerPhone" => "9876543210"
];

$timestamp = round(microtime(true) * 1000);
$rawBody = json_encode($orderData);
$payload = $rawBody . "|" . $timestamp;
$signature = hash_hmac('sha256', $payload, $apiSecret);

$ch = curl_init($baseUrl . '/payin/initiate');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Content-Type: application/json',
  'x-merchant-id: ' . $merchantId,
  'x-timestamp: ' . $timestamp,
  'x-signature: ' . $signature
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "Status Code: $httpCode\n";
echo "Response: $response\n";
?>
```

---

© 2026 Your Company.
