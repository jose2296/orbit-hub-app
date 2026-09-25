import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export type ConnectionState = 'online' | 'offline' | 'unknown';

export interface NetworkStatus {
  isOnline: boolean;
  isInternetReachable: boolean;
  type: string;
  state: ConnectionState;
}

/**
 * Connectivity drives the sync state: offline never means "broken", it means
 * "keep working locally".
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    isInternetReachable: true,
    type: 'unknown',
    state: 'unknown',
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable !== false;
      const connected = state.isConnected !== false && reachable;
      setStatus({
        isOnline: connected,
        isInternetReachable: reachable,
        type: state.type,
        state: connected ? 'online' : 'offline',
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return status;
}
