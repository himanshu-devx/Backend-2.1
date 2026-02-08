import { ENV } from "@/config/env";

// --- 1. BASE LAYOUT & STYLES (MODERNIZED) ---

// Defining a cleaner, more accessible color palette
const COLORS = {
  primary: "#1E70BF", // Deep Blue
  success: "#04AA6D", // Green for positive action
  warning: "#FFC300", // Yellow for security/reset
  backgroundLight: "#f9f9f9",
  textDark: "#212529",
  border: "#dee2e6",
};

const baseStyles = {
  font: `font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.65; color: ${COLORS.textDark};`,
  container: `max-width: 600px; margin: 0 auto; padding: 0; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 20px rgba(0, 0, 0, 0.08);`,
  header: `background-color: ${COLORS.primary}; padding: 30px 20px; text-align: center;`,
  headerLogo: `color: #ffffff; font-size: 28px; font-weight: 700; text-decoration: none;`,
  content: `padding: 30px 40px;`,
  button: (color: string) =>
    `display: inline-block; padding: 14px 30px; margin: 25px 0; background-color: ${color}; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 17px; transition: background-color 0.3s ease;`,
  footer: `margin-top: 40px; padding: 20px 40px; border-top: 1px solid ${COLORS.border}; font-size: 13px; color: #6c757d; text-align: center; background-color: ${COLORS.backgroundLight};`,
  tableHeader: `padding: 12px; background-color: ${COLORS.backgroundLight}; width: 40%; border: 1px solid ${COLORS.border}; font-weight: 600;`,
  tableData: `padding: 12px; font-weight: bold; border: 1px solid ${COLORS.border};`,
  alertDanger: `color: #dc3545; font-weight: bold; padding: 10px; border: 1px solid #f5c6cb; background-color: #f8d7da; border-radius: 4px; margin: 20px 0;`,
};

/**
 * The reusable HTML shell/layout for all emails.
 */
const baseEmailLayout = (bodyContentHtml: string) => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Email Notification</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f4f4f4; ${baseStyles.font
  }">
      <div style="padding: 30px 0;">
          <div style="${baseStyles.container}">
              
              <div style="${baseStyles.header}">
                  <a href="#" style="${baseStyles.headerLogo}">${ENV.APP_BRAND_NAME
  }</a>
              </div>
              
              <div style="${baseStyles.content}">
                  ${bodyContentHtml}
              </div>
              
              <div style="${baseStyles.footer}">
                  <p>Questions? Contact our support team: <a href="mailto:${ENV.SMTP_USER
  }" style="color: ${COLORS.primary}; text-decoration: none;">${ENV.SMTP_USER
  }</a></p>
                  <p>This is an automated message. Please do not reply directly. | &copy; ${new Date().getFullYear()} ${ENV.APP_BRAND_NAME
  }.</p>
              </div>

          </div>
      </div>
  </body>
  </html>
