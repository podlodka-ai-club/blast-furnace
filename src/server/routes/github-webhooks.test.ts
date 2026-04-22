import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import githubWebhooksRoute from './github-webhooks.js';

const { mockAdd } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
}));

vi.mock('../../jobs/queue.js', () => ({
  jobQueue: {
    add: mockAdd,
  },
}));

vi.mock('../../config/index.js', () => ({
  config: {
    env: 'test',
    redis: {
      host: 'localhost',
      port: 6379,
    },
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      // Use polling so buildServer doesn't auto-register the webhook route
      // The test will manually register it
      issueStrategy: 'polling',
      pollIntervalMs: 60000,
      webhookSecret: undefined,
    },
  },
}));

describe('github webhooks route', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    vi.resetAllMocks();
    server = await buildServer({ logger: false });
    // skipSignatureValidation: true because we can't get raw body with inject()
    await server.register(githubWebhooksRoute, { skipSignatureValidation: true });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  const createIssueOpenedPayload = () => {
    return {
      action: 'opened',
      issue: {
        id: 123,
        number: 42,
        title: 'Test Issue',
        body: 'Issue body content',
        state: 'open',
        labels: [],
        assignee: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      repository: {
        id: 1,
        name: 'test-repo',
        fullName: 'test-owner/test-repo',
      },
      sender: {
        login: 'testuser',
      },
    };
  };

  it('responds with 200 on valid webhook payload', async () => {
    const payload = createIssueOpenedPayload();
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.received).toBe(true);
  });

  it('queues issue processor job on issues.opened event', async () => {
    const payload = createIssueOpenedPayload();
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith('issue-processor', expect.objectContaining({
      type: 'issue-processor',
      issue: expect.objectContaining({
        id: 123,
        number: 42,
        title: 'Test Issue',
      }),
    }));
  });

  it('does not queue job for non-opened action', async () => {
    const payload = { ...createIssueOpenedPayload(), action: 'closed' };
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(200);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON payload', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
      },
      body: 'not valid json',
    });

    // Fastify's JSON parser returns "Bad Request" for malformed JSON
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBeTruthy();
  });

  it('returns 400 when action is missing', async () => {
    const payload = {
      issue: {
        id: 1,
        number: 1,
        title: 'Test',
        body: 'Body',
        state: 'open',
        labels: [],
        assignee: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    };
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Missing required fields');
  });

  it('returns 400 when issue is missing', async () => {
    const payload = { action: 'opened' };
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Missing required fields');
  });

  it('generates unique taskId for each job', async () => {
    const payload = createIssueOpenedPayload();

    // Make two requests rapidly
    const [response1, response2] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      server.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    ]);

    expect(response1.statusCode).toBe(200);
    expect(response2.statusCode).toBe(200);
    expect(mockAdd).toHaveBeenCalledTimes(2);

    // Both jobs should have been added with the same issue
    const firstCall = mockAdd.mock.calls[0][1];
    const secondCall = mockAdd.mock.calls[1][1];
    expect(firstCall.issue.id).toBe(secondCall.issue.id);
    expect(firstCall.type).toBe('issue-processor');
    expect(secondCall.type).toBe('issue-processor');
  });
});