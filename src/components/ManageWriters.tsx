import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface CmsUserRow {
  id: string;
  email: string | null;
  role: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px',
  marginTop: 4,
  marginBottom: 10,
  boxSizing: 'border-box',
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export default function ManageWriters() {
  const [users, setUsers] = useState<CmsUserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('cms_users')
      .select('id, email, role, display_name, is_active, created_at')
      .order('created_at');

    if (loadError) {
      setError(`Erreur de chargement : ${loadError.message}`);
    } else {
      setUsers(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!email.trim() || !password || !displayName.trim()) {
      setError('Email, mot de passe et nom affiché sont tous requis.');
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const { data, error: fnError } = await supabase.functions.invoke('create-cms-user', {
      body: { email: email.trim(), password, display_name: displayName.trim() },
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });

    setCreating(false);

    if (fnError) {
      let detail = fnError.message;
      const ctx = (fnError as unknown as { context?: Response }).context;
      if (ctx) {
        try {
          const body = await ctx.json();
          if (body?.error) detail = body.error;
        } catch {
          // corps non exploitable
        }
      }
      setError(`Échec de la création : ${detail}`);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }

    setNotice(
      `Compte créé pour ${email.trim()}. Transmets-lui l'email et ce mot de passe : "${password}" (il ne sera plus jamais affiché).`
    );
    setEmail('');
    setPassword('');
    setDisplayName('');
    load();
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 16, marginBottom: 20 }}>
      <h3>Comptes rédacteurs</h3>

      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {notice && <p style={{ color: '#0a7d2c' }}>{notice}</p>}

      <div style={{ marginBottom: 16 }}>
        <label>Nom affiché</label>
        <input style={inputStyle} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />

        <label>Email</label>
        <input
          type="email"
          style={inputStyle}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label>Mot de passe</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            style={{ ...inputStyle, flex: 1 }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" onClick={() => setPassword(generatePassword())}>
            Générer
          </button>
        </div>

        <button type="button" disabled={creating} onClick={handleCreate}>
          {creating ? 'Création…' : 'Créer le compte rédacteur'}
        </button>
      </div>

      {loading ? (
        <p>Chargement…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th>Nom</th>
              <th>Email</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Créé le</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{u.display_name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.is_active ? 'Actif' : 'Désactivé'}</td>
                <td>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