`;

// --- 2. TEMPLATE CONTEXT TYPES & MAP ---

export type MerchantWelcomeContext = {
  name: string;
  loginURL: string;
  loginId: string;
  initialPassword: string;
};

export type AdminWelcomeContext = {
  name: string;
  loginUrl: string;
  loginId: string;
  initialPassword: string;
  role: string;
};

export type PasswordResetContext = {
  name: string;
  resetLink: string;
};

export type OtpVerificationContext = {
  name: string;
  otp: string;
};

export type EmailTemplateContextMap = {
  MERCHANT_WELCOME: MerchantWelcomeContext;
  ADMIN_WELCOME: AdminWelcomeContext;
  PASSWORD_RESET: PasswordResetContext;
  OTP_VERIFICATION: OtpVerificationContext;
  REPORT_READY: {
    reportId: string;
    reportType: string;
    ownerName: string;
    summary?: {
      openingBalance: string;
      closingBalance: string;
      debitTotal: string;
      creditTotal: string;
    }
  };
};

export type EmailTemplateId = keyof EmailTemplateContextMap;

export type EmailTemplateResult = {
  subject: string;
  html: string;
  text: string;
};

type EmailTemplateFnMap = {
  [K in EmailTemplateId]: (
    ctx: EmailTemplateContextMap[K]
  ) => EmailTemplateResult;
};

// --- 3. TEMPLATE DEFINITIONS ---

export const emailTemplates: EmailTemplateFnMap = {
  // 1. 🤝 MERCHANT WELCOME Template
  MERCHANT_WELCOME: (ctx) => {
    const bodyContent = `
      <h1 style="color: ${COLORS.primary
      }; font-size: 26px;">Welcome Aboard, <strong>${ctx.name}</strong>!</h1>
      <p>We are thrilled to have you as a new merchant on ${ENV.APP_BRAND_NAME
      }. Your account is ready.</p>

      <h3 style="color: ${COLORS.textDark
      }; margin-top: 25px;">🔑 Your Login Credentials:</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="${baseStyles.tableHeader
      }"><strong>Login ID (Email/Username):</strong></td>
          <td style="${baseStyles.tableData}; color: ${COLORS.primary};">${ctx.loginId
      }</td>
        </tr>
        <tr>
          <td style="${baseStyles.tableHeader
      }"><strong>Temporary Password:</strong></td>
          <td style="${baseStyles.tableData}; color: #dc3545;">${ctx.initialPassword
      }</td>
        </tr>
      </table>

      <div style="${baseStyles.alertDanger}">
        ⚠️ <strong>Security Alert:</strong> You must change this temporary password immediately after logging in.
      </div>
      
      <p style="text-align: center;">
        <a href="${ctx.loginURL}" style="${baseStyles.button(
        COLORS.success
      )}">Go to Login Page</a>
      </p>

      <p>Please use the 'Reset Password' link on the login page to initiate a secure change of your temporary password.</p>
    `;

    return {
      subject: `Welcome to ${ENV.APP_BRAND_NAME}, ${ctx.name}! Your Merchant Account is Ready.`,
      html: baseEmailLayout(bodyContent),
      text: `Welcome ${ctx.name}! Your merchant account is ready. Login ID: ${ctx.loginId}. Temporary Password: ${ctx.initialPassword}. Go to Login Page: ${ctx.loginURL}. Please change your password immediately.`,
    };
  },

  // 2. 👑 ADMIN WELCOME Template
  ADMIN_WELCOME: (ctx) => {
    const bodyContent = `
      <h1 style="color: ${COLORS.primary
      }; font-size: 26px;">Administrator Access Granted</h1>
      <p>Hello <strong>${ctx.name}</strong>, </p>
      <p>Your administrator account for <strong>${ENV.APP_BRAND_NAME
      }</strong> is active. Below are your temporary credentials and role details.</p>
      
      <h3 style="color: ${COLORS.textDark
      }; margin-top: 25px;">🔑 Account Details:</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr>
          <td style="${baseStyles.tableHeader
      }"><strong>Login ID (Email/Username):</strong></td>
          <td style="${baseStyles.tableData}; color: ${COLORS.primary};">${ctx.loginId
      }</td>
        </tr>
        <tr>
          <td style="${baseStyles.tableHeader
      }"><strong>Temporary Password:</strong></td>
          <td style="${baseStyles.tableData}; color: #dc3545;">${ctx.initialPassword
      }</td>
        </tr>
        <tr>
          <td style="${baseStyles.tableHeader
      }"><strong>Assigned Role:</strong></td>
          <td style="${baseStyles.tableData}; color: ${COLORS.primary
      }; font-weight: 700;">${ctx.role}</td>
        </tr>
      </table>
      
      <h3 style="margin-top: 30px;">🔐 Action Required: Secure Your Account</h3>
      <p>Please use the credentials above to log in now. For security, you <strong>must change this temporary password immediately</strong> using the <strong>'Reset Password'</strong> link on the login page.</p>
      
      <p style="text-align: center;">
        <a href="${ctx.loginUrl}" style="${baseStyles.button(
        COLORS.primary
      )}">Go to Login Page</a>
      </p>
    `;

    return {
      subject: `Welcome to the Admin Panel, ${ctx.name} - Action Required`,
      html: baseEmailLayout(bodyContent),
      text: `Welcome ${ctx.name}. Role: ${ctx.role}. Login ID: ${ctx.loginId}. Temporary Password: ${ctx.initialPassword}. Login here: ${ctx.loginUrl}. Please change your password immediately.`,
    };
  },

  // 3. 🔒 PASSWORD RESET Template
  PASSWORD_RESET: (ctx) => {
    const bodyContent = `
      <div style="text-align: center;">
        <h1 style="color: ${COLORS.warning}; font-size: 24px; margin-bottom: 20px;">Forgot your password?</h1>
        <p style="color: ${COLORS.textDark}; font-size: 16px;">Hello <strong>${ctx.name}</strong>,</p>
        <p style="color: #555;">We received a request to reset your password. Click the button below to choose a new one.</p>
        
        <div style="margin: 35px 0;">
          <a href="${ctx.resetLink}" style="${baseStyles
        .button(COLORS.warning)
        .replace("color: #ffffff", "color: #000000")}; padding: 16px 40px; border-radius: 50px;">Reset Password</a>
        </div>

        <p style="font-size: 13px; color: #888; margin-top: 30px;"><strong>Link valid for 1 hour.</strong> If you didn't request this, you can safely ignore this email.</p>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
        
        <p style="font-size: 12px; color: #999;">If the button doesn't work, copy this link:</p>
        <p style="font-size: 12px; word-break: break-all;"><a href="${ctx.resetLink
      }" style="color: ${COLORS.primary};">${ctx.resetLink}</a></p>
      </div>
    `;

    return {
      subject: `Action Required: Reset Your Password for ${ENV.APP_BRAND_NAME}`,
      html: baseEmailLayout(bodyContent),
      text: `Hello ${ctx.name}. Your password reset link is: ${ctx.resetLink}. This link will expire soon. If you didn't request this, ignore this email.`,
    };
  },

  // 4. 🛡️ OTP VERIFICATION Template
  OTP_VERIFICATION: (ctx) => {
    const bodyContent = `
      <div style="text-align: center;">
        <h1 style="color: ${COLORS.primary}; font-size: 24px; margin-bottom: 10px;">Login Verification</h1>
        <p style="color: ${COLORS.textDark}; font-size: 16px;">Hello <strong>${ctx.name}</strong>,</p>
        <p style="color: #555;">Use the code below to complete your login verification.</p>
        
        <div style="background-color: #f0f4f8; border-left: 4px solid ${COLORS.primary}; border-radius: 4px; padding: 25px; margin: 30px 0;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: ${COLORS.primary}; font-family: 'Courier New', monospace; display: block;">${ctx.otp}</span>
        </div>

        <p style="color: #888; font-size: 13px;">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color: #888; font-size: 13px; margin-top: 20px;">If you didn't request this code, please secure your account immediately.</p>
      </div>
    `;

    return {
      subject: `Your Login Verification Code - ${ENV.APP_BRAND_NAME}`,
      html: baseEmailLayout(bodyContent),
      text: `Hello ${ctx.name}. Your verification code is: ${ctx.otp}. This code expires in 10 minutes. If you didn't reqest this, secure your account immediately.`,
    };
  },

  // 5. 📊 REPORT READY Template (Premium Design)
  REPORT_READY: (ctx) => {
    const summaryHtml = ctx.summary ? `
      <div style="background-color: #f8f9fa; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 25px; margin: 25px 0;">
        <h3 style="margin-top: 0; color: ${COLORS.textDark}; font-size: 18px; text-transform: uppercase; border-bottom: 2px solid ${COLORS.primary}; padding-bottom: 10px;">PERIOD SUMMARY</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <tr>
            <td style="padding: 10px 0; color: #666;"><i>Opening Balance:</i></td>
            <td style="padding: 10px 0; text-align: right; font-weight: 700;">${ctx.summary.openingBalance}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #666;"><i>Total Debits:</i></td>
            <td style="padding: 10px 0; text-align: right; font-weight: 700; color: #dc3545;">- ${ctx.summary.debitTotal}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #666;"><i>Total Credits:</i></td>
            <td style="padding: 10px 0; text-align: right; font-weight: 700; color: ${COLORS.success};">+ ${ctx.summary.creditTotal}</td>
          </tr>
          <tr style="border-top: 2px solid ${COLORS.border};">
            <td style="padding: 15px 0 0 0; font-size: 16px; font-weight: bold; text-transform: uppercase;"><b>CLOSING BALANCE:</b></td>
            <td style="padding: 15px 0 0 0; text-align: right; font-size: 16px; font-weight: 800; color: ${COLORS.primary};">${ctx.summary.closingBalance}</td>
          </tr>
        </table>
      </div>
    ` : '';

    const bodyContent = `
      <h1 style="color: ${COLORS.primary}; font-size: 26px; border-bottom: 1px solid ${COLORS.border}; padding-bottom: 15px;">REPORT NOTIFICATION</h1>
      <p>Hello <strong>${ctx.ownerName}</strong>,</p>
      <p>Your <b>${ctx.reportType}</b> report has been successfully generated and is now available for download.</p>
      
      ${summaryHtml}

      <div style="background-color: #e7f3ff; border-left: 5px solid ${COLORS.primary}; padding: 20px; border-radius: 4px; margin: 30px 0;">
        <p style="margin: 0; font-size: 14px; color: ${COLORS.primary};">
          <b>REPORT ID:</b> ${ctx.reportId}<br/>
          <i>Status: COMPLETED</i><br/>
          <i>Policy: Available for download for 7 days.</i>
        </p>
      </div>

      <p style="text-align: center; margin: 40px 0;">
        <a href="${ENV.FRONTEND_URL || '#'}/reports" style="${baseStyles.button(COLORS.success)}">DOWNLOAD REPORT</a>
      </p>

      <p style="font-size: 13px; color: #888; border-top: 1px solid ${COLORS.border}; padding-top: 15px;"><b>Security Note:</b> This report contains sensitive financial statistics. Handle according to organization policy.</p>
    `;

    const brandPrefix = (ENV.APP_BRAND_PREFIX || ENV.APP_BRAND_NAME || "APP").toUpperCase();

    return {
      subject: `[${brandPrefix}] ${ctx.reportType} Report - ${ctx.reportId}`,
      html: baseEmailLayout(bodyContent),
      text: `Hello ${ctx.ownerName}. Your ${ctx.reportType} report (${ctx.reportId}) is ready for download.`,
    };
  },
};

export const EmailTemplate = {
  MERCHANT_WELCOME: "MERCHANT_WELCOME" as EmailTemplateId,
  ADMIN_WELCOME: "ADMIN_WELCOME" as EmailTemplateId,
  PASSWORD_RESET: "PASSWORD_RESET" as EmailTemplateId,
  OTP_VERIFICATION: "OTP_VERIFICATION" as EmailTemplateId,
  REPORT_READY: "REPORT_READY" as EmailTemplateId,
} as const;
