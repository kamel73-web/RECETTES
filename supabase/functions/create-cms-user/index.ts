// supabase/functions/create-cms-user/index.ts
//
// Appelée uniquement par un admin authentifié. Crée un compte Supabase Auth
// (email + mot de passe) puis la ligne cms_users correspondante (role='redacteur').
// Nécessite la clé service_role — la création de comptes auth ne peut pas se
// faire depuis le client (RLS n'a rien à voir ici, c'est l'API Admin Supabase).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Authorization manquante.' }, 401);

    // Vérification admin via le client "appelant" (clé anon + session de l'utilisateur)
    const callerClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: isAdmin, error: adminCheckError } = await callerClient.rpc('is_cms_admin');
    if (adminCheckError || !isAdmin) {
      return jsonResponse({ error: 'Accès refusé : réservé aux admins.' }, 403);
    }

    const { email, password, display_name } = await req.json();
    if (!email || !password || !display_name) {
      return jsonResponse({ error: 'email, password et display_name sont requis.' }, 400);
    }
    if (password.length < 8) {
      return jsonResponse({ error: 'Le mot de passe doit faire au moins 8 caractères.' }, 400);
    }

    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // pas d'email de confirmation à gérer, accès immédiat
    });

    if (createError || !newUser?.user) {
      return jsonResponse(
        { error: `Échec de création du compte : ${createError?.message ?? 'erreur inconnue'}` },
        500
      );
    }

    const { error: insertError } = await serviceClient.from('cms_users').insert({
      id: newUser.user.id,
      email,
      role: 'redacteur',
      display_name,
      is_active: true,
    });

    if (insertError) {
      // Rollback : pas de compte auth orphelin sans ligne cms_users associée.
      await serviceClient.auth.admin.deleteUser(newUser.user.id);
      return jsonResponse({ error: `Échec de création du profil CMS : ${insertError.message}` }, 500);
    }

    return jsonResponse({ success: true, id: newUser.user.id });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Erreur inconnue.' }, 500);
  }
});
