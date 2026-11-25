export const GROK = { provider: 'grok', label: 'Grok (xAI)', role: 'research', mode: 'manual' } as const;

const researchTags = new Set(['research', 'market', 'pricing', 'launch-copy']);

export function manualProviderFor(tags: readonly string[] = []) {
  return tags.some((tag) => researchTags.has(tag.trim().toLowerCase())) ? GROK.provider : undefined;
}
