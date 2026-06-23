import { spawn } from 'node:child_process';

export type ClaudeRunner = (prompt: string, opts?: { model?: string }) => Promise<string>;

export function parseClaudeEnvelope(stdout: string): string {
  const env = JSON.parse(stdout);
  if (env.is_error) throw new Error(`claude reported error: ${env.subtype ?? env.result ?? 'unknown'}`);
  return typeof env.result === 'string' ? env.result : '';
}

export function spawnClaudeRunner(): ClaudeRunner {
  return (prompt, opts = {}) =>
    new Promise<string>((resolve, reject) => {
      const args = ['-p', '--output-format', 'json', '--max-turns', '1'];
      if (opts.model) args.push('--model', opts.model);
      const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('error', reject);
      child.stdin.on('error', reject); // EPIPE if claude exits before reading stdin — route to reject, don't crash
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
        try {
          resolve(parseClaudeEnvelope(out));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
}
