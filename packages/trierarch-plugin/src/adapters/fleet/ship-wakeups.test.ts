import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FleetId } from '@aeolus-fleet/common';
import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/connection-fakes.js';
import { createWatchFleetInboxes } from '../../core/connection/watch-fleet-inboxes.js';
import { createAnswerPings } from '../../core/connection/answer-pings.js';
import { ok } from '../../core/shared/result.js';
import type { PluginDelivery } from '../../core/connection/ports.js';

import { createShipWakeups } from './ship-wakeups.js';

const encoder = new TextEncoder();

function aStream() {
  let writer: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    write: (text: string) => { writer.enqueue(encoder.encode(text)); },
    close: () => { writer.close(); },
  };
}

async function started(responses: (Response | Error)[] = [], look?: () => Promise<void>) {
  vi.useFakeTimers();
  const streams = [aStream(), aStream()];
  let opened = 0;
  let looks = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  const wakeups = createShipWakeups({
    fleetUrl: 'https://fleet.example',
    fetch: (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-crew');
      const response = responses.shift() ?? streams[Math.min(opened, 1)]?.response;
      opened += 1;
      signals.push(init?.signal);
      if (response instanceof Error) { return Promise.reject(response); }
      return Promise.resolve(response ?? new Response(null, { status: 503 }));
    },
    random: () => 0,
    look: () => { looks += 1; return look?.() ?? Promise.resolve(); },
    ended: () => Promise.resolve(),
    failed: () => undefined,
  });
  const stop = wakeups('test-crew');
  await vi.advanceTimersByTimeAsync(0);
  return { streams, stop, signals, looks: () => looks, opened: () => opened };
}

afterEach(() => vi.useRealTimers());

describe('ship wake stream', () => {
  it('looks on fragmented wake events while the stream remains open', async () => {
    const running = await started();
    running.streams[0]?.write('event: wa');
    running.streams[0]?.write('ke\r\ndata: {"reason":"open"}\r\n\r\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(running.looks()).toBe(1);
    running.streams[0]?.write('event: wake\ndata: {}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(running.looks()).toBe(2);
    running.stop();
  });

  it('reopens a dropped stream after the spread and looks on its open wake', async () => {
    const running = await started();
    running.streams[0]?.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(running.opened()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(running.opened()).toBe(2);
    running.streams[1]?.write('event: wake\ndata: {"reason":"open"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(running.looks()).toBe(1);
    running.stop();
  });

  it('reopens after exactly sixty seconds without bytes', async () => {
    const running = await started();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(running.opened()).toBe(1);
    await vi.advanceTimersByTimeAsync(1001);
    expect(running.opened()).toBe(2);
    running.stop();
  });

  it('looks after five minutes without a wake while keep-alives keep the stream open', async () => {
    const running = await started();
    for (let round = 0; round < 12; round += 1) {
      running.streams[0]?.write(': keep-alive\n\n');
      await vi.advanceTimersByTimeAsync(25_000);
    }
    expect(running.looks()).toBe(1);
    expect(running.opened()).toBe(1);
    running.stop();
  });

  it('stops after an end event without reopening or looking again', async () => {
    const running = await started();
    running.streams[0]?.write('event: end\ndata: {"code":"LEASE_ENDED"}\n\n');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(running.opened()).toBe(1);
    expect(running.looks()).toBe(0);
    running.stop();
  });

  it('stops when opening is refused with LEASE_ENDED', async () => {
    const running = await started([Response.json({ code: 'LEASE_ENDED', message: 'ended' }, { status: 401 })]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(running.opened()).toBe(1);
    expect(running.looks()).toBe(0);
    running.stop();
  });

  it('doubles reopening delays while core is down up to sixty seconds', async () => {
    const running = await started(Array.from({ length: 10 }, () => new Response(null, { status: 503 })));
    for (const delay of [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000]) {
      const before = running.opened();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(running.opened()).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(running.opened()).toBe(before + 1);
    }
    running.stop();
  });
});


describe('wake delivery guarantees', () => {
  it('serializes looks and coalesces wakes during a look into exactly one more look', async () => {
    const first = Promise.withResolvers<undefined>();
    const second = Promise.withResolvers<undefined>();
    let calls = 0;
    let active = 0;
    let maximum = 0;
    const running = await started([], async () => {
      calls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      await (calls === 1 ? first.promise : second.promise);
      active -= 1;
    });
    try {
      running.streams[0]?.write('event: wake\ndata: {}\n\n');
      await vi.advanceTimersByTimeAsync(0);
      running.streams[0]?.write('event: wake\ndata: {}\n\nevent: wake\ndata: {}\n\n');
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);
      first.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(2);
      second.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect({ calls, maximum }).toEqual({ calls: 2, maximum: 1 });
    } finally { first.resolve(undefined); second.resolve(undefined); running.stop(); }
  });

  it('aborts the stream on stop and never reopens or looks again', async () => {
    const running = await started();
    expect(running.signals[0]?.aborted).toBe(false);
    running.stop();
    expect(running.signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(600_000);
    expect({ opened: running.opened(), looks: running.looks() }).toEqual({ opened: 1, looks: 0 });
  });

  it.each([
    { reason: 'a network error', refusal: new Error('network unavailable') },
    { reason: 'a 401 other than LEASE_ENDED', refusal: Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 }) },
  ])('reopens after $reason and receives its open wake', async ({ refusal }) => {
    const running = await started([refusal]);
    try {
      await vi.advanceTimersByTimeAsync(999);
      expect(running.opened()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(running.opened()).toBe(2);
      running.streams[1]?.write('event: wake\ndata: {"reason":"open"}\n\n');
      await vi.advanceTimersByTimeAsync(0);
      expect(running.looks()).toBe(1);
    } finally { running.stop(); }
  });
});


/** Real wake adapters with only the fleet HTTP stream and inbox replaced. */
async function deliveryWatcher(answer: (fleetId: FleetId) => Promise<void>) {
  vi.useFakeTimers();
  const connections = memoryConnectionStore();
  for (const fleetId of [FLEET_ID, OTHER_FLEET_ID]) {
    await connections.save({ fleetId, shipId: SHIP_ID, name: 'plugin', crewToken: fleetId, crewedAt: new Date(0) });
  }
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const watcher = createWatchFleetInboxes({
    connections, isServed: () => Promise.resolve(true), answer,
    start: (crewToken, events) => createShipWakeups({
      fleetUrl: 'https://fleet.example', ...events, random: () => 0,
      failed: (error) => { throw error; },
      fetch: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
        start(controller) { streams.set(crewToken, controller); },
      }))),
    })(crewToken),
  });
  const wake = (fleetId: FleetId) => streams.get(fleetId)?.enqueue(new TextEncoder().encode('event: wake\ndata: {"reason":"open"}\n\n'));
  return { watcher, connections, wake, streams };
}

