import { getController } from "@/server/run/controller";

export const dynamic = "force-dynamic";

/**
 * Server-sent events for the benchmark page. Dropping this connection does not
 * stop or slow the runners; a reconnecting page receives the full snapshot.
 */
export async function GET(request: Request) {
  const controller = getController();
  const encoder = new TextEncoder();

  let cleanup = () => {};

  const stream = new ReadableStream({
    start(streamController) {
      let closed = false;

      // ReadableStream ignores a value returned from start(), so teardown is
      // held here and invoked from cancel() and from the request abort signal.
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          streamController.enqueue(chunk);
        } catch {
          // The client went away between the check and the write.
          cleanup();
        }
      };

      const unsubscribe = controller.subscribe((snapshot) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
      });

      /**
       * 5s heartbeat as a named event.
       *
       * A bare `:` comment keeps the socket warm but is never delivered to
       * EventSource handlers, so the page could not use it to tell a live
       * stream from one whose server handler died. A named event is
       * observable, which is what the page's watchdog needs.
       */
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
      }, 5000);

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      // Runner state lives in the controller, not in this connection.
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
