import { useAuth } from '@/context/AuthContext';

export default function Dashboard() {
  const { cmsUser, signOut } = useAuth();

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Bonjour, {cmsUser?.display_name}</h1>
        <button onClick={signOut}>Se déconnecter</button>
      </div>
      <p>Rôle : {cmsUser?.role}</p>
      <p style={{ color: '#666' }}>
        Prochaine étape : formulaire de rédaction de recette (rédacteur) et écran de validation (admin).
      </p>
    </div>
  );
}
