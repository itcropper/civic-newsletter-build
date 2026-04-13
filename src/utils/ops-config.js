import supabase from '../config/db.js';

/**
 * Read a single ops_config value by key.
 */
export async function getOpsConfig(key) {
  const { data, error } = await supabase
    .from('ops_config')
    .select('value')
    .eq('key', key)
    .single();

  if (error) throw new Error(`ops_config key '${key}' not found: ${error.message}`);
  return data.value;
}

/**
 * Read multiple ops_config values at once.
 * Returns an object: { key1: value1, key2: value2, ... }
 */
export async function getOpsConfigBatch(keys) {
  const { data, error } = await supabase
    .from('ops_config')
    .select('key, value')
    .in('key', keys);

  if (error) throw new Error(`ops_config batch read failed: ${error.message}`);
  return Object.fromEntries(data.map(r => [r.key, r.value]));
}
