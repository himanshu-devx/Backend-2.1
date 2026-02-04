import fs from 'fs';
import path from 'path';

// --- Constants & Helpers ---

const BASE_URL = "{{baseUrl}}";
const ADMIN_TOKEN = "{{adminToken}}";
const MERCHANT_TOKEN = "{{merchantToken}}";

interface PostmanItem {
    name: string;
    item?: PostmanItem[];
    request?: any;
    response?: any[];
    event?: any[];
}

function createRequest(name: string, method: string, urlPath: string[], body?: any, query?: any[], authType: 'admin' | 'merchant' | 'none' = 'none', description?: string): PostmanItem {
    const request: any = {
        method: method,
        header: [],
        url: {
            raw: `${BASE_URL}/${urlPath.join('/')}`,
            host: ["{{baseUrl}}"],
            path: urlPath,
        }
    };

    if (description) {
        request.description = description;
    }

    if (query) {
        request.url.query = query;
        const queryString = query.map((q: any) => `${q.key}=${q.value}`).join('&');
        request.url.raw += `?${queryString}`;
    }

    if (body) {
        request.body = {
            mode: "raw",
            raw: JSON.stringify(body, null, 2),
            options: { raw: { language: "json" } }
        };
        request.header.push({ key: "Content-Type", value: "application/json" });
    }

    if (authType === 'admin') {
        request.auth = {
            type: "bearer",
            bearer: [{ key: "token", value: ADMIN_TOKEN, type: "string" }]
        };
    } else if (authType === 'merchant') {
        request.auth = {
            type: "bearer",
            bearer: [{ key: "token", value: MERCHANT_TOKEN, type: "string" }]
        };
    }

    return {
        name,
        request,
        response: []
    };
}

// --- Collection Structure ---

