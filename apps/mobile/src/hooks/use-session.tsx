import type { Device, Session } from '@orbit-hub/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { authClient, EmailVerificationRequiredError } from '@/lib/auth';
import { startSyncEngine, stopSyncEngine } from '@/lib/offline';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionContextValue {
  status: SessionStatus;
  session: Session | null;
  user: Session['user'] | null;
  signIn: (email: string, password: string) => Promise<'authenticated' | 'email_verification_required'>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    locale: string;
  }) => Promise<'authenticated' | 'email_verification_required'>;
  listDevices: () => Promise<Device[]>;
  revokeDevice: (sessionId: string) => Promise<void>;
  signOut: (allDevices?: boolean) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    authClient.configure();

    let active = true;
    void authClient.restore().then((restored) => {
      if (!active) return;
      setSession(restored);
      setStatus(restored ? 'authenticated' : 'anonymous');
    });

    const unsubscribe = authClient.subscribe((event) => {
      if (!active) return;
      if (event.type === 'signed-out') {
        setSession(null);
        setStatus('anonymous');
        return;
      }
      setSession(event.session);
      setStatus('authenticated');
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Syncing follows the session, not any one screen: a write made on the home
  // tab and one made on a workspace screen reach the server the same way.
  useEffect(() => {
    if (status === 'authenticated') {
      startSyncEngine();
      return stopSyncEngine;
    }
    if (status === 'anonymous') {
      stopSyncEngine();
    }
    return undefined;
  }, [status]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const next = await authClient.login(email, password);
      setSession(next);
      setStatus('authenticated');
      return 'authenticated' as const;
    } catch (error) {
      if (error instanceof EmailVerificationRequiredError) {
        return 'email_verification_required' as const;
      }
      throw error;
    }
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string; locale: string }) => {
      const result = await authClient.register(input);
      if (result.status === 'authenticated') {
        setSession(result.session);
        setStatus('authenticated');
        return 'authenticated' as const;
      }
      return 'email_verification_required' as const;
    },
    [],
  );

  const signOut = useCallback(async (allDevices = false) => {
    await authClient.signOut(allDevices);
    setSession(null);
    setStatus('anonymous');
  }, []);

  const listDevices = useCallback(() => authClient.listDevices(), []);
  const revokeDevice = useCallback((sessionId: string) => authClient.revokeDevice(sessionId), []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      signIn,
      register,
      listDevices,
      revokeDevice,
      signOut,
    }),
    [listDevices, register, revokeDevice, session, signIn, signOut, status],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return context;
}
