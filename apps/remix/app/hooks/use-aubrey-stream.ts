import { useCallback, useRef, useState } from 'react';

/**
 * Drives an Aubrey turn over SSE and exposes the steps as they happen.
 *
 * `EventSource` can't POST, so this reads the response body directly. The parser
 * below is deliberately small but does handle the one thing that bites: a chunk
 * boundary can fall anywhere, including mid-event, so partial text is carried
 * over rather than parsed and dropped.
 */

export type AubreyStep =
  | { kind: 'thinking' }
  | { kind: 'tool'; name: string; label: string; status: 'running' }
  | { kind: 'tool'; name: string; label: string; status: 'done'; ms: number }
  | { kind: 'composing' };

export type AubreyDone = {
  conversationId: string;
  messageId: string;
  content: string;
  credit?: unknown;
};

type Options = {
  onDone: (result: AubreyDone) => void;
  onError: (message: string) => void;
};

export function useAubreyStream({ onDone, onError }: Options) {
  const [steps, setSteps] = useState<AubreyStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => setSteps([]), []);

  const send = useCallback(
    async (message: string, conversationId?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSteps([]);
      setIsRunning(true);

      try {
        const response = await fetch('/api/aubrey/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, conversationId }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          onError(
            response.status === 401
              ? 'Your session expired. Sign in again to keep chatting.'
              : 'Aubrey could not be reached. Try again.',
          );
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Events are separated by a blank line. Anything after the last one
          // is an incomplete event — keep it for the next chunk.
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '));
            const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
            if (!eventLine || !dataLine) continue; // comment/heartbeat

            const name = eventLine.slice(7).trim();
            let payload: unknown;
            try {
              payload = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }

            if (name === 'progress') {
              const step = payload as AubreyStep;

              setSteps((current) => {
                // A tool's `done` replaces its own `running` entry rather than
                // appending, so the list reads as a checklist rather than
                // doubling every step.
                if (step.kind === 'tool' && step.status === 'done') {
                  const index = current.findIndex(
                    (s) => s.kind === 'tool' && s.name === step.name && s.status === 'running',
                  );
                  if (index !== -1) {
                    const next = [...current];
                    next[index] = step;
                    return next;
                  }
                }

                // "Thinking" is transient scaffolding between real steps; only
                // ever show the latest one.
                if (step.kind === 'thinking' || step.kind === 'composing') {
                  const withoutTransient = current.filter(
                    (s) => s.kind !== 'thinking' && s.kind !== 'composing',
                  );
                  return [...withoutTransient, step];
                }

                return [...current, step];
              });
            } else if (name === 'done') {
              onDone(payload as AubreyDone);
            } else if (name === 'error') {
              onError((payload as { message?: string }).message ?? 'Aubrey failed.');
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          onError('Lost the connection to Aubrey. Try again.');
        }
      } finally {
        setIsRunning(false);
        abortRef.current = null;
      }
    },
    [onDone, onError],
  );

  return { send, steps, isRunning, reset };
}
