import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type CmsRole = 'admin' | 'redacteur';

interface CmsUser {
  id: string;
  role: CmsRole;
  display_name: string;
  is_active: boolean;
}

interface AuthState {
  session: Session | null;
  cmsUser: CmsUser | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

async function loadCmsUser(userId: string): Promise<CmsUser | null> {
  const { data, error } = await supabase
    .from('cms_users')
    .select('id, role, display_name, is_active')
    .eq('id', userId)
    .single();

  if (error || !data) return null;
  return data as CmsUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [cmsUser, setCmsUser] = useState<CmsUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) {
        const user = await loadCmsUser(session.user.id);
        setCmsUser(user);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        const user = await loadCmsUser(session.user.id);
        setCmsUser(user);
      } else {
        setCmsUser(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    setError(null);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError('Identifiants incorrects.');
      throw authError;
    }

    const user = await loadCmsUser(data.user.id);

    // Un compte auth.users sans ligne cms_users associée, ou désactivé,
    // n'a aucun droit d'accès au CMS — même si l'authentification a réussi.
    if (!user || !user.is_active) {
      await supabase.auth.signOut();
      setError('Ce compte n\'a pas accès au CMS ou a été désactivé.');
      throw new Error('cms access denied');
    }

    setCmsUser(user);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setCmsUser(null);
  };

  return (
    <AuthContext.Provider value={{ session, cmsUser, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return ctx;
}
