// src/infra/email/index.ts
import { SendGridEmailProvider } from "./sendgrid.provider";
import { ZohoApiEmailProvider } from "./zoho-api.provider"; // Kept for rollback
import { EmailService } from "@/services/email.service";

// Currently using SendGrid. To revert to Zoho, change this to: new ZohoApiEmailProvider()
// export const emailService = new EmailService(new SendGridEmailProvider());
export const emailService = new EmailService(new ZohoApiEmailProvider());
