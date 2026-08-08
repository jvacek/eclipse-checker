import { useCallback, useState } from 'react';

import { requestPermission, type PermissionOutcome, type PermissionRequestor } from '../sensors';

export interface UsePermissionState<T> {
  state: PermissionOutcome<T> | null;
  pending: boolean;
  request: () => Promise<PermissionOutcome<T>>;
}

export function usePermission<T>(requestor: PermissionRequestor<T>): UsePermissionState<T> {
  const [state, setState] = useState<PermissionOutcome<T> | null>(null);
  const [pending, setPending] = useState(false);

  const request = useCallback(async () => {
    setPending(true);
    try {
      const outcome = await requestPermission(requestor);
      setState(outcome);
      return outcome;
    } finally {
      setPending(false);
    }
  }, [requestor]);

  return { state, pending, request };
}
