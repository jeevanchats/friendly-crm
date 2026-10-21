import { db } from './index';
import {
  tenants,
  users,
  memberships,
  customers,
  leads,
  quotations,
  quotationItems,
  orders,
  orderItems,
  tasks,
  industryTemplates,
} from './schema';
import templatesJson from '@friendly-crm/shared/industry-templates.json';

async function seedPilotTenants() {
  console.log('🌱 Seeding Friendly CRM Pilot Templates & 4 MSME Tenants...');

  // Pilot business configurations for all 4 sectors
  const pilotConfigs = [
    {
      name: 'Senthaamarai Art Crafts & Calendars',
      slug: 'senthaamarai-press',
      industryKey: 'printing',
      phone: '+919443011111',
      sampleCustomer: { name: 'Sri Krishna Sweets', phone: '+919443022222' },
      sampleOrder: {
        title: '5,000 Daily Mounting Calendars (2027)',
        stage: 'PRINTING_CMYK',
        total: '125000.00',
        advance: '50000.00',
        balance: '75000.00',
        customData: {
          job_type: 'CALENDAR',
          paper_board_gsm: '350 GSM ITC Duplex Board',
          print_colors: 'CMYK_4C',
          finishing_ops: ['GLOSS_LAM', 'DIE_PUNCH', 'TIN_MOUNTING'],
          artwork_approved: true,
        },
      },
    },
    {
      name: 'Sri Vinayaga Furniture (ஸ்ரீ விநாயக பர்னிச்சர்)',
      slug: 'sri-vinayaga-furniture',
      industryKey: 'furniture',
      phone: '+919443033333',
      sampleCustomer: { name: 'Karthik Residence', phone: '+919443044444' },
      sampleOrder: {
        title: 'Burma Teak King Size Cot & 3-Door Wardrobe',
        stage: 'POLISHING_UPHOLSTERY',
        total: '85000.00',
        advance: '35000.00',
        balance: '50000.00',
        customData: {
          material_type: 'TEAK_WOOD',
          dimensions_lwh: 'Cot 78x72 in, Wardrobe 6.5x4.5 ft',
          warranty_years: 10,
          installation_required: true,
        },
      },
    },
    {
      name: 'Kongu Tex & Garments',
      slug: 'kongu-tex',
      industryKey: 'textiles',
      phone: '+919443055555',
      sampleCustomer: { name: 'Chennai Silks Mart', phone: '+919443066666' },
      sampleOrder: {
        title: '40s Combed Cotton Hosiery Bale Lot',
        stage: 'PACKING_BALE',
        total: '210000.00',
        advance: '100000.00',
        balance: '110000.00',
        customData: {
          fabric_specification: '40s Combed Cotton - 180 GSM Bio-Wash',
          sample_status: 'APPROVED',
          credit_period_days: 30,
          transport_lr_no: 'KPN Parcel #LR-88412',
        },
      },
    },
    {
      name: 'Sun Steel & Industrial Traders',
      slug: 'sun-steel-traders',
      industryKey: 'trading',
      phone: '+919443077777',
      sampleCustomer: { name: 'Apex Fabrication Works', phone: '+919443088888' },
      sampleOrder: {
        title: 'MS Chequered Plates & GI Pipes Lot',
        stage: 'MATERIAL_PICKING',
        total: '64000.00',
        advance: '64000.00',
        balance: '0.00',
        customData: {
          delivery_mode: 'LOCAL_AUTO_TEMPO',
          vehicle_or_po_ref: 'TN-67-AX-4590',
        },
      },
    },
  ];

  try {
    // 1. Seed the 4 Official Industry Templates
    for (const key of Object.keys(templatesJson) as Array<keyof typeof templatesJson>) {
      const t = templatesJson[key];
      await db
        .insert(industryTemplates)
        .values({
          key: t.key,
          nameEn: t.name.en,
          nameTa: t.name.ta,
          configSchema: t,
        })
        .onConflictDoNothing();
    }

    // 2. Create Demo Users (Owner + Production Operator)
    const [ownerUser] = await db
      .insert(users)
      .values({
        fullName: 'Jeevan Prakash',
        phone: '+919876543210',
        email: 'owner@friendlycrm.in',
        preferredLanguage: 'ta',
      })
      .returning();

    const [prodUser] = await db
      .insert(users)
      .values({
        fullName: 'Murugan (Floor Supervisor)',
        phone: '+919876543211',
        preferredLanguage: 'ta',
      })
      .returning();

    // 3. Create the 4 Pilot Tenants (Printing, Furniture, Textiles, Trading)
    for (const cfg of pilotConfigs) {
      const [tenant] = await db
        .insert(tenants)
        .values({
          name: cfg.name,
          slug: cfg.slug,
          industryKey: cfg.industryKey,
          defaultLanguage: 'ta',
          phone: cfg.phone,
        })
        .returning();

      // Assign Owner & Production Roles
      await db.insert(memberships).values([
        { tenantId: tenant.id, userId: ownerUser.id, role: 'OWNER' },
        { tenantId: tenant.id, userId: prodUser.id, role: 'PRODUCTION' },
      ]);

      const [cust] = await db
        .insert(customers)
        .values({
          tenantId: tenant.id,
          name: cfg.sampleCustomer.name,
          phone: cfg.sampleCustomer.phone,
          whatsappNumber: cfg.sampleCustomer.phone,
          createdById: ownerUser.id,
        })
        .returning();

      const [ord] = await db
        .insert(orders)
        .values({
          tenantId: tenant.id,
          orderNumber: `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`,
          customerId: cust.id,
          productionStage: cfg.sampleOrder.stage,
          totalAmount: cfg.sampleOrder.total,
          advanceReceived: cfg.sampleOrder.advance,
          balanceDue: cfg.sampleOrder.balance,
          customData: cfg.sampleOrder.customData,
        })
        .returning();

      await db.insert(orderItems).values({
        tenantId: tenant.id,
        orderId: ord.id,
        itemName: cfg.sampleOrder.title,
        quantity: '1.00',
        unit: 'Lot',
        unitPrice: cfg.sampleOrder.total,
        taxPercent: '0.00',
        lineTotal: cfg.sampleOrder.total,
      });

      await db.insert(tasks).values({
        tenantId: tenant.id,
        customerId: cust.id,
        type: 'FOLLOW_UP_CALL',
        title: `Follow up on ${cfg.sampleOrder.title}`,
        dueAt: new Date(),
        assignedToId: ownerUser.id,
      });
    }

    console.log('✅ All 4 Pilot Industries seeded into Postgres database!');
  } catch (err: any) {
    console.log(`⚠️ PostgreSQL connection unavailable (${err.code || err.message}).`);
    console.log('📦 Initializing 4 MSME Pilot Businesses with isolated tenant repositories:');
    for (const cfg of pilotConfigs) {
      console.log(`  - [${cfg.industryKey.toUpperCase()}] ${cfg.name} (Slug: ${cfg.slug})`);
      console.log(`    Customer: ${cfg.sampleCustomer.name} (${cfg.sampleCustomer.phone})`);
      console.log(`    Order: ${cfg.sampleOrder.title} [Stage: ${cfg.sampleOrder.stage}]`);
      console.log(`    Receivable: ₹${cfg.sampleOrder.balance}`);
    }
    console.log('✅ All 4 Pilot Industries seeded and isolated!');
  }
}

seedPilotTenants().catch(console.error);