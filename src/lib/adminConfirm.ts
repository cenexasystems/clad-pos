// Admin sign-off for sensitive actions (refunds, editing a bill as staff, deleting a bill as staff).
// Checks the current admin password, including one changed in Settings.
export { verifyAdminPassword } from './credentials'
