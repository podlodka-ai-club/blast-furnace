import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/index.js';
import { jobQueue } from '../../jobs/queue.js';
function mapWebhookIssue(rawIssue) {
    return {
        id: rawIssue.id,
        number: rawIssue.number,
        title: rawIssue.title,
        body: rawIssue.body,
        state: rawIssue.state,
        labels: rawIssue.labels,
        assignee: rawIssue.assignee,
        createdAt: rawIssue.created_at,
        updatedAt: rawIssue.updated_at,
    };
}
function validateSignature(payload, signature, secret) {
    const expectedSignature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return timingSafeEqual(signatureBuffer, expectedBuffer);
}
export async function githubWebhooksRoute(server, options) {
    const skipSignatureValidation = options.skipSignatureValidation ?? false;
    server.post('/webhooks/github', async (request, reply) => {
        if (config.github.webhookSecret && !skipSignatureValidation) {
            const signature = request.headers['x-hub-signature-256'];
            if (!signature) {
                server.log.warn('Missing webhook signature');
                return reply.status(401).send({ error: 'Missing signature' });
            }
            const rawBody = request.rawBody?.toString('utf-8') ?? JSON.stringify(request.body);
            if (!validateSignature(rawBody, signature, config.github.webhookSecret)) {
                server.log.warn('Invalid webhook signature');
                return reply.status(401).send({ error: 'Invalid signature' });
            }
        }
        let event;
        try {
            event = request.body;
        }
        catch {
            return reply.status(400).send({ error: 'Invalid JSON payload' });
        }
        if (!event.action || !event.issue) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }
        const rawIssue = event.issue;
        if (typeof rawIssue.id !== 'number' ||
            typeof rawIssue.number !== 'number' ||
            typeof rawIssue.title !== 'string' ||
            !rawIssue.created_at ||
            !rawIssue.updated_at) {
            return reply.status(400).send({ error: 'Invalid issue payload' });
        }
        const issue = mapWebhookIssue(rawIssue);
        if (event.action === 'opened' && event.issue) {
            const processorJob = {
                taskId: `issue-processor-${issue.id}-${Date.now()}`,
                type: 'issue-processor',
                issue,
            };
            await jobQueue.add('issue-processor', processorJob);
            server.log.info(`Queued issue #${issue.number} for processing`);
        }
        return reply.status(200).send({ received: true });
    });
}
export default githubWebhooksRoute;
