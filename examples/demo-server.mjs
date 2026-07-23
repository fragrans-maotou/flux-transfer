import { createServer } from 'node:http';
import { Readable } from 'node:stream';

export async function startDemoServer() {
  const uploads = new Map();
  const requests = [];

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      requests.push({ method: request.method, path: url.pathname });

      if (request.method === 'GET' && url.pathname === '/upload/status') {
        const upload = uploads.get(url.searchParams.get('filename'));
        sendJson(response, 200, {
          uploadedChunks: upload ? [...upload.chunks.keys()].sort((a, b) => a - b) : [],
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/upload') {
        const form = await toWebRequest(request).formData();
        const file = form.get('file');
        sendJson(response, 200, { filename: file.name, size: file.size, direct: true });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/upload/chunk') {
        const form = await toWebRequest(request).formData();
        const filename = String(form.get('filename'));
        const chunkIndex = Number(form.get('chunkIndex'));
        const totalChunks = Number(form.get('totalChunks'));
        const chunk = form.get('file');
        const upload = uploads.get(filename) ?? { totalChunks, chunks: new Map() };
        upload.totalChunks = totalChunks;
        upload.chunks.set(chunkIndex, chunk.size);
        uploads.set(filename, upload);
        sendJson(response, 200, { filename, chunkIndex });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/upload/complete') {
        const body = await toWebRequest(request).json();
        const upload = uploads.get(body.filename);
        const receivedChunks = upload?.chunks.size ?? 0;
        const size = upload
          ? [...upload.chunks.values()].reduce((total, chunkSize) => total + chunkSize, 0)
          : 0;
        sendJson(response, receivedChunks === body.totalChunks ? 200 : 409, {
          filename: body.filename,
          totalChunks: body.totalChunks,
          receivedChunks,
          size,
          complete: receivedChunks === body.totalChunks,
        });
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Demo server did not bind a port');

  return {
    baseUrl: 'http://127.0.0.1:' + address.port,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function toWebRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request('http://127.0.0.1' + request.url, {
    method: request.method,
    headers,
    body: Readable.toWeb(request),
    duplex: 'half',
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}
