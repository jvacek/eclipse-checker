export type PermissionState = 'idle' | 'prompting' | 'granted' | 'denied';
export type PermissionDeniedReason = 'unsupported' | 'user-denied' | 'error';

export class PermissionError extends Error {
  constructor(
    readonly reason: PermissionDeniedReason,
    message?: string,
  ) {
    super(message ?? `Permission ${reason}`);
    this.name = 'PermissionError';
  }
}

export interface PermissionRequestor<T> {
  readonly fallbackAvailable: boolean;
  isSupported(): boolean;
  request(): Promise<T>;
}

export type PermissionOutcome<T> =
  | { state: 'granted'; data: T }
  | { state: 'denied'; reason: PermissionDeniedReason; fallbackAvailable: boolean };

export async function requestPermission<T>(
  requestor: PermissionRequestor<T>,
): Promise<PermissionOutcome<T>> {
  if (!requestor.isSupported()) {
    return {
      state: 'denied',
      reason: 'unsupported',
      fallbackAvailable: requestor.fallbackAvailable,
    };
  }
  try {
    const data = await requestor.request();
    return { state: 'granted', data };
  } catch (err) {
    const reason = err instanceof PermissionError ? err.reason : 'error';
    return { state: 'denied', reason, fallbackAvailable: requestor.fallbackAvailable };
  }
}
