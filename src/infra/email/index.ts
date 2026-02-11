// src/infra/email/index.ts
import { MailerSendEmailProvider } from "./provider";
import { EmailService } from "@/services/email.service";

export const emailService = new EmailService(new MailerSendEmailProvider());
