import { afterEach, describe, expect, it, vi } from 'vitest';

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

async function started(responses: Response[] = []) {
  vi.useFakeTimers();
  const streams = [aStream(), aStream()];
  let opened = 0;
  let looks = 0;
  const wakeups = createShipWakeups({
    fleetUrl: 'https://fleet.example',
    fetch: (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-crew');
      const response = responses.shift() ?? streams[Math.min(opened, 1)]?.response;
      opened += 1;
      return Promise.resolve(response ?? new Response(null, { status: 503 }));
    },
    random: () => 0,
    look: () => { looks += 1; return Promise.resolve(); },
    ended: () => Promise.resolve(),
    failed: () => undefined,
  });
  const stop = wakeups('test-crew');
  await vi.advanceTimersByTimeAsync(0);
  return { streams, stop, looks: () => looks, opened: () => opened };
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
