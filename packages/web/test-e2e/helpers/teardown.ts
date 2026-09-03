/**
 * Stop the shared stack once the run is over.
 *
 * It is started lazily by the first test that asks for it, so there is nothing
 * to set up here — only the server, the issuer and the temporary repository to
 * take down, which a killed test run would otherwise leave behind.
 */

import { stopStack } from "./fixtures.ts";

export default async function teardown(): Promise<void> {
  await stopStack();
}
