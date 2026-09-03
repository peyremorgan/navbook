/**
 * What the plugins put on the Nuxt app.
 *
 * Declared rather than inferred, and that is not a style choice: the plugins
 * depend on each other's injections — Apollo needs the configuration and the
 * token, `useAuth` needs the user manager — so letting Nuxt infer the shape of
 * `NuxtApp` from what they return makes each one's type depend on its own.
 * Writing the contract down breaks the cycle, and it is the contract anyway.
 */

import type { ApolloClient, NormalizedCacheObject } from "@apollo/client/core";
import type { User, UserManager } from "oidc-client-ts";
import type { Ref } from "vue";
import type { WebConfig } from "../utils/config";

declare module "#app" {
  interface NuxtApp {
    $navConfig: WebConfig;
    $oidc: UserManager;
    $oidcUser: Ref<User | null>;
    $apollo: ApolloClient<NormalizedCacheObject>;
  }
}

declare module "vue" {
  interface ComponentCustomProperties {
    $navConfig: WebConfig;
    $oidc: UserManager;
    $oidcUser: Ref<User | null>;
    $apollo: ApolloClient<NormalizedCacheObject>;
  }
}
