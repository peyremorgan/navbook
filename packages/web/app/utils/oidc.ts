/**
 * Asking a provider for a token the API will take.
 *
 * Providers disagree on how the API is named. Auth0 reads an `audience` query
 * parameter on the authorization request. Providers that implement resource
 * indicators (RFC 8707) read `resource` — and Better Auth's OAuth provider
 * reads it on the *token* request, on every grant, minting a JWT when it is
 * there and an opaque token when it is not. `nav-server` can verify only the
 * JWT, so a request that forgets it signs in fine and is then refused on every
 * operation, with nothing on screen to say why.
 *
 * So the audience goes out under both names, everywhere a token is asked for.
 * A provider that knows neither ignores both.
 */

import {
  type SigninSilentArgs,
  type User,
  UserManager,
  type UserManagerSettings,
} from "oidc-client-ts";

/**
 * A `UserManager` that names the API on every refresh.
 *
 * oidc-client-ts puts `settings.resource` on the authorization URL and
 * `settings.extraTokenParams` on the code exchange, but a refresh takes both
 * only from the arguments `signinSilent` is called with — and its own
 * automatic renewal calls it with none. Defaulting them here is the one place
 * both that timer and `useAuth` pass through.
 */
export class ApiUserManager extends UserManager {
  constructor(
    settings: UserManagerSettings,
    private readonly audience: string,
  ) {
    super(settings);
  }

  override signinSilent(args: SigninSilentArgs = {}): Promise<User | null> {
    return super.signinSilent({ resource: this.audience, ...args });
  }
}

export interface OidcOptions {
  issuer: string;
  clientId: string;
  audience: string;
  /** The app's own origin, which both redirects come back to. */
  origin: string;
}

/** The settings that differ from oidc-client-ts's defaults, and why. */
export function oidcSettings(options: OidcOptions): UserManagerSettings {
  const { issuer, clientId, audience, origin } = options;
  return {
    authority: issuer,
    client_id: clientId,
    redirect_uri: `${origin}/auth/callback`,
    post_logout_redirect_uri: origin,
    response_type: "code",
    scope: "openid profile email offline_access",
    // `audience` for providers in Auth0's mould, `resource` for RFC 8707 ones:
    // the latter on the authorization URL and again on the code exchange,
    // which is where Better Auth reads it. Refreshes are `ApiUserManager`'s.
    extraQueryParams: { audience },
    resource: audience,
    extraTokenParams: { resource: audience },
    automaticSilentRenew: true,
    // A hidden iframe renew needs third-party cookies. Refresh tokens do not.
    silentRequestTimeoutInSeconds: 10,
    // The callback route reads the response itself, so leaving the code and
    // state in the address bar afterwards would only invite a reload to
    // replay a code the provider has already spent.
    monitorSession: false,
  };
}
