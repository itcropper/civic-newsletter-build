import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default supabase;

/**
 * Direct SQL query helper using Supabase's postgres connection.
 * For complex queries that go beyond the Supabase client API.
 */
export async function query(sql, params = []) {
  const { data, error } = await supabase.rpc('exec_sql', {
    query: sql,
    params
  });
  if (error) throw new Error(`DB query failed: ${error.message}`);
  return data;
}
