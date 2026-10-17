import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES, MESSAGES, joinMessages, t, truncateMessage } from '../src/i18n.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every message exists in English, French, German and Spanish, with the same placeholders', () => {
  for (const [key, entry] of Object.entries(MESSAGES)) {
    assert.deepEqual(Object.keys(entry).sort(), [...LANGUAGES].sort(), `message "${key}"`);
    for (const lang of LANGUAGES) {
      assert.ok(entry[lang].length > 0, `message "${key}" is empty in ${lang}`);
      assert.deepEqual(
        placeholders(entry[lang]),
        placeholders(entry.en),
        `message "${key}" (${lang}) has other placeholders than in English`,
      );
    }
  }
});

test('t replaces the placeholders, including nested messages', () => {
  const message = t('camera_error', { host: '1.2.3.4', error: 'timeout' });
  assert.equal(message.en, '1.2.3.4: unreachable (timeout)');
  assert.equal(message.de, '1.2.3.4: nicht erreichbar (timeout)');
  const nested = t('ago_now', { kind: t('detection_person') });
  assert.equal(nested.fr, 'Personne, à l’instant');
  assert.equal(nested.es, 'Persona, ahora mismo');
  assert.throws(() => t('nope'), /Unknown message/);
});

test('joinMessages and truncateMessage work language by language', () => {
  const joined = joinMessages([t('move_left'), '/', t('move_right')]);
  assert.equal(joined.es, 'Izquierda / Derecha');
  assert.equal(truncateMessage({ en: 'abcdef' }, 4).en, 'abc…');
});

test('every text of the manifest is translated in the four languages', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  // A multi-language object is an object whose keys are language codes.
  const missing = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    const keys = Object.keys(node);
    if (keys.includes('en') && keys.every((key) => /^[a-z]{2}(-[A-Z]{2})?$/.test(key))) {
      for (const lang of LANGUAGES) {
        if (typeof node[lang] !== 'string' || node[lang].length === 0) {
          missing.push(`${path}.${lang}`);
        }
      }
      return;
    }
    for (const key of keys) {
      visit(node[key], `${path}.${key}`);
    }
  };
  visit(manifest, 'manifest');
  assert.deepEqual(missing, []);
});

test('the user documentation exists in the four languages', async () => {
  for (const lang of LANGUAGES) {
    const doc = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
    // The store indexes a documentation of at least 300 characters.
    assert.ok(doc.trim().length >= 300, `docs/${lang}.md is too short`);
  }
});
