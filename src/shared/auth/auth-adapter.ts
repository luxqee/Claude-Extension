export interface AuthAdapter {
  signIn(): Promise<{ email: string; idToken: string } | null>
  signOut(): Promise<void>
  getCurrentSession(): Promise<{ email: string } | null>
  getValidIdToken(): Promise<string | null>
}
