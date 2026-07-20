import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSignalResponse } from '../../lib/focus/build-popup.js';

test('a non-study decision produces popup.shouldShow=true (the field the extension checks)', () => {
  const r = buildSignalResponse({ type: 'non-study', voiceText: 'back to it', chatMessage: 'You drifted — reopen notes.', suggestedAction: 'reopen notes', reason: 'off goal' }, { url: 'https://tiktok.com' });
  assert.equal(r.popup.shouldShow, true);
  assert.equal(r.popup.type, 'intervention');
  assert.equal(r.popup.chatMessage, 'You drifted — reopen notes.');
  assert.equal(r.popup.page.url, 'https://tiktok.com');
  assert.equal(r.popup.ai.type, 'non-study');
});

test('a study decision produces popup.shouldShow=false (no overlay)', () => {
  const r = buildSignalResponse({ type: 'study', voiceText: '', chatMessage: '', suggestedAction: '', reason: 'on task' }, { url: 'https://stackoverflow.com' });
  assert.equal(r.popup.shouldShow, false);
  assert.equal(r.popup.type, 'study');
});

test('non-study with empty message does not force a popup (nothing to say)', () => {
  const r = buildSignalResponse({ type: 'non-study', chatMessage: '', voiceText: '' }, { url: 'x' });
  assert.equal(r.popup.shouldShow, false);
});
