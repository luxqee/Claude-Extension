// Sign-in is handled entirely through Clerk (one OAuth application), which
// fans out to Google / GitHub / Microsoft / email / enterprise SSO --
// whichever connections are turned on in the Clerk Dashboard. No code
// change here to add or drop a method.

export type ProviderId = 'clerk'

export interface ProviderConfig {
  id: ProviderId
  /** Button label on the sign-in screen. */
  label: string
}

// CLERK_DOMAIN is the instance's Frontend API host (…​.clerk.accounts.dev
// in dev, your domain in prod). CLERK_OAUTH_CLIENT_ID comes from Clerk
// Dashboard → Configure → OAuth Applications → your app.
export const CLERK_DOMAIN = 'innocent-lamb-6401.clerk.accounts.dev'
export const CLERK_OAUTH_CLIENT_ID = 'xiyI62cGM2x1Od4z'

export function enabledProviders(): ProviderConfig[] {
  return [{ id: 'clerk', label: 'Sign in' }]
}
