import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/service.ts';
test('preserves the existing service behavior', () => assert.equal(total(3, 2), 5));
