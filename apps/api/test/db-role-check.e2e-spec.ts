import { assertRestrictedDbRole } from '../src/common/utils/db-role-check';

describe('assertRestrictedDbRole', () => {
  const as = (row: any) => async () => (row ? [row] : []);

  it('accepts a restricted role', async () => {
    await expect(assertRestrictedDbRole(as({ name: 'friendly_app_runtime', rolsuper: false, rolbypassrls: false }))).resolves.toBeUndefined();
  });

  it('refuses a superuser', async () => {
    await expect(assertRestrictedDbRole(as({ name: 'postgres', rolsuper: true, rolbypassrls: true }))).rejects.toThrow(/bypasses row-level security/);
  });

  it('refuses a role with BYPASSRLS', async () => {
    await expect(assertRestrictedDbRole(as({ name: 'x', rolsuper: false, rolbypassrls: true }))).rejects.toThrow(/"x"/);
  });

  it('refuses when the role cannot be read', async () => {
    await expect(assertRestrictedDbRole(as(null))).rejects.toThrow(/Could not read/);
  });
});
