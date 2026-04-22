import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/index.js';
import { jobQueue } from '../../jobs/queue.js';
import type { GitHubIssue, GitHubWebhookEvent, IssueProcessorJobData } from '../../types/index.js';

interface RawGitHubWebhookIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: string[];
  assignee: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Map raw GitHub webhook issue payload (snake_case) to GitHubIssue type (camelCase)
 */
function mapWebhookIssue(rawIssue: RawGitHubWebhookIssue): GitHubIssue {
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

interface GitHubWebhooksRouteOptions extends FastifyPluginOptions {
  skipSignatureValidation?: boolean;
}

/**
 * Validate GitHub webhook signature using HMAC SHA256
 */
function validateSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  // Use timingSafeEqual to prevent timing attacks
  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(signatureBuffer, expectedBuffer);
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
      if (!signature) {
        server.log.warn('Missing webhook signature');
        return reply.status(401).send({ error: 'Missing signature' });
      }
      // Use raw body bytes for signature validation (GitHub signs the exact raw bytes)
      const rawBody = (request as unknown as { rawBody: Buffer }).rawBody?.toString('utf-8') ?? JSON.stringify(request.body);
      if (!validateSignature(rawBody, signature, config.github.webhookSecret)) {
        server.log.warn('Invalid webhook signature');
        return reply.status(401).send({ error: 'Invalid signature' });
      }
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

    // Validate issue has required fields
    const rawIssue = event.issue as unknown as RawGitHubWebhookIssue;
    if (
      typeof rawIssue.id !== 'number' ||
      typeof rawIssue.number !== 'number' ||
      typeof rawIssue.title !== 'string' ||
      !rawIssue.created_at ||
      !rawIssue.updated_at
    ) {
      return reply.status(400).send({ error: 'Invalid issue payload' });
    }

    // Map to camelCase GitHubIssue type
    const issue = mapWebhookIssue(rawIssue);

    // Handle issues.opened event
    if (event.action === 'opened' && event.issue) {
      const processorJob: IssueProcessorJobData = {
        taskId: `issue-processor-${issue.id}-${Date.now()}`,
        type: 'issue-processor',
        issue,
      };

      // Add job to queue for async processing
      await jobQueue.add('issue-processor', processorJob);
      server.log.info(`Queued issue #${issue.number} for processing`);
    }

    // Return 200 quickly to acknowledge receipt
    return reply.status(200).send({ received: true });
  });
}

export default githubWebhooksRoute;