// Server-Sent Events fan-out to every open dashboard.
export function createLiveHub({ heartbeatMs = 25_000 } = {}) {
  const clients = new Set();

  const timer = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, heartbeatMs);
  timer.unref();

  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  return {
    attach(req, res, initial) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      if (initial) res.write(frame(initial.event, initial.data));
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    broadcast(event, data) {
      const payload = frame(event, data);
      for (const res of clients) res.write(payload);
    },
    get size() {
      return clients.size;
    },
    close() {
      clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
