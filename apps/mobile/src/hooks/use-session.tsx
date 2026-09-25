import type { Session } from '@orbit-hub/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { authClient } from '@/lib/auth';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionContextValue {
  status: SessionStatus;
  session: Session | null;
  user: Session['user'] | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    locale: string;
  }) => Promise<'authenticated' | 'email_verification_required'>;
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

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await authClient.login(email, password);
    setSession(next);
    setStatus('authenticated');
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

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      signIn,
      register,
      signOut,
    }),
    [register, session, signIn, signOut, status],
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
