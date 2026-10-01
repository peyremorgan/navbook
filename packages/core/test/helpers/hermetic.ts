/**
 * Loaded before every test file (`node --import`, see `package.json`).
 *
 * The suite runs real git, and real git reads the machine's config: the system
 * file, and the user's `~/.gitconfig`. Either can change what a test sees. Git
 * for Windows ships a system config with `core.autocrlf=true`, and offers to
 * write the same into the user's, and with it every file a test repository
 * checks out comes back with CRLF — a merge, a checkout, a squash — so
 * assertions about the bytes on disk would describe the machine rather than
 * the code. So neither is read: each test repository says what it needs
 * itself, identity included.
 *
 * The other suites need no preload: they run git through `TempRepo`, whose
 * environment (`deterministicEnv` in `@navbook/cli/test-helpers`) pins both
 * files for every command it runs.
 */

process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
