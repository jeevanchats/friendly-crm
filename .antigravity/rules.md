# Friendly CRM — AI Agent Architectural Guardrails

## 1. Architectural Overview & Boundaries
Friendly CRM is structured as a high-performance, modular monorepo managed with Turborepo:
- **`apps/api`**: NestJS Modular Monolith backend.
- **`apps/web`**: Next.js (App Router) mobile-first Progressive Web Application (PWA).
- **`packages/db`**: Drizzle ORM schema definitions, migrations, and PostgreSQL Row-Level Security (RLS).
- **`packages/shared`**: Canonical Zod DTOs, RBAC permission matrices, constants, and localization type contracts.

---

## 2. Multi-Tenancy & Data Isolation Guardrails
1. **Tenant Isolation is Non-Negotiable**:
   - Every tenant data table must feature a `tenant_id` UUID column.
   - All tenant-scoped HTTP requests must pass through `TenantGuard` to validate and bind the tenant context (`req.tenant`).
   - Every database transaction must initialize the PostgreSQL session setting `SET LOCAL app.current_tenant_id = '<tenant_id>'` to enforce RLS at the database engine level.
2. **Cross-Tenant Leakage Prevention**:
   - Never write a raw SQL query or Drizzle filter without a `where(eq(table.tenantId, tenantId))` clause, even when RLS is active (defense in depth).
3. **Industry Templates (single source of truth)**:
   - Industries are data-driven. Order stages, lead stages and custom fields come only from `packages/shared/src/industry-templates.json` (read via `getIndustryTemplate`). Never hard-code industry lists, enums or stage names in code; use `isIndustryKey` / `listIndustries()`.
   - Adding an industry = adding a template entry (with English and Tamil labels), not new code paths.
   - Custom-field validation goes through `validateCustomData` / `getCustomDataErrors` in `@friendly-crm/shared`.

---

## 3. NestJS Modular Monolith Principles (`apps/api`)
1. **Module Autonomy**:
   - Cross-module communication must happen strictly via exported Services, never through direct database schema access of another module.
   - Keep modules self-contained: `auth`, `tenant`, `crm`, `sales`, `workflow`.
2. **Guards, Decorators & Interceptors**:
   - Use `@UseGuards(TenantGuard, RbacGuard)` on controllers or specific route handlers.
   - Use declarative decorators: `@Roles(Role.Admin, Role.SalesManager)`, `@CurrentTenant()`, `@CurrentUser()`.
   - Apply `AuditInterceptor` to all mutation endpoints (POST/PUT/PATCH/DELETE) to log actor ID, tenant ID, previous state, and diffs to `audit_logs`.
3. **PDF Generation**:
   - Quotation and invoice PDF generation is encapsulated in `apps/api/src/modules/sales/pdf/pdf-engine.service.ts`.

---

## 4. Frontend & Mobile-First UX Standards (`apps/web`)
1. **Mobile Ergonomics**:
   - Friendly CRM is designed for field sales reps on smartphones.
   - Primary navigation uses `MobileBottomNav` for quick one-thumb reach.
   - Fast data capture (e.g., adding leads, taking call notes) must use bottom slide-over drawers (`QuickAddLeadDrawer`).
2. **Bilingual Localization (English & Tamil)**:
   - All user-facing strings must use internationalization keys (`messages/en.json`, `messages/ta.json`).
   - Tamil translations must use standard, natural business vocabulary (e.g., வாடிக்கையாளர் for Customer, மேற்கோள் for Quotation, ஆர்டர் for Order).
3. **Dynamic Custom Field Rendering**:
   - Use `CustomFieldRenderer` to parse industry JSON schemas and render dynamic forms (text, numeric, date, dropdown, boolean) with shared Zod validation.

---

## 5. Shared Contracts & Type Safety (`packages/shared`)
1. **Single Source of Truth**:
   - Never duplicate validation rules between frontend and backend.
   - Define all DTOs and mutations in `packages/shared/src/dtos` using `zod`.
   - In NestJS, validate inputs using a `ZodValidationPipe`. In Next.js, use `zodResolver` with React Hook Form.
2. **RBAC Permission Matrix**:
   - Roles (`Owner`, `Admin`, `SalesManager`, `SalesRep`, `Viewer`) are mapped to granular permissions in `packages/shared/src/rbac`.
   - Check permissions at both route handlers and UI components.
