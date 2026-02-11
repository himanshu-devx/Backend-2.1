import { WebhookWorkflow } from "@/workflows/webhook.workflow";

export class WebhookService {
    private workflow: WebhookWorkflow;
    constructor() {
        this.workflow = new WebhookWorkflow();
    }
    async processWebhook(
        type: "PAYIN" | "PAYOUT",
        providerId: string,
        legalEntityId: string,
        rawBody: string
    ) {
        return this.workflow.execute(type, providerId, legalEntityId, rawBody);
    }
}

export const webhookService = new WebhookService();
