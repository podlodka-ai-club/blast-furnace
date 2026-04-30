import { describe, expect, it } from 'vitest';
import {
  extractSingleTrackerMarker,
  markerMatches,
  parseTrackerCommentMarker,
  renderTrackerCommentMarker,
} from './markers.js';

const marker = {
  kind: 'orchestrator-status' as const,
  runId: 'run-123',
  owner: 'owner',
  repo: 'repo',
  issue: 42,
};

describe('tracker comment markers', () => {
  it('renders and parses a strict status marker', () => {
    const line = renderTrackerCommentMarker(marker);

    expect(line).toBe('<!-- blast-furnace:tracker-comment kind=orchestrator-status runId=run-123 owner=owner repo=repo issue=42 -->');
    expect(parseTrackerCommentMarker(line)).toEqual(marker);
  });

  it('rejects malformed, duplicate, and unsupported markers', () => {
    expect(parseTrackerCommentMarker('not a marker')).toBeNull();
    expect(parseTrackerCommentMarker('<!-- blast-furnace:tracker-comment kind=bad runId=run-123 owner=owner repo=repo issue=42 -->')).toBeNull();
    expect(parseTrackerCommentMarker('<!-- blast-furnace:tracker-comment kind=orchestrator-status kind=orchestrator-status runId=run-123 owner=owner repo=repo issue=42 -->')).toBeNull();
    expect(parseTrackerCommentMarker('<!-- blast-furnace:tracker-comment kind=orchestrator-status runId=run-123 owner=owner repo=repo issue=nope -->')).toBeNull();
  });

  it('requires exactly one marker in a comment body', () => {
    const line = renderTrackerCommentMarker(marker);

    expect(extractSingleTrackerMarker(`${line}\n\n# Body`)).toEqual(marker);
    expect(extractSingleTrackerMarker(`# Body`)).toBeNull();
    expect(extractSingleTrackerMarker(`${line}\n${line}`)).toBeNull();
  });

  it('matches all identity fields', () => {
    expect(markerMatches(marker, marker)).toBe(true);
    expect(markerMatches({ ...marker, runId: 'other' }, marker)).toBe(false);
    expect(markerMatches({ ...marker, issue: 43 }, marker)).toBe(false);
    expect(markerMatches(null, marker)).toBe(false);
  });
});
