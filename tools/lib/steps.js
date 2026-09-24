// Runs named steps, printing one line each, and stops at the first failure.

const colour = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
export const green = text => colour(32, text);
export const red = text => colour(31, text);
export const dim = text => colour(2, text);

export function section(title) {
  console.log(`\n${title}`);
}

// fn may return a short string describing what it did ("created", "exists", ...)
export async function step(label, fn) {
  const started = Date.now();
  try {
    const outcome = await fn();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ${green('✓')} ${label}${outcome ? ` ${dim(`(${outcome})`)}` : ''} ${dim(`${seconds}s`)}`);
    return outcome;
  } catch (error) {
    console.log(`  ${red('✗')} ${label}`);
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

export async function main(fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`\n${red('Failed:')} ${error.message}`);
    process.exit(1);
  }
}
