import { OrdersService } from '../src/modules/orders/orders.service';
import { INDUSTRY_TEMPLATES, getIndustryTemplate, buildCustomDataZodSchema } from '@friendly-crm/shared';

async function runOrdersHardeningTests() {
  console.log('--- STARTING ORDERS SERVICE HARDENING & RBAC TESTS ---');

  const ordersService = new OrdersService();
  const tenantId = 't-demo-printing';
  const orderId = 'ord-demo-1';

  // 1. Test OWNER role (must see all financial figures)
  console.log('\n[TEST 1] OWNER Role getOrderDetail:');
  const ownerDetail: any = await ordersService.getOrderDetail(tenantId, 'OWNER', orderId);

  if (ownerDetail.totalAmount === null || ownerDetail.advanceReceived === null || ownerDetail.balanceDue === null) {
    throw new Error('FAILED: OWNER should see totalAmount, advanceReceived, and balanceDue');
  }
  if (!ownerDetail.items || ownerDetail.items.length === 0 || ownerDetail.items[0].unitPrice === null || ownerDetail.items[0].lineTotal === null) {
    throw new Error('FAILED: OWNER should see items unitPrice and lineTotal');
  }
  if (!ownerDetail.payments || ownerDetail.payments.length === 0) {
    throw new Error('FAILED: OWNER should see payment receipts');
  }
  console.log('✅ PASS: OWNER receives full financial figures:');
  console.log(`   totalAmount: ${ownerDetail.totalAmount}, advanceReceived: ${ownerDetail.advanceReceived}, balanceDue: ${ownerDetail.balanceDue}`);
  console.log(`   item[0].unitPrice: ${ownerDetail.items[0].unitPrice}, item[0].lineTotal: ${ownerDetail.items[0].lineTotal}`);
  console.log(`   payments count: ${ownerDetail.payments.length}`);

  // 2. Test PRODUCTION role (financial figures MUST be masked to null)
  console.log('\n[TEST 2] PRODUCTION Role getOrderDetail:');
  const prodDetail: any = await ordersService.getOrderDetail(tenantId, 'PRODUCTION', orderId);

  if (prodDetail.totalAmount !== null) {
    throw new Error(`FAILED: PRODUCTION totalAmount should be null, got ${prodDetail.totalAmount}`);
  }
  if (prodDetail.advanceReceived !== null) {
    throw new Error(`FAILED: PRODUCTION advanceReceived should be null, got ${prodDetail.advanceReceived}`);
  }
  if (prodDetail.balanceDue !== null) {
    throw new Error(`FAILED: PRODUCTION balanceDue should be null, got ${prodDetail.balanceDue}`);
  }
  if (prodDetail.items[0].unitPrice !== null) {
    throw new Error(`FAILED: PRODUCTION item unitPrice should be null, got ${prodDetail.items[0].unitPrice}`);
  }
  if (prodDetail.items[0].lineTotal !== null) {
    throw new Error(`FAILED: PRODUCTION item lineTotal should be null, got ${prodDetail.items[0].lineTotal}`);
  }
  if (prodDetail.payments.length !== 0) {
    throw new Error(`FAILED: PRODUCTION payments should be empty array, got ${prodDetail.payments.length}`);
  }
  console.log('✅ PASS: PRODUCTION financial figures are completely masked to null:');
  console.log(`   totalAmount: ${prodDetail.totalAmount}`);
  console.log(`   advanceReceived: ${prodDetail.advanceReceived}`);
  console.log(`   balanceDue: ${prodDetail.balanceDue}`);
  console.log(`   item[0].unitPrice: ${prodDetail.items[0].unitPrice}`);
  console.log(`   item[0].lineTotal: ${prodDetail.items[0].lineTotal}`);
  console.log(`   payments: [${prodDetail.payments}]`);

  // 3. Test job card specification keys alignment
  console.log('\n[TEST 3] Job Card Spec Keys Alignment in industry-templates.json:');
  const printingTemplate = getIndustryTemplate('printing');
  const printingOrderFields = printingTemplate.customFields
    .filter((f) => f.entity.includes('ORDER'))
    .map((f) => f.key);

  const furnitureTemplate = getIndustryTemplate('furniture');
  const furnitureOrderFields = furnitureTemplate.customFields
    .filter((f) => f.entity.includes('ORDER'))
    .map((f) => f.key);

  const requiredKeys = ['plate_size', 'artwork_approved', 'paper_board_gsm', 'dimensions_lwh'];

  for (const key of requiredKeys) {
    const inPrinting = printingOrderFields.includes(key);
    const inFurniture = furnitureOrderFields.includes(key);
    if (!inPrinting && !inFurniture) {
      throw new Error(`FAILED: Required spec key "${key}" not found in industry templates`);
    }
    console.log(`✅ Spec Key "${key}" found in: ${[inPrinting ? 'printing' : '', inFurniture ? 'furniture' : ''].filter(Boolean).join(', ')}`);
  }

  // 4. Test Zod Validation with aligned spec keys
  console.log('\n[TEST 4] Dynamic Zod validation with aligned job card specs:');
  const printingOrderSchema = buildCustomDataZodSchema('printing', 'ORDER');
  const validPrintingSpecs = {
    job_type: 'PACKAGING_BOX',
    paper_board_gsm: '350 GSM Cyber Premium Board',
    plate_size: '28x40 inch CTP',
    artwork_approved: true,
    dimensions_lwh: '12x9x4 inches',
    print_colors: 'CMYK_4C',
    finishing_ops: ['MATT_LAM', 'DIE_PUNCH'],
  };

  const parseResult = printingOrderSchema.safeParse(validPrintingSpecs);
  if (!parseResult.success) {
    throw new Error(`FAILED: Validation failed for valid specs: ${JSON.stringify(parseResult.error)}`);
  }
  console.log('✅ PASS: Zod successfully validates aligned job card specs:', parseResult.data);

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runOrdersHardeningTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