it('a slow look in one fleet does not block another fleet', async () => {
  const slow = Promise.withResolvers<undefined>();
  const answered: FleetId[] = [];
  const running = await deliveryWatcher(async (fleetId) => {
    if (fleetId === FLEET_ID) { await slow.promise; }
    answered.push(fleetId);
  });
  try {
    await running.watcher.reconcile();
    running.wake(FLEET_ID);
    await vi.advanceTimersByTimeAsync(0);
    running.wake(OTHER_FLEET_ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toEqual([OTHER_FLEET_ID]);
    slow.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toEqual([OTHER_FLEET_ID, FLEET_ID]);
  } finally { slow.resolve(undefined); running.watcher.close(); }
});

it('after restart reconciles then receives a delivery stored while the stream was down on the open wake', async () => {
  const waiting: PluginDelivery[] = [];
  const acked: string[] = [];
  const received: FleetId[] = [];
  const running = await deliveryWatcher(async (fleetId) => {
    received.push(fleetId);
    await answer(fleetId);
  });
  const answer = createAnswerPings({
    connections: running.connections,
    inbox: {
      receive: () => Promise.resolve(ok(waiting.splice(0))),
      ack: (_token, deliveryId) => { acked.push(deliveryId); return Promise.resolve(ok(undefined)); },
      pong: () => Promise.resolve(ok(undefined)),
    },
    keepUsage: () => Promise.resolve({ kind: 'notUsage' }),
    answerAsk: () => Promise.resolve({ kind: 'notAsk' }),
  });
  try {
    await running.watcher.reconcile();
    running.watcher.close();
    const delivery: PluginDelivery = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9ans', messageId: 'msg_01m3tbfspe96yf1rnr4ank9ans', contentType: 'text/plain', senderShipId: SHIP_ID, senderType: 'agent', senderStatus: 'crewed', payload: 'stored while down' };
    waiting.push(delivery);
    // The restarted process restores the same persisted connections, then opens its streams.
    const restarted = createWatchFleetInboxes({
      connections: running.connections, isServed: () => Promise.resolve(true),
      answer: async (fleetId) => { received.push(fleetId); await answer(fleetId); },
      start: (token, events) => createShipWakeups({
        fleetUrl: 'https://fleet.example', ...events, failed: (error) => { throw error; },
        fetch: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          start(controller) { running.streams.set(token, controller); },
        }))),
      })(token),
    });
    try {
      expect(acked).toEqual([]);
      await restarted.reconcile();
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toEqual([]);
      running.wake(FLEET_ID);
      await vi.advanceTimersByTimeAsync(0);
      expect(received).toEqual([FLEET_ID]);
      expect(acked).toEqual([delivery.deliveryId]);
      expect(waiting).toEqual([]);
    } finally { restarted.close(); }
  } finally { running.watcher.close(); }
});
