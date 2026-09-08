import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Production guard: the seed inserts demo data with well-known credentials
  // (admin@pos.com / admin123, ...). Refuse to run against a production database
  // unless the operator explicitly opts in with ALLOW_PROD_SEED=true.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    console.error(
      'Refusing to seed: NODE_ENV=production.\n' +
      'The seed creates demo records with well-known credentials.\n' +
      'To seed a production database anyway, re-run with ALLOW_PROD_SEED=true.'
    );
    process.exit(1);
  }

  console.log('Seeding database...');

  // Create organization
  const org = await prisma.organization.create({
    data: {
      name: 'Demo Store',
      industry: 'RETAIL',
      currency: 'USD',
      taxRate: 8.5,
      phone: '+1 555-0100',
      email: 'info@demostore.com',
      address: '123 Main St, City, State 12345',
      isActive: true,
    },
  });
  console.log('Created organization:', org.name);

  // Create region
  const region = await prisma.region.create({
    data: {
      organizationId: org.id,
      name: 'West Coast',
      isActive: true,
    },
  });
  console.log('Created region:', region.name);

  // Create location
  const location = await prisma.location.create({
    data: {
      organizationId: org.id,
      regionId: region.id,
      name: 'Main Store',
      address: org.address,
      phone: org.phone,
      isActive: true,
    },
  });
  console.log('Created location:', location.name);

  // Create second location
  const location2 = await prisma.location.create({
    data: {
      organizationId: org.id,
      regionId: region.id,
      name: 'Downtown Branch',
      address: '456 Market St, City, State 12345',
      phone: '+1 555-0101',
      isActive: true,
    },
  });
  console.log('Created location:', location2.name);

  // Create warehouse
  const warehouse = await prisma.warehouse.create({
    data: {
      organizationId: org.id,
      name: 'Central Warehouse',
      address: '789 Industrial Blvd, City, State 12345',
      isActive: true,
    },
  });
  console.log('Created warehouse:', warehouse.name);

  // Create register
  const register = await prisma.register.create({
    data: {
      organizationId: org.id,
      locationId: location.id,
      name: 'Register 1',
      status: 'CLOSED',
    },
  });
  console.log('Created register:', register.name);

  // Create admin user (OWNER)
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@pos.com',
      password: hashedPassword,
      name: 'Admin User',
      role: 'OWNER',
      isActive: true,
    },
  });
  console.log('Created admin user:', admin.email);

  // Create employee record for admin
  const employee = await prisma.employee.create({
    data: {
      organizationId: org.id,
      userId: admin.id,
      employeeNumber: 'EMP-001',
      department: 'Management',
      position: 'OWNER',
      hourlyRate: 0,
      commissionRate: 0,
      isActive: true,
    },
  });
  console.log('Created employee record for admin');

  // Link employee to location
  await prisma.employeeLocation.create({
    data: {
      employeeId: employee.id,
      locationId: location.id,
    },
  });

  // Create cashier user
  const cashierPassword = await bcrypt.hash('cashier123', 10);
  const cashier = await prisma.user.create({
    data: {
      email: 'cashier@pos.com',
      password: cashierPassword,
      name: 'Cashier User',
      role: 'CASHIER',
      isActive: true,
    },
  });
  console.log('Created cashier user:', cashier.email);

  const cashierEmployee = await prisma.employee.create({
    data: {
      organizationId: org.id,
      userId: cashier.id,
      employeeNumber: 'EMP-002',
      department: 'Sales',
      position: 'CASHIER',
      hourlyRate: 15,
      commissionRate: 2,
      isActive: true,
    },
  });

  await prisma.employeeLocation.create({
    data: {
      employeeId: cashierEmployee.id,
      locationId: location.id,
    },
  });

  // Create manager user
  const managerPassword = await bcrypt.hash('manager123', 10);
  const manager = await prisma.user.create({
    data: {
      email: 'manager@pos.com',
      password: managerPassword,
      name: 'Manager User',
      role: 'MANAGER',
      isActive: true,
    },
  });
  console.log('Created manager user:', manager.email);

  const managerEmployee = await prisma.employee.create({
    data: {
      organizationId: org.id,
      userId: manager.id,
      employeeNumber: 'EMP-003',
      department: 'Operations',
      position: 'MANAGER',
      hourlyRate: 25,
      commissionRate: 1,
      isActive: true,
    },
  });

  await prisma.employeeLocation.create({
    data: {
      employeeId: managerEmployee.id,
      locationId: location.id,
    },
  });

  // Create categories
  const categories = await Promise.all([
    prisma.category.create({
      data: { organizationId: org.id, name: 'Beverages', color: '#3B82F6', description: 'Drinks and beverages', sortOrder: 1 },
    }),
    prisma.category.create({
      data: { organizationId: org.id, name: 'Food', color: '#EF4444', description: 'Food items', sortOrder: 2 },
    }),
    prisma.category.create({
      data: { organizationId: org.id, name: 'Snacks', color: '#F59E0B', description: 'Snacks and snacks', sortOrder: 3 },
    }),
    prisma.category.create({
      data: { organizationId: org.id, name: 'Electronics', color: '#8B5CF6', description: 'Electronic items', sortOrder: 4 },
    }),
  ]);
  console.log('Created categories:', categories.length);

  // Create products with inventory
  const products = await Promise.all([
    prisma.product.create({
      data: {
        organizationId: org.id,
        name: 'Coffee',
        sku: 'BEV-001',
        price: 3.50,
        costPrice: 1.50,
        categoryId: categories[0].id,
        description: 'Fresh brewed coffee',
      },
    }),
    prisma.product.create({
      data: {
        organizationId: org.id,
        name: 'Sandwich',
        sku: 'FOOD-001',
        price: 8.00,
        costPrice: 4.00,
        categoryId: categories[1].id,
        description: 'Delicious sandwich',
      },
    }),
    prisma.product.create({
      data: {
        organizationId: org.id,
        name: 'Chips',
        sku: 'SNK-001',
        price: 2.50,
        costPrice: 1.00,
        categoryId: categories[2].id,
        description: 'Crispy chips',
      },
    }),
    prisma.product.create({
      data: {
        organizationId: org.id,
        name: 'Soda',
        sku: 'BEV-002',
        price: 2.00,
        costPrice: 0.80,
        categoryId: categories[0].id,
        description: 'Carbonated drink',
      },
    }),
    prisma.product.create({
      data: {
        organizationId: org.id,
        name: 'Headphones',
        sku: 'ELEC-001',
        price: 49.99,
        costPrice: 25.00,
        categoryId: categories[3].id,
        description: 'Wireless headphones',
      },
    }),
  ]);
  console.log('Created products:', products.length);

  // Create inventory balances for each product at both locations
  await Promise.all([
    prisma.inventoryBalance.create({ data: { productId: products[0].id, locationId: location.id, quantity: 100, reorderPoint: 20 } }),
    prisma.inventoryBalance.create({ data: { productId: products[1].id, locationId: location.id, quantity: 50, reorderPoint: 10 } }),
    prisma.inventoryBalance.create({ data: { productId: products[2].id, locationId: location.id, quantity: 200, reorderPoint: 50 } }),
    prisma.inventoryBalance.create({ data: { productId: products[3].id, locationId: location.id, quantity: 150, reorderPoint: 30 } }),
    prisma.inventoryBalance.create({ data: { productId: products[4].id, locationId: location.id, quantity: 25, reorderPoint: 5 } }),
    // Second location
    prisma.inventoryBalance.create({ data: { productId: products[0].id, locationId: location2.id, quantity: 60, reorderPoint: 15 } }),
    prisma.inventoryBalance.create({ data: { productId: products[1].id, locationId: location2.id, quantity: 30, reorderPoint: 8 } }),
    prisma.inventoryBalance.create({ data: { productId: products[2].id, locationId: location2.id, quantity: 100, reorderPoint: 25 } }),
  ]);
  console.log('Created inventory balances for all products');

  // Create sample customers with enhanced data
  await Promise.all([
    prisma.customer.create({
      data: {
        organizationId: org.id,
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1 555-0101',
        address: '456 Oak St',
        totalSpent: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        loyaltyPoints: 0,
        marketingOptIn: true,
        tags: ['vip'],
      },
    }),
    prisma.customer.create({
      data: {
        organizationId: org.id,
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '+1 555-0102',
        address: '789 Pine St',
        totalSpent: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        loyaltyPoints: 0,
        marketingOptIn: true,
        tags: ['regular'],
      },
    }),
    prisma.customer.create({
      data: {
        organizationId: org.id,
        name: 'Bob Wilson',
        email: 'bob@example.com',
        phone: '+1 555-0103',
        address: '321 Elm St',
        totalSpent: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        loyaltyPoints: 0,
        marketingOptIn: false,
        tags: ['new'],
      },
    }),
  ]);
  console.log('Created sample customers');

  // Create store settings
  await prisma.storeSettings.create({
    data: {
      organizationId: org.id,
      storeName: org.name,
      address: org.address,
      phone: org.phone,
      email: org.email,
      receiptFooter: 'Thank you for your purchase!',
      lowStockAlertEnabled: true,
    },
  });
  console.log('Created store settings');

  // Create loyalty program
  await prisma.loyaltyProgram.create({
    data: {
      organizationId: org.id,
      name: 'Demo Rewards',
      description: 'Earn 1 point per dollar spent',
      pointsPerDollar: 1,
      pointsPerVisit: 0,
      rewardThreshold: 100,
      rewardValue: 10,
      isActive: true,
    },
  });
  console.log('Created loyalty program');

  // Create restaurant tables
  await Promise.all([
    prisma.restaurantTable.create({ data: { organizationId: org.id, number: 1, name: 'Table 1', capacity: 2, section: 'Main' } }),
    prisma.restaurantTable.create({ data: { organizationId: org.id, number: 2, name: 'Table 2', capacity: 4, section: 'Main' } }),
    prisma.restaurantTable.create({ data: { organizationId: org.id, number: 3, name: 'Table 3', capacity: 4, section: 'Main' } }),
    prisma.restaurantTable.create({ data: { organizationId: org.id, number: 4, name: 'Table 4', capacity: 6, section: 'Patio' } }),
    prisma.restaurantTable.create({ data: { organizationId: org.id, number: 5, name: 'Table 5', capacity: 8, section: 'Patio' } }),
  ]);
  console.log('Created restaurant tables');

  // Create suppliers
  await Promise.all([
    prisma.supplier.create({ data: { organizationId: org.id, name: 'Coffee Supply Co', contactName: 'Bob', email: 'bob@coffeesupply.com', phone: '+1 555-0200' } }),
    prisma.supplier.create({ data: { organizationId: org.id, name: 'Food Distributors Inc', contactName: 'Alice', email: 'alice@fooddist.com', phone: '+1 555-0300' } }),
  ]);
  console.log('Created suppliers');

  // Create sample promotions
  const now = new Date();
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await Promise.all([
    prisma.promotion.create({
      data: {
        organizationId: org.id,
        name: 'Summer Sale',
        type: 'PERCENTAGE',
        value: 15,
        startDate: now,
        endDate: nextMonth,
        isActive: true,
      },
    }),
    prisma.promotion.create({
      data: {
        organizationId: org.id,
        name: '$5 Off Sandwiches',
        type: 'FIXED',
        value: 5,
        startDate: now,
        endDate: nextMonth,
        isActive: true,
      },
    }),
  ]);
  console.log('Created sample promotions');

  // Create sample coupons
  await Promise.all([
    prisma.coupon.create({
      data: {
        organizationId: org.id,
        code: 'WELCOME10',
        type: 'PERCENTAGE',
        value: 10,
        usageLimit: 100,
        usedCount: 0,
        startDate: new Date(),
        isActive: true,
      },
    }),
    prisma.coupon.create({
      data: {
        organizationId: org.id,
        code: 'SAVE5',
        type: 'FIXED',
        value: 5,
        minPurchase: 25,
        usageLimit: 50,
        usedCount: 0,
        startDate: new Date(),
        isActive: true,
      },
    }),
    prisma.coupon.create({
      data: {
        organizationId: org.id,
        code: 'FREESHIP',
        type: 'FREE_SHIPPING',
        value: 0,
        usageLimit: 200,
        usedCount: 0,
        startDate: new Date(),
        isActive: true,
      },
    }),
  ]);
  console.log('Created sample coupons');

  // Create sample campaign
  await prisma.campaign.create({
    data: {
      organizationId: org.id,
      name: 'Welcome Back',
      type: 'EMAIL',
      audience: 'Dormant',
      status: 'DRAFT',
      sentCount: 0,
    },
  });
  console.log('Created sample campaign');

  // ── Roles & Permissions (§15) ──────────────────────────────
  console.log('\nSeeding roles & permissions...');

  // Create permissions
  const permDefs = [
    { resource: 'orders', action: 'create' }, { resource: 'orders', action: 'read' },
    { resource: 'orders', action: 'update' }, { resource: 'orders', action: 'refund' },
    { resource: 'products', action: 'create' }, { resource: 'products', action: 'read' },
    { resource: 'products', action: 'update' }, { resource: 'products', action: 'delete' },
    { resource: 'inventory', action: 'read' }, { resource: 'inventory', action: 'adjust' },
    { resource: 'customers', action: 'create' }, { resource: 'customers', action: 'read' },
    { resource: 'customers', action: 'update' }, { resource: 'customers', action: 'delete' },
    { resource: 'employees', action: 'create' }, { resource: 'employees', action: 'read' },
    { resource: 'employees', action: 'update' }, { resource: 'employees', action: 'delete' },
    { resource: 'reports', action: 'read' }, { resource: 'reports', action: 'export' },
    { resource: 'accounting', action: 'read' }, { resource: 'accounting', action: 'create' },
    { resource: 'accounting', action: 'reconcile' },
    { resource: 'settings', action: 'read' }, { resource: 'settings', action: 'update' },
    { resource: 'webhooks', action: 'create' }, { resource: 'webhooks', action: 'read' },
    { resource: 'webhooks', action: 'update' }, { resource: 'webhooks', action: 'delete' },
    { resource: 'devices', action: 'create' }, { resource: 'devices', action: 'read' },
    { resource: 'devices', action: 'update' }, { resource: 'devices', action: 'revoke' },
  ];

  const createdPerms: Record<string, any> = {};
  for (const pd of permDefs) {
    const perm = await prisma.permission.create({
      data: { resource: pd.resource, action: pd.action, description: `${pd.action} ${pd.resource}` },
    });
    createdPerms[`${pd.resource}.${pd.action}`] = perm;
  }
  console.log(`Created ${Object.keys(createdPerms).length} permissions`);

  // Create system roles
  const ownerRole = await prisma.role.create({
    data: { organizationId: org.id, name: 'OWNER', description: 'Full system access', isSystem: true, isActive: true },
  });
  const adminRole = await prisma.role.create({
    data: { organizationId: org.id, name: 'ADMIN', description: 'Administrative access', isSystem: true, isActive: true },
  });
  const managerRole = await prisma.role.create({
    data: { organizationId: org.id, name: 'MANAGER', description: 'Operational management', isSystem: true, isActive: true },
  });
  const cashierRole = await prisma.role.create({
    data: { organizationId: org.id, name: 'CASHIER', description: 'POS cashier access', isSystem: true, isActive: true },
  });
  console.log('Created 4 system roles');

  // Assign all permissions to OWNER
  for (const perm of Object.values(createdPerms)) {
    await prisma.rolePermission.create({ data: { roleId: ownerRole.id, permissionId: perm.id } });
  }

  // Assign most permissions to ADMIN (all except settings.update)
  for (const [key, perm] of Object.entries(createdPerms)) {
    if (key !== 'settings.update') {
      await prisma.rolePermission.create({ data: { roleId: adminRole.id, permissionId: perm.id } });
    }
  }

  // Manager: orders, products, inventory, customers, reports, accounting.read
  const managerPerms = Object.entries(createdPerms).filter(([key]) =>
    key.startsWith('orders.') || key.startsWith('products.') || key.startsWith('inventory.') ||
    key.startsWith('customers.') || key.startsWith('reports.') || key === 'accounting.read'
  );
  for (const [, perm] of managerPerms) {
    await prisma.rolePermission.create({ data: { roleId: managerRole.id, permissionId: perm.id } });
  }

  // Cashier: orders.create, orders.read, products.read, inventory.read, customers.read, customers.create
  const cashierPermKeys = ['orders.create', 'orders.read', 'products.read', 'inventory.read', 'customers.read', 'customers.create'];
  for (const key of cashierPermKeys) {
    await prisma.rolePermission.create({ data: { roleId: cashierRole.id, permissionId: createdPerms[key].id } });
  }
  console.log('Assigned permissions to roles');

  // Assign roles to employees
  await prisma.employee.update({ where: { id: employee.id }, data: { roleId: ownerRole.id } });
  await prisma.employee.update({ where: { id: cashierEmployee.id }, data: { roleId: cashierRole.id } });
  await prisma.employee.update({ where: { id: managerEmployee.id }, data: { roleId: managerRole.id } });
  console.log('Assigned roles to employees');

  // ── Devices (§38) ──────────────────────────────────────────
  console.log('\nSeeding devices...');
  await prisma.device.create({
    data: {
      organizationId: org.id,
      name: 'Main POS Terminal',
      type: 'POS_TERMINAL',
      status: 'ONLINE',
      locationId: location.id,
      registerId: register.id,
      lastHeartbeatAt: new Date(),
      configVersion: '1',
    },
  });
  await prisma.device.create({
    data: {
      organizationId: org.id,
      name: 'Kitchen Display',
      type: 'KITCHEN_DISPLAY',
      status: 'ONLINE',
      locationId: location.id,
      lastHeartbeatAt: new Date(),
      configVersion: '1',
    },
  });
  await prisma.device.create({
    data: {
      organizationId: org.id,
      name: 'Mobile POS 1',
      type: 'MOBILE_DEVICE',
      status: 'OFFLINE',
      locationId: location.id,
      configVersion: '1',
    },
  });
  console.log('Created 3 devices');

  // ── Gift Cards (§18) ───────────────────────────────────────
  console.log('\nSeeding gift cards...');
  const customers = await prisma.customer.findMany({ where: { organizationId: org.id } });
  await prisma.giftCard.create({
    data: {
      organizationId: org.id,
      cardNumber: 'GC-1001-0001',
      customerId: customers[0]?.id,
      balance: 50.00,
      originalAmount: 50.00,
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  });
  await prisma.giftCard.create({
    data: {
      organizationId: org.id,
      cardNumber: 'GC-1001-0002',
      customerId: customers[1]?.id,
      balance: 25.00,
      originalAmount: 100.00,
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  });
  console.log('Created 2 gift cards');

  // ── Store Credits (§18) ────────────────────────────────────
  await prisma.storeCredit.create({
    data: {
      organizationId: org.id,
      customerId: customers[2]?.id,
      balance: 15.00,
      originalAmount: 15.00,
      reason: 'Return credit',
      referenceType: 'RETURN',
      status: 'ACTIVE',
    },
  });
  console.log('Created 1 store credit');

  // ── Menu Categories (§17) ──────────────────────────────────
  console.log('\nSeeding menu categories...');
  await prisma.menuCategory.create({
    data: {
      organizationId: org.id,
      name: 'Appetizers',
      description: 'Start your meal right',
      sortOrder: 1,
      isActive: true,
      displayTime: 'ALL_DAY',
    },
  });
  await prisma.menuCategory.create({
    data: {
      organizationId: org.id,
      name: 'Main Courses',
      description: 'Hearty entrées',
      sortOrder: 2,
      isActive: true,
      displayTime: 'LUNCH,DINNER',
    },
  });
  await prisma.menuCategory.create({
    data: {
      organizationId: org.id,
      name: 'Desserts',
      description: 'Sweet endings',
      sortOrder: 3,
      isActive: true,
      displayTime: 'ALL_DAY',
    },
  });
  console.log('Created 3 menu categories');

  // ── Rewards (§19) ──────────────────────────────────────────
  console.log('\nSeeding rewards...');
  await prisma.reward.create({
    data: {
      organizationId: org.id,
      name: '$10 Off',
      description: 'Redeem 100 points for $10 off your next purchase',
      pointsRequired: 100,
      value: 10,
      type: 'DISCOUNT',
      isActive: true,
    },
  });
  await prisma.reward.create({
    data: {
      organizationId: org.id,
      name: 'Free Coffee',
      description: 'Redeem 30 points for a free coffee',
      pointsRequired: 30,
      value: 3.50,
      type: 'PRODUCT',
      isActive: true,
    },
  });
  console.log('Created 2 rewards');

  // ── Commerce Hub (§13 Omnichannel / §48 Phase 3) ─────────────
  console.log('\nSeeding commerce hub...');
  await prisma.salesChannel.createMany({
    data: [
      { organizationId: org.id, key: 'WEBSITE', name: 'Online Store', channelType: 'ONLINE', platform: 'shopify', url: 'https://shop.demostore.com', isActive: true },
      { organizationId: org.id, key: 'MOBILE_APP', name: 'Mobile App', channelType: 'MOBILE', isActive: true },
      { organizationId: org.id, key: 'MARKETPLACE', name: 'Amazon Marketplace', channelType: 'MARKETPLACE', platform: 'amazon', isActive: true },
    ],
  });

  await prisma.deliveryZone.createMany({
    data: [
      { organizationId: org.id, locationId: location.id, name: 'Downtown 5mi', radiusMiles: 5, baseFee: 5, perMileFee: 1, minOrder: 20, maxDistance: 5, isActive: true },
      { organizationId: org.id, locationId: location.id, name: 'Extended 15mi', radiusMiles: 15, baseFee: 12, perMileFee: 1.5, minOrder: 50, maxDistance: 15, isActive: true },
    ],
  });

  await prisma.integrationConnection.create({
    data: { organizationId: org.id, provider: 'shopify', type: 'ECOMMERCE', name: 'Shopify', status: 'CONNECTED', syncStatus: 'IDLE', lastSyncAt: new Date() },
  });

  // Sample online (website → delivery) order demonstrating omnichannel flow
  const sampleProduct = products[0];
  const sampleCustomer = customers[0];
  if (sampleProduct) {
    const unitPrice = Number(sampleProduct.price || 0);
    const qty = 2;
    const coSubtotal = unitPrice * qty;
    const coTax = coSubtotal * (Number(org.taxRate) / 100);
    const coDeliveryFee = 5 + 1 * 3;
    await prisma.order.create({
      data: {
        orderNumber: `ORD-WEB-${Date.now()}`,
        organizationId: org.id,
        locationId: location.id,
        customerId: sampleCustomer?.id,
        channel: 'WEBSITE',
        status: 'CONFIRMED',
        subtotal: coSubtotal,
        taxAmount: coTax,
        totalAmount: coSubtotal + coTax + coDeliveryFee,
        fulfillmentType: 'DELIVERY',
        items: {
          create: {
            productId: sampleProduct.id,
            productName: sampleProduct.name,
            quantity: qty,
            unitPrice,
            discountAmt: 0,
            taxAmt: 0,
            totalAmount: coSubtotal,
          },
        },
        fulfillments: {
          create: {
            type: 'DELIVERY',
            status: 'PENDING',
            recipientName: sampleCustomer?.name || 'Web Customer',
            addressLine1: '789 Delivery Way',
            city: 'Springfield',
            state: 'CA',
            postalCode: '90210',
            phoneNumber: '+1 555-0199',
            deliveryFee: coDeliveryFee,
            distanceMiles: 3,
            etaMinutes: 33,
          },
        },
      },
    });
  }
  console.log('Created sales channels, delivery zones, marketplace integration, sample online order');

  // ── Product Catalog extensions (§11) ───────────────────────
  console.log('\nSeeding product catalog extensions...');
  const brand = await prisma.brand.create({
    data: { organizationId: org.id, name: 'House Brand', description: 'In-house label' },
  });
  const taxRule = await prisma.taxRule.create({
    data: { organizationId: org.id, name: 'Standard VAT', rate: 8.5 },
  });
  await prisma.product.update({ where: { id: products[0].id }, data: { brandId: brand.id, taxRuleId: taxRule.id } });

  await prisma.productVariant.createMany({
    data: [
      { productId: products[0].id, name: 'Size', value: 'Small', priceAdj: 0 },
      { productId: products[0].id, name: 'Size', value: 'Large', priceAdj: 1.0 },
    ],
  });

  const modGroup = await prisma.modifierGroup.create({
    data: { organizationId: org.id, name: 'Extras', minSelect: 0, maxSelect: 3 },
  });
  await prisma.modifier.createMany({
    data: [
      { modifierGroupId: modGroup.id, name: 'Extra Cheese', priceAdj: 1.5 },
      { modifierGroupId: modGroup.id, name: 'Bacon', priceAdj: 2.0 },
    ],
  });

  const priceList = await prisma.priceList.create({
    data: { organizationId: org.id, name: 'VIP Pricing', type: 'VIP', description: 'Loyalty member prices' },
  });
  await prisma.priceListItem.create({ data: { priceListId: priceList.id, productId: products[0].id, price: 3.0 } });

  await prisma.bundle.create({
    data: {
      organizationId: org.id, name: 'Breakfast Combo', price: 12.0, description: 'Coffee + Sandwich + Chips',
      items: { create: [{ productId: products[0].id, quantity: 1 }, { productId: products[1].id, quantity: 1 }, { productId: products[2].id, quantity: 1 }] },
    },
  });
  await prisma.kit.create({
    data: {
      organizationId: org.id, name: 'Catering Pack', description: 'Bulk sandwich kit',
      components: { create: [{ productId: products[1].id, quantity: 10 }] },
    },
  });
  const composite = await prisma.compositeProduct.create({
    data: { organizationId: org.id, name: 'Build Your Own Sandwich', description: 'Choose your ingredients' },
  });
  const compOption = await prisma.compositeProductOption.create({
    data: { compositeId: composite.id, name: 'Protein', required: true, minSelect: 1, maxSelect: 1 },
  });
  await prisma.compositeProductOptionValue.create({ data: { optionId: compOption.id, productId: products[1].id, priceAdj: 0 } });
  console.log('Created brand, tax rule, variants, modifier group, price list, bundle, kit, composite');

  // ── Offline sync ledger (§25 / §26) ────────────────────────
  console.log('\nSeeding offline sync ledger...');
  const offlineDevice = await prisma.device.findFirst({ where: { organizationId: org.id, status: 'OFFLINE' } });
  const syncDeviceId = offlineDevice?.id || 'seed-device-offline';
  await prisma.syncTransaction.create({
    data: {
      organizationId: org.id, deviceId: syncDeviceId,
      transactionId: 'seed-tx-0001', sequenceNo: 1, type: 'SALE',
      payload: { note: 'Offline sale captured while disconnected', total: 14.0 },
      status: 'SYNCED', deviceTimestamp: new Date(Date.now() - 3600_000),
      result: { applied: true, acknowledged: true },
    },
  });
  await prisma.syncTransaction.create({
    data: {
      organizationId: org.id, deviceId: syncDeviceId,
      transactionId: 'seed-tx-0002', sequenceNo: 2, type: 'INVENTORY_ADJUSTMENT',
      payload: { note: 'Offline stock count correction' },
      status: 'CONFLICT', deviceTimestamp: new Date(Date.now() - 1800_000),
      conflictReason: 'Product/location reference missing in offline payload',
    },
  });
  console.log('Created 2 sync transactions (1 synced, 1 conflict)');

  // ── Payments: chargebacks / disputes / payouts (§10) ────────
  console.log('\nSeeding chargebacks, disputes, payouts...');
  const payProduct = products[0];
  const payCustomer = customers[0];
  const payUnit = Number(payProduct?.price || 10);
  const paySubtotal = payUnit * 3;
  const payTax = paySubtotal * (Number(org.taxRate) / 100);
  const seedOrder = await prisma.order.create({
    data: {
      orderNumber: `ORD-PAY-${Date.now()}`,
      organizationId: org.id,
      locationId: location.id,
      customerId: payCustomer?.id,
      channel: 'IN_STORE',
      status: 'PAID',
      subtotal: paySubtotal,
      taxAmount: payTax,
      totalAmount: paySubtotal + payTax,
      items: {
        create: {
          productId: payProduct.id,
          productName: payProduct.name,
          quantity: 3,
          unitPrice: payUnit,
          discountAmt: 0,
          taxAmt: payTax,
          totalAmount: paySubtotal,
        },
      },
    },
  });
  const seedPayment = await prisma.payment.create({
    data: {
      orderId: seedOrder.id,
      method: 'CARD',
      provider: 'stripe',
      amount: paySubtotal + payTax,
      status: 'COMPLETED',
      reference: `ch_${Date.now()}`,
    },
  });
  await prisma.chargeback.create({
    data: { organizationId: org.id, paymentId: seedPayment.id, amount: payUnit, reason: 'Cardholder does not recognize transaction', status: 'OPEN' },
  });
  await prisma.dispute.create({
    data: { organizationId: org.id, paymentId: seedPayment.id, amount: payUnit, reason: 'Product not as described', status: 'UNDER_REVIEW' },
  });
  await prisma.payout.create({
    data: { organizationId: org.id, paymentId: seedPayment.id, amount: paySubtotal + payTax, currency: 'USD', status: 'PENDING', scheduledAt: new Date(Date.now() + 86400_000) },
  });
  await prisma.payout.create({
    data: { organizationId: org.id, amount: 250, currency: 'USD', status: 'COMPLETED', completedAt: new Date() },
  });
  console.log('Created 1 chargeback, 1 dispute, 2 payouts');

  // ── Inventory batches / lots / serials (§12) ────────────────
  console.log('\nSeeding inventory batches & serial numbers...');
  const batchProduct = products[0];
  await prisma.inventoryBatch.create({
    data: {
      organizationId: org.id, productId: batchProduct.id, locationId: location.id,
      batchNumber: `LOT-${Date.now()}-A`, quantity: 50, remaining: 50, unitCost: 2.5,
      expirationDate: new Date(Date.now() + 10 * 86400_000), status: 'ACTIVE',
    },
  });
  const batch2 = await prisma.inventoryBatch.create({
    data: {
      organizationId: org.id, productId: products[1].id, locationId: location.id,
      batchNumber: `LOT-${Date.now()}-B`, quantity: 30, remaining: 12, unitCost: 4.0,
      expirationDate: new Date(Date.now() + 120 * 86400_000), status: 'ACTIVE',
    },
  });
  await prisma.serialNumber.createMany({
    data: [
      { organizationId: org.id, productId: products[1].id, batchId: batch2.id, serial: 'SN-1001', status: 'IN_STOCK', locationId: location.id },
      { organizationId: org.id, productId: products[1].id, batchId: batch2.id, serial: 'SN-1002', status: 'SOLD', locationId: location.id },
      { organizationId: org.id, productId: products[1].id, batchId: batch2.id, serial: 'SN-1003', status: 'RESERVED', locationId: location.id },
    ],
  });
  console.log('Created 2 batches (1 expiring soon) & 3 serial numbers');

  // ── Notifications (§5) ──────────────────────────────────────
  console.log('\nSeeding notifications...');
  await prisma.notification.createMany({
    data: [
      { organizationId: org.id, userId: null, type: 'LOW_STOCK', severity: 'WARNING', title: 'Low stock alert', message: `${batchProduct.name} is running low at Main Store.`, sourceEvent: 'inventory.low_stock' },
      { organizationId: org.id, userId: null, type: 'CHARGEBACK', severity: 'CRITICAL', title: 'New chargeback filed', message: 'A cardholder dispute was filed for a recent payment.', sourceEvent: 'chargeback.created' },
      { organizationId: org.id, userId: admin.id, type: 'SYSTEM', severity: 'INFO', title: 'Welcome to UnifiedPOS', message: 'Your account is ready. Explore the dashboard to get started.', isRead: false },
    ],
  });
  console.log('Created 3 notifications');

  console.log('\nSeeding completed successfully!');
  console.log('\nLogin credentials:');
  console.log('  Admin (OWNER):  admin@pos.com / admin123');
  console.log('  Manager:        manager@pos.com / manager123');
  console.log('  Cashier:        cashier@pos.com / cashier123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
