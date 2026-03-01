const test = require('node:test');
const assert = require('node:assert/strict');

const { applyEnrichmentArtifact, buildActionableError } = require('../idea-state');

test('applyEnrichmentArtifact merges draft and increments artifact version', () => {
  const previous = {
    ideaId: 'IDEA-1',
    title: 'Initial title',
    description: 'Initial description',
    details: {
      businessGoal: 'Initial goal',
      _ideaArtifactVersion: 2
    }
  };

  const draft = {
    title: 'Enriched title',
    description: 'Enriched description',
    details: {
      businessGoal: 'Updated goal',
      constraints: 'SOC2'
    }
  };

  const next = applyEnrichmentArtifact(previous, draft, { ideaId: 'IDEA-1', version: 3, updatedAt: '2026-03-01T10:00:00.000Z' });

  assert.equal(next.title, 'Enriched title');
  assert.equal(next.description, 'Enriched description');
  assert.equal(next.details.businessGoal, 'Updated goal');
  assert.equal(next.details.constraints, 'SOC2');
  assert.equal(next.details._ideaArtifactVersion, 3);
  assert.equal(next.details._ideaArtifactUpdatedAt, '2026-03-01T10:00:00.000Z');
});

test('buildActionableError returns enrichment and PR action sets', () => {
  const enrich = buildActionableError('enrichment', 'timeout', 'corr-123');
  assert.match(enrich.message, /Enrichment failed: timeout/);
  assert.ok(enrich.actions.includes('Retry'));
  assert.ok(enrich.actions.includes('View logs'));

  const pr = buildActionableError('pr', 'bad credentials', 'corr-789');
  assert.match(pr.message, /PR creation failed: bad credentials/);
  assert.ok(pr.actions.includes('Reconnect GitHub'));
  assert.ok(pr.actions.includes('Retry'));
});
