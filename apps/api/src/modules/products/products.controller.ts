import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ProductsService } from './products.service';
import { DuplicateAdvisorService } from '../ai/duplicate-advisor.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  TenantRlsInterceptor,
  AuditInterceptor,
  CurrentTenant,
  CurrentUser,
} from '../../common';

@Controller('products')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class ProductsController {
  constructor(private readonly products: ProductsService, private readonly advisor: DuplicateAdvisorService) {}

  /** GET /api/products?search=&archived=true&limit= : the product master (also feeds the quote item picker). */
  @Get()
  @RequirePermission('product:view')
  list(
    @CurrentTenant() tenant: { id: string },
    @Query('search') search?: string,
    @Query('archived') archived?: string,
    @Query('limit') limit?: string
  ) {
    const n = limit ? parseInt(limit, 10) : undefined;
    return this.products.list(tenant.id, { search, includeArchived: archived === 'true', limit: Number.isFinite(n) ? n : undefined });
  }

  /** GET /api/products/similar?name=&code= : products that look like the one being typed (a warning aid, never a block). */
  @Get('similar')
  @RequirePermission('product:view')
  async similar(@CurrentTenant() tenant: { id: string }, @Query('name') name?: string, @Query('code') code?: string) {
    return { ...(await this.products.findSimilar(tenant.id, { name, code })), ai: this.advisor.available() };
  }

  /**
   * POST /api/products/similar/review { name, code?, unit?, hsnCode?, unitPrice? }
   * An AI second opinion on the products the plain checks found (same / different / unsure, with a reason). A different
   * size, grade or unit is a different product. It only advises; nothing is merged or blocked because of it.
   */
  @Post('similar/review')
  @RequirePermission('product:view')
  async reviewSimilar(
    @CurrentTenant() tenant: { id: string },
    @Body() body: { name?: string; code?: string; unit?: string; hsnCode?: string; unitPrice?: string | number }
  ) {
    const { matches } = await this.products.findSimilar(tenant.id, { name: body?.name, code: body?.code });
    const verdicts = await this.advisor.review(
      tenant.id,
      'product',
      { name: body?.name ?? null, unit: body?.unit ?? null, hsnCode: body?.hsnCode ?? null, rate: body?.unitPrice ?? null },
      matches.map((m) => ({ id: m.id, fields: { name: m.name, unit: m.unit, hsnCode: m.hsnCode, rate: m.unitPrice } }))
    );
    return { matches: matches.map((m) => ({ ...m, ...(verdicts.find((v) => v.id === m.id) ?? {}) })) };
  }

  /** POST /api/products : add one product. 409 when the name or code is already used. */
  @Post()
  @RequirePermission('product:manage')
  create(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() body: Record<string, unknown>
  ) {
    return this.products.create(tenant.id, user?.id ?? null, body ?? {});
  }

  /**
   * POST /api/products/import { rows, dryRun?, onDuplicate? }
   * dryRun defaults to TRUE: nothing is written until the caller sends dryRun: false after reviewing the preview.
   */
  @Post('import')
  @RequirePermission('product:manage')
  importProducts(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() body: { rows?: unknown; dryRun?: boolean; onDuplicate?: string }
  ) {
    return this.products.importProducts(tenant.id, user?.id ?? null, body?.rows, {
      dryRun: body?.dryRun !== false,
      onDuplicate: body?.onDuplicate === 'update' ? 'update' : 'skip',
    });
  }

  /** PATCH /api/products/:id : change fields (send only what changes), or { isActive } to archive / restore. */
  @Patch(':id')
  @RequirePermission('product:manage')
  update(@CurrentTenant() tenant: { id: string }, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const patch = body ?? {};
    const onlyActive = Object.keys(patch).length === 1 && typeof patch.isActive === 'boolean';
    return onlyActive ? this.products.setActive(tenant.id, id, patch.isActive as boolean) : this.products.update(tenant.id, id, patch);
  }
}
