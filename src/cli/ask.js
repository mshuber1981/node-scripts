import { createInterface } from 'node:readline';

/**
 * Ask one question on stdin, then close the readline interface.
 * Prefer this when file I/O happens between prompts (keeps stdin usable).
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {(prompt: string) => Promise<string>} [options.question]
 * @returns {Promise<string>}
 */
export async function ask(prompt, options = {}) {
  if (options.question) {
    return options.question(prompt);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  } finally {
    rl.close();
  }
}
