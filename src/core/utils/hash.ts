import SparkMD5 from 'spark-md5';

export async function computeFileHash(
  file: File,
  chunkSize: number,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const hash = new SparkMD5.ArrayBuffer();
  const chunkCount = Math.max(1, Math.ceil(file.size / chunkSize));

  for (let index = 0; index < chunkCount; index += 1) {
    throwIfAborted(signal);
    const start = index * chunkSize;
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    const buffer = await readBlob(chunk, signal);
    throwIfAborted(signal);
    hash.append(buffer);
    onProgress?.(Math.round(((index + 1) / chunkCount) * 100));
  }

  return hash.end();
}

function readBlob(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();

    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.onabort = () => reject(new DOMException('The operation was aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    reader.readAsArrayBuffer(blob);
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}
