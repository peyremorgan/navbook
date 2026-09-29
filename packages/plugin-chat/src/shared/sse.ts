/**
 * Server-sent events, read off a fetch body: the one parser both halves use.
 *
 * The model endpoint streams its reply this way, and so does the server's
 * `chat` subscription to the browser. Nothing here is Node-specific — a
 * `ReadableStream` and a `TextDecoder` — so the web layer imports it too.
 */

/** One event: its name (`message` when none was given) and its data. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * The events of a server-sent event stream, in order.
 *
 * Events are separated by a blank line, a payload may span several `data:`
 * lines, `\r\n` and `\r` end a line as `\n` does, and a line starting with
 * `:` is a comment — a keep-alive, usually.
 */
export async function* parseSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let data: string[] = [];
  let event = "";
  const reader = body.getReader();
  const flush = (): SseEvent | null => {
    const out =
      data.length > 0 ? { event: event === "" ? "message" : event, data: data.join("\n") } : null;
    data = [];
    event = "";
    return out;
  };
  const take = (line: string): void => {
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end = lineEnd(buffer, done);
      while (end !== null) {
        const line = buffer.slice(0, end.at);
        buffer = buffer.slice(end.at + end.length);
        if (line === "") {
          const out = flush();
          if (out !== null) yield out;
        } else {
          take(line);
        }
        end = lineEnd(buffer, done);
      }
      if (done) break;
    }
    // A stream that ends without its final blank line still said something.
    if (buffer !== "") take(buffer);
    const out = flush();
    if (out !== null) yield out;
  } finally {
    reader.releaseLock();
    await body.cancel().catch(() => undefined);
  }
}

/** Just the payloads, for a stream whose events are all of one kind. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const event of parseSseEvents(body)) yield event.data;
}

function lineEnd(buffer: string, done: boolean): { at: number; length: number } | null {
  const lf = buffer.indexOf("\n");
  const cr = buffer.indexOf("\r");
  if (lf === -1 && cr === -1) return null;
  if (cr !== -1 && (lf === -1 || cr < lf)) {
    // A `\r` at the very end may be the first half of `\r\n`: wait for more.
    if (cr === buffer.length - 1 && !done) return null;
    return { at: cr, length: buffer[cr + 1] === "\n" ? 2 : 1 };
  }
  return { at: lf, length: 1 };
}
