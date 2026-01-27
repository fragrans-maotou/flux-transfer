/**
 * Flux Transfer Service Worker
 * Handles streaming downloads by acting as a MITM proxy
 * 
 * This Service Worker intercepts download requests and streams data
 * directly to the user's disk without memory limitations.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

interface DownloadStream {
  readable: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  filename: string;
}

// Map of active download streams
const downloadStreams = new Map<string, DownloadStream>();

/**
 * Install event - activate immediately
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

/**
 * Activate event - claim all clients
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Message event - handle stream initialization and data
 */
self.addEventListener('message', (event) => {
  const { type, downloadId, filename, data } = event.data;

  switch (type) {
    case 'STREAM_DOWNLOAD_INIT': {
      // Create a new ReadableStream for this download
      let controller: ReadableStreamDefaultController<Uint8Array>;

      const readable = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
        cancel() {
          // Stream was cancelled by the browser
          downloadStreams.delete(downloadId);
        },
      });

      downloadStreams.set(downloadId, {
        readable,
        controller: controller!,
        filename,
      });

      // Get the port from the message
      const port = event.ports[0];
      if (port) {
        port.onmessage = (portEvent) => {
          const stream = downloadStreams.get(downloadId);
          if (!stream) return;

          const { type: msgType, data: msgData } = portEvent.data;

          switch (msgType) {
            case 'WRITE':
              stream.controller.enqueue(new Uint8Array(msgData));
              break;
            case 'CLOSE':
              stream.controller.close();
              downloadStreams.delete(downloadId);
              break;
            case 'ABORT':
              stream.controller.error(new Error('Download aborted'));
              downloadStreams.delete(downloadId);
              break;
          }
        };
      }

      // Trigger the download by opening an iframe or navigating
      // This is done by sending a fetch request that we'll intercept
      const downloadUrl = `/flux-transfer-download/${downloadId}/${encodeURIComponent(filename)}`;

      // Notify the client to navigate to the download URL
      if (event.source && 'postMessage' in event.source) {
        (event.source as Client).postMessage({
          type: 'DOWNLOAD_READY',
          downloadId,
          url: downloadUrl,
        });
      }
      break;
    }
  }
});

/**
 * Fetch event - intercept download requests
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if this is a download request we should handle
  const downloadMatch = url.pathname.match(/^\/flux-transfer-download\/([^/]+)\/(.+)$/);

  if (downloadMatch) {
    const downloadId = downloadMatch[1];
    const filename = decodeURIComponent(downloadMatch[2]);

    const stream = downloadStreams.get(downloadId);

    if (stream) {
      // Create response headers for download
      const headers = new Headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Prevent caching
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });

      // Respond with the stream
      event.respondWith(
        new Response(stream.readable, {
          status: 200,
          statusText: 'OK',
          headers,
        })
      );
    } else {
      // Stream not found
      event.respondWith(
        new Response('Download not found', { status: 404 })
      );
    }
  }

  // For all other requests, let them pass through
});

/**
 * Periodic cleanup of stale streams
 */
setInterval(() => {
  // Clean up any streams that haven't received data in a while
  // This is a simple implementation; production would need timestamps
  if (downloadStreams.size > 100) {
    // Too many streams, something is wrong
    downloadStreams.clear();
  }
}, 60000);

export { };
