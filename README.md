# Friendly CRM 🚀

A multi-tenant, mobile-first CRM and Sales Operations platform designed for field sales reps and SMBs (Printing, Furniture, Textiles, Trading and more via templates).

---

## 📁 Repository Layout

```text
friendly-crm/
├── .antigravity/
│   └── rules.md                 # Persistent architectural guardrails for the AI agent
├── apps/
│   ├── api/                     # NestJS Modular Monolith
│   │   └── src/
│   │       ├── common/          # TenantGuard, RBAC decorators, AuditInterceptor
│   │       ├── modules/
│   │       │   ├── auth/        # OTP & Session management
│   │       │   ├── tenant/      # Onboarding & Industry Template seeding
│   │       │   ├── crm/         # Customers, Leads, Tasks/Follow-ups, Activities
│   │       │   ├── sales/       # Quotations, PDF Engine, Orders
│   │       │   └── workflow/    # Dynamic pipelines & Custom field validators
│   └── web/                     # Next.js PWA (App Router)
│       ├── messages/            # en.json, ta.json (Tamil localization)
│       └── src/
│           ├── components/
│           │   ├── layout/      # MobileBottomNav, BusinessSwitcher
│           │   ├── crm/         # QuickAddLeadDrawer, CustomerTimeline, FollowUpList
│           │   ├── sales/       # QuotationEditor, OrderStageTracker
│           │   └── dynamic/     # CustomFieldRenderer (Reads industry JSON schema)
├── packages/
│   ├── db/                      # Drizzle ORM schemas, RLS policies & migrations
│   └── shared/                  # Shared Zod DTOs, RBAC permission matrix, constants
└── turbo.json
```

---

## 🏛️ Architecture Highlights

### 1. Multi-Tenant Data Isolation
- **Tenant Context (`TenantGuard`)**: Validates `x-tenant-id` HTTP header and binds tenant session context.
- **PostgreSQL Row-Level Security (RLS)**: Policies in `packages/db/src/rls/policies.sql` enforce database-level tenant isolation using `SET LOCAL app.current_tenant_id = '...'`.
- **Industry Templates**: Pipeline stages and custom fields are data-driven from `packages/shared/src/industry-templates.json` (currently Printing, Furniture, Textiles, Trading) and served per tenant by the `workflow` module.

### 2. NestJS Modular Monolith (`apps/api`)
- **Modules**:
  - `auth`: Passwordless SMS OTP verification and session issuance.
  - `tenant`: Organization setup, multi-branch management, and industry template provisioning.
  - `crm`: Leads, customers, follow-up scheduling, and chronological customer activity timelines.
  - `sales`: Quotation calculations, PDF engine via `pdfkit`, and order management.
  - `workflow`: Dynamic pipeline lifecycle and custom field schema validators.
- **Cross-Cutting Concerns**:
  - `TenantGuard`: Enforces tenant perimeter.
  - `RbacGuard` & `@Roles(...)`: Role-based access control (Owner, Admin, Sales Manager, Sales Rep, Viewer).
  - `AuditInterceptor`: Tracks mutating operations to the audit trail.

### 3. Next.js Mobile-First PWA (`apps/web`)
- **Ergonomics**: Designed for field sales with one-thumb reach via `MobileBottomNav` and slide-up `QuickAddLeadDrawer`.
- **Localization**: Bilingual support for English and Tamil (`en.json` & `ta.json`).
- **Dynamic Field Renderer**: Parses industry JSON schemas to dynamically render form inputs.
- **Sales Tools**: Real-time line item calculator in `QuotationEditor` and visual stepper in `OrderStageTracker`.

### 4. Shared Monorepo Packages
- **`@friendly-crm/shared`**: Zod DTO schemas shared across frontend forms and backend validation pipes, plus RBAC permissions and industry metadata.
- **`@friendly-crm/db`**: Drizzle ORM schema definitions and database client.

---

## 🚀 Getting Started

### Prerequisites
- Node.js >= 18
- npm or pnpm
- PostgreSQL (for database storage and RLS)

### Commands
```bash
# Install dependencies across all workspaces
npm install

# Run database schema migrations
npm run db:generate
npm run db:migrate

# Start development servers (Web & API simultaneously via Turborepo)
npm run dev

# Typecheck all packages
npm run check-types
```
