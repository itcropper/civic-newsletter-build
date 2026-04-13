/**
 * Nightly Cleanup Job
 *
 * Purges transcript_text from meetings older than ops_config.transcript_purge_days.
 * source_url is NEVER deleted.
 */

import supabase from '../config/db.js';
import { getOpsConfig } from '../utils/ops-config.js';

export async function runCleanup() {
  const purgeDays = parseInt(await getOpsConfig('transcript_purge_days'));
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - purgeDays);

  const { data, error } = await supabase
    .from('meetings')
    .update({ transcript_text: null })
    .not('transcript_text', 'is', null)
    .lt('created_at', cutoffDate.toISOString())
    .select('id');

  if (error) {
    console.error('[Cleanup] Failed:', error.message);
    return { purged: 0, error: error.message };
  }

  const purged = data?.length || 0;
  console.log(`[Cleanup] Purged transcript_text from ${purged} meetings older than ${purgeDays} days`);
  return { purged };
}

// CLI entry point
if (process.argv[1]?.endsWith('cleanup.js')) {
  runCleanup().catch(console.error);
}
