// Admin sign-off for sensitive actions (refunds). Uses the same admin password as the admin login.
const adminPassword = (): string =>
  String(import.meta.env.VITE_ADMIN_PASSWORD || import.meta.env.VITE_PORTAL_PASSWORD || 'admin123').trim()

export const verifyAdminPassword = (input: string): boolean => input.trim() !== '' && input.trim() === adminPassword()
