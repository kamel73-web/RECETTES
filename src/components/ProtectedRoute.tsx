import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import type { ReactNode } from 'react';

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, cmsUser, loading } = useAuth();

  if (loading) return <p>Chargement…</p>;
  if (!session || !cmsUser) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
