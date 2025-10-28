

import { supabase } from './supabaseClient.js'

export async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name')
    .eq('email', email)
    .limit(1)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name
  };
}
