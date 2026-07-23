import type { INetworkResponse } from '../core/types';

export class HTTPError<T = unknown> extends Error {
  constructor(readonly response: INetworkResponse<T>) {
    super('HTTP ' + response.status + ' ' + response.statusText);
    this.name = 'HTTPError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class NetworkTimeoutError extends NetworkError {
  constructor(readonly timeout: number, cause?: unknown) {
    super('Request timed out after ' + timeout + 'ms', cause);
    this.name = 'NetworkTimeoutError';
  }
}
