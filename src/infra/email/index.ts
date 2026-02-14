import { EmailService } from "@/services/email.service";
import { createEmailProvider, type EmailProviderName } from "./provider";
import { ENV } from "@/config/env";

const providerName = (ENV.MAIL_PROVIDER || "zeptomail") as EmailProviderName;
const provider = createEmailProvider(providerName);

export const emailService = new EmailService(provider);
