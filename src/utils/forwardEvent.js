/*!
 * Copyright (C) 2025 PearDrive
 * Copyright (C) 2025 Jenna Baudelaire
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @remarks Forward events from emitter to another emitter
 *
 * @protected
 */

/**
 * Forward events from emitter to another emitter
 *
 * @param {import('ready-resource')} emitterFrom
 * @param {import('ready-resource')} emitterTo
 * @param {Array<string>} eventNames
 */
export function forwardEvent(emitterFrom, emitterTo, eventNames, opts = {}) {
  if (typeof eventNames === "string") eventNames = [eventNames];
  const { emit = emitterTo.emit.bind(emitterTo), shouldAttach = () => true } =
    opts;

  const listeners = eventNames.map(
    (name) =>
      (...args) =>
        emit(name, ...args)
  );

  function onNewListener(name) {
    const i = eventNames.indexOf(name);
    if (i !== -1 && emitterTo.listenerCount(name) === 0 && shouldAttach(name)) {
      emitterFrom.on(name, listeners[i]);
    }
  }
  function onRemoveListener(name) {
    const i = eventNames.indexOf(name);
    if (i !== -1 && emitterTo.listenerCount(name) === 0) {
      emitterFrom.off(name, listeners[i]);
    }
  }

  emitterTo.on("newListener", onNewListener);
  emitterTo.on("removeListener", onRemoveListener);

  return () => {
    emitterTo.off("newListener", onNewListener);
    emitterTo.off("removeListener", onRemoveListener);
    eventNames.forEach((name, i) => emitterFrom.off(name, listeners[i]));
  };
}
