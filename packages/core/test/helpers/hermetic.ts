/**
 * Loaded before every test file (`node --import`, see `package.json`).
 *
 * The suite runs real git, and real git reads the machine's system config.
 * Git for Windows ships one that sets `core.autocrlf=true`, and with it every
 * file a test repository checks out comes back with CRLF line endings — a
 * merge, a checkout, a squash — so assertions about the bytes on disk would
 * describe the machine rather than the code. Nothing here relies on system
 * config, so none is read: each test repository says what it needs itself.
 */

process.env.GIT_CONFIG_NOSYSTEM = "1";
