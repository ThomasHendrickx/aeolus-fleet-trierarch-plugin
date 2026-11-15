/** REST wake hints drive serialized looks; bytes, including comments, keep the connection alive. */
const SILENCE_MS = 60_000;
const SAFETY_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60_000;

interface WakeupsOptions {
  fleetUrl: string;
  fetch?: typeof fetch;
  random?: () => number;
  look: () => Promise<void>;
  ended: () => Promise<void>;
  failed: (error: unknown) => void;
}

/** Opens one stream for a lease, returning its cancellation function. Deliveries always come from look. */
export function createShipWakeups(options: WakeupsOptions): (crewToken: string) => () => void {
  return (crewToken) => {
    const state = { isStopped: false, isPending: false };
    const isActive = () => !state.isStopped;
    const hasPending = () => state.isPending;
    let isLooking = false;
    let safety: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let abort: AbortController | undefined;
    let backoffMs = 1000 + (options.random ?? Math.random)() * 4000;
    const stop = () => {
      state.isStopped = true;
      clearTimeout(safety);
      clearTimeout(retry);
      abort?.abort();
    };
    const ended = () => {
      stop();
      void options.ended().catch(options.failed);
    };
    const look = async (): Promise<void> => {
      if (state.isStopped) { return; }
      clearTimeout(safety);
      safety = setTimeout(() => { void look(); }, SAFETY_MS);
      if (isLooking) { state.isPending = true; return; }
      isLooking = true;
      do {
        state.isPending = false;
        await options.look().catch(options.failed);
      } while (hasPending() && isActive());
      isLooking = false;
    };
    const open = async (): Promise<void> => {
      const controller = new AbortController();
      const isReading = () => isActive() && !controller.signal.aborted;
      abort = controller;
      let silence = setTimeout(() => { controller.abort(); }, SILENCE_MS);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancel = () => { void reader?.cancel().catch(options.failed); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        const response = await (options.fetch ?? fetch)(`${options.fleetUrl}/api/v1/ship/wakeups`, {
          headers: { authorization: `Bearer ${crewToken}`, accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (response.status === 401) {
          const refusal: unknown = await response.json();
          if (typeof refusal === 'object' && refusal !== null && 'code' in refusal && refusal.code === 'LEASE_ENDED') {
            ended();
            return;
          }
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return;
        }
        reader = response.body.getReader();
        if (controller.signal.aborted) { return; }
        const decoder = new TextDecoder();
        let pending = '';
        let event = '';
        let data = '';
        while (isReading()) {
          const read = await reader.read();
          if (read.done) { break; }
          clearTimeout(silence);
          silence = setTimeout(() => { controller.abort(); }, SILENCE_MS);
          pending += decoder.decode(read.value, { stream: true });
          let newline: number;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline).replace(/\r$/, '');
            pending = pending.slice(newline + 1);
            if (line === '') {
              if (event === 'wake') {
                backoffMs = 1000 + (options.random ?? Math.random)() * 4000;
                void look();
              } else if (event === 'end' && data.includes('LEASE_ENDED')) {
                ended();
              }
              event = '';
              data = '';
            } else if (line.startsWith('event:')) {
              event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data += line.slice(5).trim();
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) { options.failed(error); }
      } finally {
        clearTimeout(silence);
        controller.signal.removeEventListener('abort', cancel);
        await reader?.cancel().catch(options.failed);
        if (!state.isStopped) {
          retry = setTimeout(() => { void open(); }, backoffMs);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
      }
    };
    safety = setTimeout(() => { void look(); }, SAFETY_MS);
    void open();
    return stop;
  };
}
