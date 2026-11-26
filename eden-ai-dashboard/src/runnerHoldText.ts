export function runnerHoldText(names: string[], what: 'Apply' | 'Undo' | 'Saving to GitHub' | 'Sync') {
  if (!names.length) return '';
  const quoted = names.map((name) => `"${name}"`);
  const who = quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  return `${what} is waiting: ${who} ${names.length === 1 ? 'is' : 'are'} working in this folder. Stop ${names.length === 1 ? 'it' : 'them'} in Runners, or wait until ${names.length === 1 ? 'it has' : 'they have'} finished.`;
}
