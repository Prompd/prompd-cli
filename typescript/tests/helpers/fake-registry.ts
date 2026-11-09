import * as http from 'http';

export interface Pkg { name: string; version: string; bytes: Uint8Array }

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface PutReply { status: number; body?: unknown }

export interface ServeOptions {
  /** When set, downloads need `Authorization: Bearer <token>`; without it they answer 404, as the registry does for a hidden version. */
  requireToken?: string;
  /** Answer for PUT requests. Default: 201 `{ success: true }`. */
  onPut?: (request: RecordedRequest) => PutReply;
}

export type Registry = {
  url: string;
  close: () => Promise<void>;
  /** Decoded URL of every request, in order. */
  hits: string[];
  /** Every request with method, headers and body, in order. */
  requests: RecordedRequest[];
  pkgs: Pkg[];
};

export function serve(pkgs: Pkg[], options: ServeOptions = {}): Promise<Registry> {
  const hits: string[] = [];
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = decodeURIComponent(req.url ?? '');
      const recorded: RecordedRequest = { method: req.method ?? 'GET', url, headers: req.headers, body: Buffer.concat(chunks) };
      hits.push(url);
      requests.push(recorded);

      if (recorded.method === 'PUT') {
        const reply = options.onPut ? options.onPut(recorded) : { status: 201, body: { success: true } };
        res.statusCode = reply.status;
        res.setHeader('content-type', 'application/json');
        res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
        return;
      }

      const versions = /^\/packages\/(@[^/]+\/[^/]+)\/versions$/.exec(url);
      const download = /^\/packages\/(@[^/]+\/[^/]+)\/download\/([^/]+)$/.exec(url);
      const info = /^\/packages\/(@[^/]+\/[^/]+)$/.exec(url);
      if (versions) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(pkgs.filter((p) => p.name === versions[1]).map((p) => ({ version: p.version }))));
        return;
      }
      if (download) {
        const authorized = !options.requireToken || req.headers.authorization === `Bearer ${options.requireToken}`;
        const p = authorized ? pkgs.find((x) => x.name === download[1] && x.version === download[2]) : undefined;
        if (!p) { res.statusCode = 404; res.end(); return; }
        res.setHeader('content-type', 'application/zip');
        res.end(Buffer.from(p.bytes));
        return;
      }
      if (info) {
        const mine = pkgs.filter((p) => p.name === info[1]);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ name: info[1], version: mine[mine.length - 1]?.version }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, hits, requests, pkgs, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
