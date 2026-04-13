import supabase from '../config/db.js';

/**
 * Resolve the active style_config for a city.
 * Resolution order:
 *   1. City-level override (scope = 'city', city_id matches, active = true)
 *   2. Global fallback (scope = 'global', active = true)
 */
export async function getStyleConfig(cityId) {
  // Try city-level first
  const { data: cityConfig } = await supabase
    .from('style_config')
    .select('*')
    .eq('scope', 'city')
    .eq('city_id', cityId)
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (cityConfig) return cityConfig;

  // Fall back to global
  const { data: globalConfig, error } = await supabase
    .from('style_config')
    .select('*')
    .eq('scope', 'global')
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (error) throw new Error(`No active style_config found: ${error.message}`);
  return globalConfig;
}

/**
 * Build the style injection block for writing agent system prompts.
 */
export function buildStylePromptBlock(config) {
  const bannedList = Array.isArray(config.banned_phrases)
    ? config.banned_phrases.join(', ')
    : JSON.parse(config.banned_phrases).join(', ');

  return `
STYLE CONFIGURATION (follow exactly):
- Voice: ${config.voice}
- Formality: ${config.formality}
- Sentence length: ${config.sentence_length}
- Point of view: ${config.pov}
- Never use these phrases or words: ${bannedList}
- Additional instructions: ${config.custom_prompt_suffix || 'None'}
`.trim();
}
