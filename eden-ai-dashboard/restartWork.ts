// What a hub restart would cut off, in the words the owner sees before choosing "Restart anyway".
// Runners (autopilots started from the Runners panel) are stopped by a restart too, so they are listed.
export function interruptedWork(updates: { working: string[]; queued: string[] }, cardNames: string[], runnerNames: string[]) {
  return {
    codeUpdates: updates.working.length + updates.queued.length,
    cards: cardNames.length,
    runners: runnerNames.length,
    interrupted: [
      ...updates.working.map((n) => `Code update being worked on: ${n}`),
      ...updates.queued.map((n) => `Code update waiting in the queue: ${n}`),
      ...cardNames.map((n) => `Card being written: ${n}`),
      ...runnerNames.map((n) => `Runner still going: ${n}`),
    ],
  };
}
