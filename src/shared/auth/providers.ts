// Which sign-in methods the extension offers. Adding a provider is a
// matter of registering it here plus an AuthAdapter implementation.

export type ProviderId = 'google' | 'clerk'

export interface ProviderConfig {
  id: ProviderId
  /** Button label on the sign-in screen. */
  label: string
}

// --- Google (always on) ---
export const GOOGLE_CLIENT_ID =
  '14020508582-rsh9tk73lhm3c3ekki32mvfc9a2m3di6.apps.googleusercontent.com'

// --- Clerk (SSO / Microsoft / email / etc, via one OAuth application) ---
// Fill both in to enable the Clerk button. CLERK_DOMAIN is the instance's
// Frontend API host (…​.clerk.accounts.dev in dev, your domain in prod).
// CLERK_OAUTH_CLIENT_ID comes from Clerk Dashboard → Configure → OAuth
// Applications → your app. The publishable key is public and safe here,
// but is not needed for the OAuth flow, so it isn't stored.
export const CLERK_DOMAIN = 'innocent-lamb-6401.clerk.accounts.dev'
export const CLERK_OAUTH_CLIENT_ID = 'xiyI62cGM2x1Od4z'

export function clerkEnabled(): boolean {
  return CLERK_DOMAIN.length > 0 && CLERK_OAUTH_CLIENT_ID.length > 0
}

export function enabledProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [{ id: 'google', label: 'Continue with Google' }]
  if (clerkEnabled()) {
    // One button covers every method enabled on the Clerk instance --
    // email, GitHub / Microsoft / other social, and enterprise SSO. Turn
    // them on in the Clerk Dashboard (Social Connections, SSO Connections);
    // no code change here.
    providers.push({ id: 'clerk', label: 'Continue with SSO, GitHub or email' })
  }
  return providers
}
