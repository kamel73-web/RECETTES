import { Link } from 'react-router-dom';
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
      <p>
        <Link to="/recipes/new">+ Nouvelle recette</Link>
      </p>
      <p style={{ color: '#666' }}>
        Prochaine étape : liste des brouillons et écran de validation admin (section 7 du cahier des charges).
      </p>
    </div>
  );
}
