/**
 * Preloaded into a server under test (`--import`): the moment it says it is
 * listening, it is sent SIGTERM, from inside.
 *
 * Nothing can come between the readiness line and the signal, which is the
 * worst an orchestrator on a loaded machine can do — it reads the line and
 * stops the server before the server has taken another step. A server that
 * announced itself before handling signals would be killed where it stood.
 */

const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  const written = write(chunk, ...rest);
  if (String(chunk).startsWith("nav-server listening")) process.kill(process.pid, "SIGTERM");
  return written;
};
