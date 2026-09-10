/**
 * Base URL of the Claude Tools backend (the Vercel serverless API that
 * backs organisation sign-in, shared prompts, membership and usage).
 *
 * Lives in its own module so both the org client modules and the auth
 * adapter can import it without the auth layer having to depend on an
 * org module.
 */
export const API_BASE_URL = 'https://claude-extension-git-main-luxqees-projects.vercel.app'
