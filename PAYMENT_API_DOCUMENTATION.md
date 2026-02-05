# Wisipay Payment API Documentation

This document provides technical details for integrating with the Wisipay Payment API, specifically focusing on security, authentication, and error handling.

## 1. Authentication & Security Headers

All requests to the Payment API must include the following HTTP headers:

| Header | Description | Required |
|--------|-------------|----------|
| `x-merchant-id` | Your unique Merchant ID (e.g., `MER-XXXXX`) | Yes |
| `x-timestamp` | Current Unix Timestamp in milliseconds (e.g., `1770323283897`) | Yes |
| `x-signature` | HMAC-SHA256 signature for the request (see below) | Highly Recommended |
| `Content-Type` | Must be `application/json` | Yes |

> [!IMPORTANT]
> The `x-timestamp` must be within **60 seconds** of our server time. Requests with expired or future timestamps will be rejected with a `403 Forbidden` error.

---

## 2. Signature Generation

To ensure request integrity, Wisipay uses `HMAC-SHA256` signatures.

### Standard Signature (Recommended)

The signature is calculated by concatenating the raw request body and the `x-timestamp` with a pipe `|` character, then hashing it using your `API Secret`.

**Algorithm:**
`HMAC-SHA256(RawBody + "|" + Timestamp, API_Secret)`

**Steps:**
1.  Prepare your request JSON body.
2.  Obtain the current timestamp in milliseconds.
3.  Concatenate: `body_string + "|" + timestamp_string`.
4.  Compute HMAC-SHA256 using your Secret key.
5.  Pass the resulting hex string in the `x-signature` header.

### Legacy Hash (Backward Compatibility)

If `x-signature` is missing, the system looks for a `hash` field inside the JSON body.

**Algorithm:**
`HMAC-SHA256(amount + "|" + currency + "|" + orderId + "|" + API_Secret, API_Secret)`

*Note: The legacy format uses the secret both as a key and as part of the data string.*

---

## 3. Error Codes & Responses

The API uses standard HTTP status codes and a consistent JSON error format.

### Error Format
```json
{
  "success": false,
  "error": "Error message description",
  "code": "ERROR_CODE",
  "details": {} 
}
```

### Common Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| **400** | `BAD_REQUEST` | Missing required headers, invalid JSON, or validation failure (e.g., invalid email). |
| **401** | `UNAUTHORIZED` | Invalid `x-merchant-id`. |
| **403** | `FORBIDDEN` | Possible reasons: <br> - `Timestamp out of range` (Expired request) <br> - `Invalid Signature` <br> - `IP Not Whitelisted` <br> - `Merchant is not active` <br> - `Payin/Payout Service Disabled` <br> - `Active payment channel not found` |
| **409** | `CONFLICT` | `Order ID already exists`. Duplicate transaction attempt. |
| **500** | `INTERNAL_ERROR` | Unexpected server error or configuration issue (e.g., missing fees configuration). |

---

## 4. Implementation Examples

### Node.js (JavaScript)

```javascript
const crypto = require('crypto');
const axios = require('axios');

const API_SECRET = 'your_secret_key';
const MERCHANT_ID = 'your_merchant_id';
const BASE_URL = 'https://api.wisipay.in/api/payment';

async function initiatePayin(orderData) {
    const timestamp = Date.now();
    const rawBody = JSON.stringify(orderData);
    
    // Generate Signature: HMAC-SHA256(RawBody + "|" + Timestamp, Secret)
    const payload = rawBody + "|" + timestamp;
    const signature = crypto.createHmac('sha256', API_SECRET)
                            .update(payload)
                            .digest('hex');

    try {
        const response = await axios.post(`${BASE_URL}/payin/initiate`, orderData, {
            headers: {
                'Content-Type': 'application/json',
                'x-merchant-id': MERCHANT_ID,
                'x-timestamp': timestamp,
                'x-signature': signature
            }
        });
        console.log('Success:', response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

// Example Payin Request
initiatePayin({
    amount: 500,
    currency: "INR",
    orderId: "ORDER_" + Date.now(),
    customer: { name: "John Doe", email: "john@example.com", phone: "9876543210" },
    paymentMode: "UPI"
});
```

### PHP (cURL)

```php
<?php

$apiSecret = 'your_secret_key';
$merchantId = 'your_merchant_id';
$baseUrl = 'https://api.wisipay.in/api/payment';

$orderData = [
    "amount" => 500,
    "currency" => "INR",
    "orderId" => "ORDER_" . time(),
    "customer" => [
        "name" => "John Doe",
        "email" => "john@example.com",
        "phone" => "9876543210"
    ],
    "paymentMode" => "UPI"
];

$timestamp = round(microtime(true) * 1000);
$rawBody = json_encode($orderData);

// Generate Signature: HMAC-SHA256(RawBody + "|" + Timestamp, Secret)
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

if (curl_errno($ch)) {
    echo 'Error: ' . curl_error($ch);
} else {
    echo "Status Code: $httpCode\n";
    echo "Response: $response\n";
}

curl_close($ch);

?>
```

---

## 5. IP Whitelisting

By default, API IP whitelisting may be enforced. If enabled for your account, you must provide your server IP addresses to be whitelisted in the Merchant Panel. Requests from unauthorized IPs will return a `403 IP Not Whitelisted` error.

---

© 2026 Wisipay Fintech Solutions.
