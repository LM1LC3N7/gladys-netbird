// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, WIDGETS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle --------------------------------------------
  gladys.onScanRequest(() => app.publishDiscovery());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceUpdated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // --- Read only: every command is refused with a clear message -------------------
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // --- Configuration screen button --------------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // --- Dashboard widget: built from the last reading, no request of its own --------
  gladys.onWidgetGet(WIDGETS.PEERS, (options) => app.getWidget(options));

  // --- Configuration saved by the user: a token refused earlier is tried again.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated: restarting');
    return app.start(config, { force: true });
  });

  // --- Connection lifecycle: (re)start on every connection (status and
  // Discovery sent again), pause while Gladys is away. A refusal or a pause
  // kept in /data survives both.
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
  gladys.on('disconnected', () => app.stop());
}
