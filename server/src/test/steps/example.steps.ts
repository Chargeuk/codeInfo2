import assert from 'assert';
import { When, Then } from '@cucumber/cucumber';
import fetch from 'node-fetch';

type HealthResponse = { status: string; uptime: number; timestamp: number };
let response: { status: number; body: HealthResponse } | null = null;

When('I call the health endpoint', async () => {
  const res = await fetch('http://localhost:5010/health');
  response = { status: res.status, body: (await res.json()) as HealthResponse };
});

Then('I receive status ok', () => {
  assert(response, 'expected response');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
});
