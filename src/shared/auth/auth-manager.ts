import type { AuthAdapter } from './auth-adapter'
import { GoogleAuthAdapter } from './google-auth-adapter'
import { ClerkAuthAdapter } from './clerk-auth-adapter'
import { readSession } from './session-store'
import type { ProviderId } from './providers'

/**
 * One entry point over every sign-in method. `signIn` takes the chosen
 * provider; every other call reads the stored session's `provider` tag
 * and delegates to that adapter (defaulting to Google for sessions
 * written before multi-provider support).
 */
export class AuthManager {
  private readonly adapters: Record<ProviderId, AuthAdapter> = {
    google: new GoogleAuthAdapter(),
    clerk: new ClerkAuthAdapter(),
  }

  private async currentAdapter(): Promise<AuthAdapter> {
    const session = await readSession()
    return this.adapters[session?.provider ?? 'google']
  }

  async signIn(provider: ProviderId): Promise<{ email: string; idToken: string } | null> {
    return this.adapters[provider].signIn()
  }

  async signOut(): Promise<void> {
    await (await this.currentAdapter()).signOut()
  }

  async getCurrentSession(): Promise<{ email: string } | null> {
    return (await this.currentAdapter()).getCurrentSession()
  }

  async getValidToken(): Promise<string | null> {
    return (await this.currentAdapter()).getValidToken()
  }
}
