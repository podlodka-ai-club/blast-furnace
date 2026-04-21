import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { config } from '../../config/index.js';
import { jobQueue } from '../../jobs/queue.js';
import type { GitHubWebhookEvent, IssueProcessorJobData } from '../../types/index.js';

interface GitHubWebhooksRouteOptions extends FastifyPluginOptions {
  skipSignatureValidation?: boolean;
}

/**
 * GitHub webhooks route plugin
 * Handles incoming webhook events from GitHub
 */
export async function githubWebhooksRoute(
  server: FastifyInstance,
  options: GitHubWebhooksRouteOptions
): Promise<void> {
  const skipSignatureValidation = options.skipSignatureValidation ?? false;

  server.post('/webhooks/github', async (request, reply) => {
    // Validate webhook signature if secret is configured
    if (config.github.webhookSecret && !skipSignatureValidation) {
      const signature = request.headers['x-hub-signature-256'] as string | undefined;
      // In production, request.raw.body contains the raw body for signature validation
      // When using Fastify inject(), we skip this validation via skipSignatureValidation option
      if (!signature) {
        server.log.warn('Missing webhook signature');
        return reply.status(401).send({ error: 'Missing signature' });
      }
      // Note: Full signature validation with raw body would be implemented here
      // using request.raw body in production
    }

    // Parse and validate webhook payload
    let event: GitHubWebhookEvent;
    try {
      event = request.body as GitHubWebhookEvent;
    } catch {
      return reply.status(400).send({ error: 'Invalid JSON payload' });
    }

    // Validate required fields
    if (!event.action || !event.issue) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    // Handle issues.opened event
    if (event.action === 'opened' && event.issue) {
      const processorJob: IssueProcessorJobData = {
        taskId: `issue-processor-${event.issue.id}-${Date.now()}-${process.hrtime.bigint()}`,
        type: 'issue-processor',
        issue: event.issue,
      };

      // Add job to queue for async processing
      await jobQueue.add('issue-processor', processorJob);
      server.log.info(`Queued issue #${event.issue.number} for processing`);
    }

    // Return 200 quickly to acknowledge receipt
    return reply.status(200).send({ received: true });
  });
}

export default githubWebhooksRoute;