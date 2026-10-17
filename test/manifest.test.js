// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import { DIRECTIONS } from '../src/camera.js';
import { DEFAULT_CONFIG, SNAPSHOT_SOURCES } from '../src/config.js';
import { DISCOVERY_PORT } from '../src/dvrip/protocol.js';
import { SCENE_ACTIONS, TRIGGERS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// Manifest fields older Gladys releases reject as unknown, with the first
// release accepting them. The store validator refuses a manifest whose
// `gladys_version` minimum is lower: these tests catch it before a release.
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of Object.values(WIDGETS)) {
    assert.equal(typeof widget.get, 'function');
    assert.equal(typeof widget.action, 'function');
  }
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('the move_camera directions are the ones the code knows', () => {
  const direction = manifest.scene_actions
    .find((action) => action.key === 'move_camera')
    .fields.find((field) => field.key === 'direction');
  assert.deepEqual(
    direction.options.map((option) => option.value).sort(),
    Object.keys(DIRECTIONS).sort(),
  );
});

test('the snapshot sources are the ones the code knows', () => {
  const field = manifest.config_schema.find((f) => f.key === 'snapshot_source');
  assert.deepEqual(
    field.options.map((option) => option.value),
    SNAPSHOT_SOURCES,
  );
});

test('capabilities and categories require Gladys >= 5.1.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `scene triggers, scene actions and widgets require gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('the integration is local only, and declares the discovery port it broadcasts on', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [DISCOVERY_PORT] },
  ]);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `field "${field.key}" has no default in the code`);
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
    assert.equal(field.default, undefined, `field "${field.key}": no default with a source`);
  }
});

test('secrets have no default, and scene and widget forms hold none', () => {
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.equal(field.default, undefined, `secret "${field.key}" cannot have a default`);
  }
  const forms = [
    ...manifest.scene_triggers.flatMap((trigger) => trigger.fields ?? []),
    ...manifest.scene_actions.flatMap((action) => action.fields ?? []),
    ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
  ];
  assert.ok(!forms.some((field) => field.type === 'secret'));
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('widget labels hold 3 to 30 characters, descriptions at most 100', () => {
  for (const widget of manifest.widgets) {
    for (const [lang, text] of Object.entries(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `widget ${widget.key} label.${lang}`);
    }
    for (const [lang, text] of Object.entries(widget.description ?? {})) {
      assert.ok(text.length <= 100, `widget ${widget.key} description.${lang}`);
    }
  }
});

test('section texts hold at most 1000 characters per language', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const [lang, text] of Object.entries(section.description ?? {})) {
      assert.ok(text.length <= 1000, `section ${section.key} description.${lang}`);
    }
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
