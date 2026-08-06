import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipAllowed, normalizeIp } from '../src/auth/ipMatch';

test('exact IPv4 match', () => {
  assert.equal(ipAllowed('203.0.113.10', '203.0.113.10'), true);
  assert.equal(ipAllowed('203.0.113.11', '203.0.113.10'), false);
});

test('comma-separated allowlist', () => {
  const list = '203.0.113.10, 198.51.100.5';
  assert.equal(ipAllowed('198.51.100.5', list), true);
  assert.equal(ipAllowed('203.0.113.10', list), true);
  assert.equal(ipAllowed('8.8.8.8', list), false);
});

test('IPv4 CIDR range', () => {
  assert.equal(ipAllowed('203.0.113.42', '203.0.113.0/24'), true);
  assert.equal(ipAllowed('203.0.114.1', '203.0.113.0/24'), false);
  assert.equal(ipAllowed('10.1.2.3', '10.0.0.0/8'), true);
  assert.equal(ipAllowed('11.0.0.1', '10.0.0.0/8'), false);
});

test('empty allowlist allows everyone (never strands the team)', () => {
  assert.equal(ipAllowed('8.8.8.8', ''), true);
  assert.equal(ipAllowed('8.8.8.8', '   '), true);
});

test('IPv4-mapped IPv6 is unwrapped before comparison', () => {
  assert.equal(normalizeIp('::ffff:203.0.113.10'), '203.0.113.10');
  assert.equal(ipAllowed('::ffff:203.0.113.10', '203.0.113.0/24'), true);
});

test('IPv6 exact match (no CIDR for v6)', () => {
  assert.equal(ipAllowed('::1', '::1'), true);
  assert.equal(ipAllowed('::2', '::1'), false);
});

test('malformed entries never crash and never match', () => {
  assert.equal(ipAllowed('203.0.113.10', 'not-an-ip'), false);
  assert.equal(ipAllowed('203.0.113.10', '203.0.113.10/99'), false);
  assert.equal(ipAllowed('999.0.0.1', '999.0.0.1'), true); // exact string still matches itself
});
