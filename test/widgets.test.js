import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CAMERA_MOVE } from '../src/camera.js';
import { normalizeConfig } from '../src/config.js';
import { idsOf } from '../src/devices.js';
import {
  CONTROL_WIDGET,
  PRESETS_WIDGET,
  WIDGETS,
  imageKeyOf,
  refreshWidgets,
  resetWidgetNudges,
  widgetImage,
} from '../src/widgets.js';
import { stubCamera, stubManager } from './helpers/stubs.js';

const config = normalizeConfig({ hosts: '192.168.1.50', presets: '1:Entrance, 2:Garden' });
const manyPresets = normalizeConfig({
  hosts: '192.168.1.50',
  presets: '1:A, 2:B, 3:C, 4:D, 5:E, 6:F',
});

function setup(cameraOptions) {
  const gladys = createFakeGladys();
  const camera = stubCamera(cameraOptions);
  const manager = stubManager([camera]);
  const settings = { camera: idsOf(gladys, camera).device };
  return { gladys, camera, manager, settings };
}

const getContent = (key, { gladys, manager, settings }, cfg = config) =>
  WIDGETS[key].get(gladys, { settings, language: 'en', units: 'metric', manager, config: cfg });

test('every widget content is rendered exactly as sent, in every state', async () => {
  const contexts = [
    [CONTROL_WIDGET, setup(), config],
    [CONTROL_WIDGET, setup({ online: false, withImage: false }), config],
    [CONTROL_WIDGET, setup(), normalizeConfig({ motion_events: false })],
    [PRESETS_WIDGET, setup(), config],
    [PRESETS_WIDGET, setup(), manyPresets],
    [PRESETS_WIDGET, setup(), normalizeConfig({})],
    [CONTROL_WIDGET, { ...setup(), settings: {} }, config],
    [CONTROL_WIDGET, { ...setup(), settings: { camera: 'ext:x:camera:gone' } }, config],
  ];
  for (const [key, context, cfg] of contexts) {
    const content = await getContent(key, context, cfg);
    // [] = nothing the core would drop, truncate or trim to the content budget.
    assert.deepEqual(validateWidgetContent(content), [], `${key}: ${JSON.stringify(content)}`);
  }
});

test('the control widget shows the latest image, served by its key', async () => {
  const context = setup();
  const content = await getContent(CONTROL_WIDGET, context);
  const image = content.components.find((component) => component.type === 'image');
  assert.equal(image.key, imageKeyOf(context.camera));
  const base64 = widgetImage(context.manager, image.key);
  assert.deepEqual(validateWidgetImage(base64), []);
  assert.throws(() => widgetImage(context.manager, 'snap-other-0000000000'), /no longer/);
});

test('the control widget buttons move the camera one bounded step', async () => {
  const context = setup();
  const content = await getContent(CONTROL_WIDGET, context);
  const buttons = content.components.filter((component) => component.type === 'button');
  assert.equal(buttons.length, 4);
  for (const { action } of buttons) {
    const toast = await WIDGETS[CONTROL_WIDGET].action(context.gladys, {
      actionKey: action.key,
      params: action.params,
      settings: context.settings,
      manager: context.manager,
      config,
    });
    assert.ok(toast.en.length <= 200);
  }
  assert.deepEqual(
    context.camera.calls.map(([, move]) => move),
    [CAMERA_MOVE.PAN_LEFT, CAMERA_MOVE.PAN_RIGHT, CAMERA_MOVE.TILT_UP, CAMERA_MOVE.TILT_DOWN],
  );
});

test('a widget action on an offline camera fails, so the user sees why', async () => {
  const context = setup({ online: false });
  await assert.rejects(
    WIDGETS[CONTROL_WIDGET].action(context.gladys, {
      actionKey: 'move_left',
      params: { direction: 'left' },
      settings: context.settings,
      manager: context.manager,
      config,
    }),
    /offline/,
  );
  await assert.rejects(
    WIDGETS[CONTROL_WIDGET].action(context.gladys, {
      actionKey: 'unknown',
      params: {},
      settings: context.settings,
      manager: context.manager,
      config,
    }),
    /Unknown widget action/,
  );
});

test('the presets widget recalls a preset from a button or from the form', async () => {
  const context = setup();
  const content = await getContent(PRESETS_WIDGET, context, manyPresets);
  const buttons = content.components.filter((component) => component.type === 'button');
  assert.equal(buttons.length, 4, 'three presets and the "other preset" form');
  const form = buttons.at(-1).action;
  assert.deepEqual(
    form.fields[0].options.map((option) => option.value),
    ['4', '5', '6'],
  );

  const run = (params, values) =>
    WIDGETS[PRESETS_WIDGET].action(context.gladys, {
      actionKey: values ? 'goto_preset_other' : `goto_preset_${params.preset}`,
      params,
      values,
      settings: context.settings,
      manager: context.manager,
      config: manyPresets,
    });
  const toast = await run(buttons[1].action.params);
  assert.equal(toast.en, 'Going to "B".');
  await run({}, { preset: '6' });
  assert.deepEqual(context.camera.calls, [
    ['gotoPreset', 2],
    ['gotoPreset', 6],
  ]);
  await assert.rejects(run({ preset: 42 }), /Unknown preset/);
});

test('refreshWidgets nudges every widget, at most once per 10 s', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  resetWidgetNudges();
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  refreshWidgets(gladys);
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
  t.mock.timers.tick(10_000);
  assert.deepEqual(gladys.fake.widgetRefreshes, [...Object.keys(WIDGETS), ...Object.keys(WIDGETS)]);
  resetWidgetNudges();
});

test('the control widget of the fixed lens shows its image, without arrows', async () => {
  const gladys = createFakeGladys();
  const camera = stubCamera({ dual: true });
  const manager = stubManager([camera]);
  const context = { gladys, manager, settings: { camera: idsOf(gladys, camera, 'fixed').device } };
  const content = await getContent(CONTROL_WIDGET, context);
  assert.deepEqual(validateWidgetContent(content), []);
  const image = content.components.find((component) => component.type === 'image');
  assert.equal(image.key, imageKeyOf(camera, 'fixed'));
  assert.notEqual(image.key, imageKeyOf(camera));
  assert.ok(!content.components.some((component) => component.type === 'button'));
  assert.ok(widgetImage(manager, image.key).length > 0);
});
