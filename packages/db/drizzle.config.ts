import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations create tables, policies and roles, so they run as the admin role, not the restricted runtime one.
    url: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/friendly_crm',
  },
  verbose: true,
  strict: true,
});
