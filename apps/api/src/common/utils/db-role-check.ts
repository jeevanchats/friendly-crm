/**
 * Row-level security does nothing for a superuser or a role with BYPASSRLS, so in production the API must refuse to
 * start on one. `run` is a query function (the pg client) so this can be tested without a database.
 */
export async function assertRestrictedDbRole(run: (q: string) => Promise<any[]>): Promise<void> {
  const rows = await run(
    `SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
  );
  const role = rows?.[0];
  if (!role) throw new Error('Could not read the database role the API is connected as.');
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `The API is connected to Postgres as "${role.name}", which bypasses row-level security. ` +
        `Point DATABASE_URL at the restricted friendly_app_runtime role (see docs/row-level-security.md).`
    );
  }
}
