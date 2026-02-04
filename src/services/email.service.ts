import type { Logger } from "pino";
import type { EmailProvider } from "@/infra/email/provider";
import {
  emailTemplates,
  type EmailTemplateId,
  type EmailTemplateContextMap,
} from "@/infra/email/templates";

export class EmailService {
  constructor(private provider: EmailProvider) {}

  async sendRaw(
    payload: {
      to: string | string[];
      subject: string;
      html: string;
      text?: string;
    },
    logger?: Logger
  ) {
    await this.provider.sendMail(payload, logger);
  }

  async sendTemplate<T extends EmailTemplateId>(
    templateId: T,
    to: string | string[],
    context: EmailTemplateContextMap[T],
    logger?: Logger
  ) {
    try {
      const tmpl = emailTemplates[templateId](context);

      await this.provider.sendMail(
        {
          to,
          subject: tmpl.subject,
          html: tmpl.html,
          text: tmpl.text,
        },
        logger
      );
    } catch (error) {
      logger?.error(error);
      throw error;
    }
  }
}