const collection: any = {
    info: {
        _postman_id: "wisipay-collection-v5-comprehensive",
        name: "WisiPay API Production V5 (Comprehensive)",
        description: "Comprehensive API documentation for WisiPay Backend v5. Organized by platform (Admin Panel vs Merchant App). Includes all management, config, and fee operations.",
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: []
};

// 1. Admin Panel
const adminPanel: PostmanItem = {
    name: "Admin Panel",
    item: []
};

// 1.1 Auth
const adminAuth: PostmanItem = {
    name: "Auth",
    item: [
        createRequest("Create Super Admin", "POST", ["auth", "admin", "create-super-admin"], {
            name: "Super Admin",
            email: "super@admin.com",
            password: "password",
            secretKey: "env_secret"
        }),
        {
            ...createRequest("Admin Login", "POST", ["auth", "admin", "login"], {
                email: "admin@example.com",
                password: "password",
                deviceId: "dev1"
            }),
            event: [{
                listen: "test",
                script: {
                    exec: [
                        "var jsonData = pm.response.json();",
                        "if (jsonData.success && jsonData.data.token) {",
                        "    pm.environment.set(\"adminToken\", jsonData.data.token);",
                        "    console.log(\"Admin Token captured.\");",
                        "}"
                    ],
                    type: "text/javascript"
                }
            }]
        },
        createRequest("Verify OTP", "POST", ["auth", "admin", "verify-login-otp"], {
            email: "admin@example.com",
            otp: "123456",
            deviceId: "dev1"
        }),
        createRequest("Forgot Password", "POST", ["auth", "admin", "forgot-password"], {
            email: "admin@example.com"
        }),
        createRequest("Confirm Reset Password", "POST", ["auth", "admin", "confirm-reset-password"], {
            token: "RESET_TOKEN",
            newPassword: "newPassword123"
        })
    ]
};
adminPanel.item?.push(adminAuth);

// 1.2 Management (Admins)
const adminMgmt: PostmanItem = {
    name: "Management - Admins",
    item: [
        createRequest("List Admins", "GET", ["admin", "list-admins"], undefined, [{ key: "limit", value: "10" }, { key: "page", value: "1" }], 'admin'),
        createRequest("Create Admin", "POST", ["admin", "create-admin"], {
            name: "New Admin",
            email: "new@admin.com",
            role: "ADMIN"
        }, undefined, 'admin'),
        createRequest("Get Admin Profile (Self)", "GET", ["admin", "profile"], undefined, undefined, 'admin'),
        createRequest("Update Admin Profile (Self)", "PUT", ["admin", "profile"], { displayName: "Updated Name", _note: "Field 'name' is now permanent. Use 'displayName' for updates." }, undefined, 'admin'),
        createRequest("Login History (Self)", "GET", ["admin", "login-history"], undefined, undefined, 'admin'),
        createRequest("Login History (All)", "GET", ["admin", "login-history-all"], undefined, [{ key: "limit", value: "20" }, { key: "page", value: "1" }], 'admin'),
        // Dynamic routes
        createRequest("Get Admin by ID", "GET", ["admin", ":id"], undefined, undefined, 'admin'),
        createRequest("Update Admin Status", "PUT", ["admin", ":id", "status"], undefined, undefined, 'admin'),
        createRequest("Update Admin Role", "PATCH", ["admin", ":id", "role"], { newRole: "SUPPORT" }, undefined, 'admin'),
        createRequest("Update Admin IP Whitelist", "PUT", ["admin", ":id", "panel-ip-whitelist"], { panelIpWhitelist: ["1.1.1.1"], isPanelIpWhitelistEnabled: true }, undefined, 'admin'),
        createRequest("Update Admin Profile (Mgmt)", "PUT", ["admin", ":id", "profile"], { displayName: "New Name", _note: "Field 'name' is now permanent. Use 'displayName' for updates." }, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminMgmt);

// 1.3 Analytics
const adminAnalytics: PostmanItem = {
    name: "Analytics",
    item: [
        createRequest("Get Dashboard Stats", "GET", ["admin", "dashboard", "stats"], undefined, undefined, 'admin'),
        createRequest("Get Analytics Distribution", "GET", ["admin", "analytics", "distribution"], undefined, undefined, 'admin'),
        createRequest("Get Analytics (General)", "GET", ["admin", "analytics"], undefined, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminAnalytics);

// 1.3.5 Transactions
const adminTransactions: PostmanItem = {
    name: "Transactions",
    item: [
        createRequest("List Transactions", "GET", ["admin", "transactions"], undefined, [
            { key: "page", value: "1", description: "Page number" },
            { key: "limit", value: "10", description: "Items per page" },
            { key: "search", value: "", description: "Search by Order ID or External Order ID", disabled: true },
            { key: "merchantId", value: "", description: "Filter by Merchant ID", disabled: true },
            { key: "type", value: "PAYIN", description: "Filter by Type (PAYIN, PAYOUT)", disabled: true },
            { key: "status", value: "SUCCESS", description: "Filter by Status", disabled: true },
            { key: "startDate", value: "2024-01-01", description: "Filter by Start Date", disabled: true },
            { key: "endDate", value: "2024-12-31", description: "Filter by End Date", disabled: true }
        ], 'admin'),
        createRequest("Get Transaction Details", "GET", ["admin", "transactions", ":id"], undefined, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminTransactions);

// 1.4 Ledger
const adminLedger: PostmanItem = {
    name: "Ledger",
    item: [
        createRequest("Get Owner Accounts", "GET", ["admin", "ledger", "owner", ":ownerId"], undefined, undefined, 'admin'),
        createRequest("Get Account By ID", "GET", ["admin", "ledger", "account", ":accountId"], undefined, undefined, 'admin'),
        createRequest("Get Account Transfers", "GET", ["admin", "ledger", "account", ":accountId", "transfers"], undefined, [
            { key: "limit", value: "100", description: "Maximum number of transfers to return" },
            { key: "reversed", value: "true", description: "Sort by timestamp in reverse-chronological order" },
            { key: "timestampMin", value: "", description: "Minimum timestamp (nanoseconds)", disabled: true },
            { key: "timestampMax", value: "", description: "Maximum timestamp (nanoseconds)", disabled: true }
        ], 'admin', "Get all transfers for a specific TigerBeetle account with enriched owner details."),
        createRequest("Get Accounts By Type", "GET", ["admin", "ledger", "type", ":type"], undefined, undefined, 'admin'),
        createRequest("View Accounts", "GET", ["admin", "ledger", "view"], undefined, undefined, 'admin'),
        createRequest("Transfer Funds", "POST", ["admin", "ledger", "transfer"], {
            fromAccountId: "ID",
            toAccountId: "ID",
            amount: 100,
            currency: "USD",
            description: "Test"
        }, undefined, 'admin'),
        createRequest("List Transfers (Smart Filter)", "GET", ["admin", "ledger", "transfers"], undefined, [
            { key: "ownerId", value: "", description: "Get all transfers for an owner (Merchant/PLE/LE)", disabled: true },
            { key: "ownerType", value: "MERCHANT", description: "Get all transfers for all owners of a type", disabled: true },
            { key: "accountId", value: "", description: "Get direct transfers for a specific Account ID", disabled: true },
            { key: "adminId", value: "", description: "Get manual transfers performed by specific Admin (Audit)", disabled: true },
            { key: "limit", value: "20", description: "Limit results" },
            { key: "reversed", value: "true", description: "Reverse chronological order", disabled: true },
            { key: "timestampMin", value: "", description: "Minimum timestamp (nanoseconds)", disabled: true },
            { key: "timestampMax", value: "", description: "Maximum timestamp (nanoseconds)", disabled: true }
        ], 'admin', "Smart filter that routes to appropriate TigerBeetle query based on parameters."),
        createRequest("Get Transfers By Owner", "GET", ["admin", "ledger", "transfers", "owner", ":ownerId"], undefined, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminLedger);

// 1.5 Legal Entities
const adminLE: PostmanItem = {
    name: "Legal Entities",
    item: [
        createRequest("Create Legal Entity", "POST", ["admin", "legal-entities"], {
            name: "LE Name",
            identifier: "LE_ID_1"
        }, undefined, 'admin'),
        createRequest("List Legal Entities", "GET", ["admin", "legal-entities"], undefined, undefined, 'admin', "Response includes 'mainAccount' with id and balance."),
        createRequest("Get LE By ID", "GET", ["admin", "legal-entities", ":id"], undefined, undefined, 'admin'),
        createRequest("Update LE", "PUT", ["admin", "legal-entities", ":id"], { displayName: "Updated LE", _note: "Field 'name' is now permanent. Use 'displayName' for updates." }, undefined, 'admin'),
        createRequest("Onboard LE", "POST", ["admin", "legal-entities", ":id", "onboard"], undefined, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminLE);

// 1.6 Provider Legal Entities
const adminPLE: PostmanItem = {
    name: "Provider Legal Entities",
    item: [
        createRequest("Create PLE", "POST", ["admin", "provider-legal-entity"], {
            providerId: "PID",
            legalEntityId: "LEID"
        }, undefined, 'admin'),
        createRequest("List PLEs", "GET", ["admin", "provider-legal-entity"], undefined, undefined, 'admin', "Response includes payinAccount, payoutAccount, and expenseAccount with balances."),
        createRequest("Get PLE By ID", "GET", ["admin", "provider-legal-entity", ":id"], undefined, undefined, 'admin'),
        createRequest("Update PLE Payin Config", "PUT", ["admin", "provider-legal-entity", ":id", "payin"], { isActive: true }, undefined, 'admin'),
        createRequest("Add PLE Payin Fee", "POST", ["admin", "provider-legal-entity", ":id", "payin", "fees"], { fromAmount: 0, toAmount: 100000, charge: { flat: 5, percentage: 1.5, taxRate: 18, strategy: "SUM" } }, undefined, 'admin'),
        createRequest("Delete PLE Payin Fee", "DELETE", ["admin", "provider-legal-entity", ":id", "payin", "fees"], { fromAmount: 0 }, undefined, 'admin'),
        createRequest("Update PLE Payout Config", "PUT", ["admin", "provider-legal-entity", ":id", "payout"], { isActive: true }, undefined, 'admin'),
        createRequest("Add PLE Payout Fee", "POST", ["admin", "provider-legal-entity", ":id", "payout", "fees"], { fromAmount: 0, toAmount: 100000, charge: { flat: 10, percentage: 0, taxRate: 18, strategy: "SUM" } }, undefined, 'admin'),
        createRequest("Delete PLE Payout Fee", "DELETE", ["admin", "provider-legal-entity", ":id", "payout", "fees"], { fromAmount: 0 }, undefined, 'admin'),
        createRequest("Onboard PLE", "POST", ["admin", "provider-legal-entity", ":id", "onboard"], undefined, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminPLE);

// 1.7 Providers
const adminProviders: PostmanItem = {
    name: "Providers",
    item: [
        createRequest("Create Provider", "POST", ["admin", "providers"], { name: "New Provider", code: "PROV1" }, undefined, 'admin'),
        createRequest("List Providers", "GET", ["admin", "providers"], undefined, undefined, 'admin'),
        createRequest("Get Provider By ID", "GET", ["admin", "providers", ":id"], undefined, undefined, 'admin'),
        createRequest("Update Provider", "PUT", ["admin", "providers", ":id"], { displayName: "Updated Provider", _note: "Field 'name' is now permanent. Use 'displayName' for updates." }, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminProviders);

// 1.7.5 Transfer Operations
const adminTransferOps: PostmanItem = {
    name: "Transfer Operations",
    item: [
        createRequest("List Operations", "GET", ["admin", "transfer-operations"], undefined, undefined, 'admin'),
        createRequest("Get Operations for Entity", "GET", ["admin", "transfer-operations", "available-for-entity"], undefined, [{ key: "sourceEntityId", value: "ID" }, { key: "sourceEntityType", value: "MERCHANT" }], 'admin'),
        createRequest("Get Operation Entities", "GET", ["admin", "transfer-operations", ":type", "entities"], undefined, undefined, 'admin'),
        createRequest("Execute Operation", "POST", ["admin", "transfer-operations", "execute"], {
            type: "WALLET_TO_WALLET",
            amount: 100,
            currency: "USD",
            sourceEntityId: "SRC_ID",
            sourceEntityType: "MERCHANT",
            destinationEntityId: "DEST_ID",
            destinationEntityType: "MERCHANT",
            description: "Manual Transfer"
        }, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminTransferOps);

// 1.8 Merchant Management
const adminMerchants: PostmanItem = {
    name: "Merchant Management",
    item: [
        createRequest("List Merchants", "GET", ["admin", "merchants", "list-merchants"], undefined, [{ key: "limit", value: "10" }], 'admin', "Response includes enriched ledger account details: payinAccount (id, balance), payoutAccount, holdAccount."),
        createRequest("Get Merchant Profile", "GET", ["admin", "merchants", ":id"], undefined, undefined, 'admin'),
        createRequest("Get Merchant Activity", "GET", ["admin", "merchants", ":id", "activity"], undefined, undefined, 'admin'),
        createRequest("Get Merchant Bank Accounts", "GET", ["admin", "merchants", ":id", "bank-accounts"], undefined, undefined, 'admin'),
        createRequest("Onboard Merchant", "POST", ["admin", "merchants", ":id", "onboard"], undefined, undefined, 'admin'),
        createRequest("Toggle Merchant Status", "PUT", ["admin", "merchants", ":id", "status"], undefined, undefined, 'admin'),
        createRequest("Update IP Whitelist", "PUT", ["admin", "merchants", ":id", "panel-ip-whitelist"], { panelIpWhitelist: [], isPanelIpWhitelistEnabled: false }, undefined, 'admin'),
        createRequest("Update Profile", "PUT", ["admin", "merchants", ":id", "profile"], { displayName: "Updated Merchant", _note: "Field 'name' is now permanent. Use 'displayName' for updates." }, undefined, 'admin'),
        createRequest("Update Payin Config", "PUT", ["admin", "merchants", ":id", "payin-config"], { isActive: true }, undefined, 'admin'),
        createRequest("Add Payin Fee", "POST", ["admin", "merchants", ":id", "payin-config", "fees"], { fromAmount: 0, toAmount: 100000, charge: { flat: 5, percentage: 1.5, taxRate: 18, strategy: "SUM" } }, undefined, 'admin'),
        createRequest("Delete Payin Fee", "DELETE", ["admin", "merchants", ":id", "payin-config", "fees"], { fromAmount: 0 }, undefined, 'admin'),
        createRequest("Update Payout Config", "PUT", ["admin", "merchants", ":id", "payout-config"], { isActive: true }, undefined, 'admin'),
        createRequest("Add Payout Fee", "POST", ["admin", "merchants", ":id", "payout-config", "fees"], { fromAmount: 0, toAmount: 100000, charge: { flat: 5, percentage: 1.5, taxRate: 18, strategy: "SUM" } }, undefined, 'admin'),
        createRequest("Delete Payout Fee", "DELETE", ["admin", "merchants", ":id", "payout-config", "fees"], { fromAmount: 0 }, undefined, 'admin'),
        createRequest("Update Routing", "PUT", ["admin", "merchants", ":id", "routing"], { payinRouting: {}, payoutRouting: {} }, undefined, 'admin'),
        createRequest("Rotate API Secret", "POST", ["admin", "merchants", ":id", "rotate-api-secret"], undefined, undefined, 'admin'),
        createRequest("Toggle API Secret", "PUT", ["admin", "merchants", ":id", "toggle-api-secret"], { enabled: true }, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminMerchants);

// 1.9 Merchant Bank Accounts (Admin View)
const adminMBA: PostmanItem = {
    name: "Merchant Bank Accounts",
    item: [
        createRequest("List All Bank Accounts", "GET", ["admin", "merchant-bank-accounts"], undefined, [{ key: "status", value: "PENDING" }], 'admin'),
        createRequest("Update Status (Approve/Reject)", "PUT", ["admin", "merchant-bank-accounts", ":id", "status"], { status: "APPROVED", rejectionReason: "" }, undefined, 'admin'),
        createRequest("Toggle Active", "PUT", ["admin", "merchant-bank-accounts", ":id", "active"], { isActive: true }, undefined, 'admin')
    ]
};
adminPanel.item?.push(adminMBA);
collection.item.push(adminPanel);


// 2. Merchant App
const merchantApp: PostmanItem = {
    name: "Merchant App",
    item: []
};

// 2.1 Auth
const merchantAuth: PostmanItem = {
    name: "Auth",
    item: [
        createRequest("Register", "POST", ["auth", "merchant", "register"], {
            name: "My Merchant",
            email: "merchant@example.com"
        }),
        {
            ...createRequest("Login", "POST", ["auth", "merchant", "login"], {
                email: "merchant@example.com",
                password: "password",
                deviceId: "dev1"
            }),
            event: [{
                listen: "test",
                script: {
                    exec: [
                        "var jsonData = pm.response.json();",
                        "if (jsonData.success && jsonData.data.token) {",
                        "    pm.environment.set(\"merchantToken\", jsonData.data.token);",
                        "    console.log(\"Merchant Token captured.\");",
                        "}"
                    ],
                    type: "text/javascript"
                }
            }]
        },
        createRequest("Verify OTP", "POST", ["auth", "merchant", "verify-otp"], {
            email: "merchant@example.com",
            otp: "123456"
        }),
        createRequest("Forgot Password", "POST", ["auth", "merchant", "forgot-password"], {
            email: "merchant@example.com"
        }),
        createRequest("Confirm Reset Password", "POST", ["auth", "merchant", "confirm-reset-password"], {
            token: "RESET_TOKEN",
            newPassword: "newPassword123"
        })
    ]
};
merchantApp.item?.push(merchantAuth);

// 2.2 Self Service
const merchantSelf: PostmanItem = {
    name: "Self Service",
    item: [
        createRequest("Get Basic Profile", "GET", ["merchant", "profile", "basic"], undefined, undefined, 'merchant'),
        createRequest("Update Profile", "PUT", ["merchant", "profile"], { displayName: "Updated Name", _note: "Field 'name' is now permanent. Use 'displayName' for updates." }, undefined, 'merchant'),
        createRequest("Get Payin Config", "GET", ["merchant", "profile", "payin"], undefined, undefined, 'merchant'),
        createRequest("Get Payout Config", "GET", ["merchant", "profile", "payout"], undefined, undefined, 'merchant'),
        createRequest("Get API Keys", "GET", ["merchant", "profile", "api-keys"], undefined, undefined, 'merchant'),
        createRequest("Rotate API Key", "POST", ["merchant", "api-keys", "rotate"], undefined, undefined, 'merchant'),
        createRequest("Update Callback URL", "PUT", ["merchant", "config", "callback-url"], { callbackUrl: "https://mysite.com/callback" }, undefined, 'merchant'),
        createRequest("Get Dashboard Stats", "GET", ["merchant", "dashboard", "stats"], undefined, undefined, 'merchant'),
        createRequest("Get Balance", "GET", ["merchant", "balance"], undefined, undefined, 'merchant'),
        createRequest("Login History", "GET", ["merchant", "login-history"], undefined, undefined, 'merchant'),
        createRequest("Get Ledger Accounts", "GET", ["merchant", "ledger-accounts"], undefined, undefined, 'merchant'),
        createRequest("Get Ledger Account By ID", "GET", ["merchant", "ledger-accounts", ":accountId"], undefined, undefined, 'merchant')
    ]
};
merchantApp.item?.push(merchantSelf);

// 2.3 Transactions
const merchantTrans: PostmanItem = {
    name: "Transactions",
    item: [
        createRequest("List Transactions", "GET", ["merchant", "transactions"], undefined, [{ key: "limit", value: "20" }], 'merchant'),
        createRequest("Get Transaction Details", "GET", ["merchant", "transactions", ":id"], undefined, undefined, 'merchant')
    ]
};
merchantApp.item?.push(merchantTrans);

// 2.4 Bank Accounts
const merchantBA: PostmanItem = {
    name: "Bank Accounts",
    item: [
        createRequest("List Bank Accounts", "GET", ["merchant", "bank-accounts"], undefined, undefined, 'merchant'),
        createRequest("Create Bank Account", "POST", ["merchant", "bank-accounts"], {
            accountNumber: "1234567890",
            ifsc: "SBIN0001234",
            bankName: "SBI",
            beneficiaryName: "John Doe"
        }, undefined, 'merchant'),
        createRequest("Update Bank Account", "PUT", ["merchant", "bank-accounts", ":id"], { beneficiaryName: "Jane Doe" }, undefined, 'merchant')
    ]
};
merchantApp.item?.push(merchantBA);
collection.item.push(merchantApp);


// 3. Payment Gateway
// 3. Payment Gateway
const payinReq = createRequest("Payin (Checkout)", "POST", ["payment", "payin"], {
    amount: 1499,
    currency: "INR",
    orderId: "INV-2026-00091",
    paymentMode: "UPI",
    customer: {
        name: "Amit",
        phone: "9876543210"
    },
    hash: "b7f9c2d1a8e4...",
    redirectUrl: "https://merchant.com/payment-status",
    merchantId: "MERCHANT_12345"
}, undefined, 'none');

if (payinReq.request) {
    payinReq.request.header.push({ key: "X-Real-IP", value: "127.0.0.1", description: "Mock IP for Testing" });
}

const payoutReq = createRequest("Payout (Withdrawal)", "POST", ["payment", "payout"], {
    amount: 500,
    currency: "INR",
    orderId: "PAYOUT_{{$timestamp}}",
    customer: {
        name: "Rahul Sharma",
        email: "rahul@example.com",
        phone: "9876541230",
        accountNumber: "987654321012",
        ifsc: "HDFC0001234"
    },
    hash: "REQUIRES_SIGNATURE",
    merchantId: "MERCHANT_12345"
}, undefined, 'none');

if (payoutReq.request) {
    payoutReq.request.header.push({ key: "X-Real-IP", value: "127.0.0.1", description: "Mock IP for Testing" });
}

const payment: PostmanItem = {
    name: "Payment Gateway",
    item: [
        payinReq,
        payoutReq,
        createRequest("Check Status", "GET", ["payment", "status", ":orderId"], undefined, undefined, 'none')
    ]
};
collection.item.push(payment);

// 4. Seed
const seed: PostmanItem = {
    name: "Seed / Dev",
    item: [
        createRequest("Seed Transaction", "POST", ["seed", "transaction"], {
            count: 5
        })
    ]
}
// Optionally add seed if needed. Including it as mostly requested "all apis".
collection.item.push(seed);


// --- Write File ---

const outputPath = path.resolve(process.cwd(), 'postman_collection_wisipay.json');
fs.writeFileSync(outputPath, JSON.stringify(collection, null, 2));

console.log(`Postman collection generated at: ${outputPath}`);
