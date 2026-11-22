export interface UpdateCheck {
  ok: boolean;
  output: string;
  releaseGate?: true;
}

type ReleaseScript = 'lint' | 'test' | 'build';

export async function runReleaseGate(
  run: (script: ReleaseScript) => Promise<{ status: number | null; out: string }>,
): Promise<UpdateCheck> {
  const steps = [
    ['lint', 'Type check (npm run lint)'],
    ['test', 'Tests (npm test)'],
    ['build', 'Production build (npm run build)'],
  ] as const;
  const failures: string[] = [];
  for (const [script, label] of steps) {
    const { status, out } = await run(script);
    if (status !== 0) {
      const details = out.trim().slice(-1600);
      failures.push(`${label} failed (${status === null ? 'command did not complete' : `exit code ${status}`}).${details ? `\n${details}` : ''}`);
    }
  }
  return {
    releaseGate: true,
    ok: failures.length === 0,
    output: failures.length ? failures.join('\n\n') : 'Type check, tests and production build passed.',
  };
}

export function updateCheckIssue(codebaseId: string, check?: UpdateCheck): string | undefined {
  if (check?.ok === false) return 'The update checks failed.';
  if (codebaseId === 'hub' && (check?.releaseGate !== true || check.ok !== true)) {
    return 'This update has no dashboard release gate result. Use Try again to run the current checks.';
  }
}

export function mayOverrideUpdateCheck(local: boolean, confirmation: unknown): boolean {
  return local && confirmation === true;
}
