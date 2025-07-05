import fs from 'fs/promises'
import path from 'path'

const DATA_FILE = path.join(process.cwd(), 'data', 'users.json')

// Ensure data directory exists
async function ensureDataDir() {
  const dataDir = path.dirname(DATA_FILE)
  try {
    await fs.access(dataDir)
  } catch {
    await fs.mkdir(dataDir, { recursive: true })
  }
}

// Read data from JSON file
async function readData() {
  try {
    await ensureDataDir()
    const data = await fs.readFile(DATA_FILE, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    // If file doesn't exist, return empty structure
    return {
      customers: {},
      subscriptions: {},
      payments: {},
      entitlements: {}  // 🆕 Added entitlements
    }
  }
}

// Write data to JSON file
async function writeData(data) {
  await ensureDataDir()
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

// Customer operations
export async function saveCustomer(customerId, customerData) {
  const data = await readData()

  // Preserve existing entitlements if they exist
  const existingCustomer = data.customers[customerId]
  const existingEntitlements = existingCustomer?.entitlements || {}

  data.customers[customerId] = {
    ...customerData,
    entitlements: existingEntitlements, // Keep existing entitlements
    updatedAt: new Date().toISOString()
  }

  await writeData(data)
}

export async function getCustomer(customerId) {
  const data = await readData()
  return data.customers[customerId] || null
}

export async function getCustomerByEmail(email) {
  const data = await readData()
  return Object.values(data.customers).find(customer => customer.email === email) || null
}

// Subscription operations
export async function saveSubscription(subscriptionId, subscriptionData) {
  const data = await readData()
  if (!data.subscriptions) {
    data.subscriptions = {}
  }
  data.subscriptions[subscriptionId] = {
    ...data.subscriptions[subscriptionId],
    ...subscriptionData,
    updatedAt: new Date().toISOString()
  }
  await writeData(data)
}

export async function getSubscription(subscriptionId) {
  const data = await readData()
  return data.subscriptions[subscriptionId] || null
}

// Payment operations
export async function savePayment(paymentId, paymentData) {
  const data = await readData()
  data.payments[paymentId] = {
    ...data.payments[paymentId],
    ...paymentData,
    updatedAt: new Date().toISOString()
  }
  await writeData(data)
}

// 🆕 NEW: Entitlement operations
export async function saveCustomerEntitlements(customerId, entitlements) {
  const data = await readData()

  // Ensure customer exists
  if (!data.customers[customerId]) {
    console.warn(`Customer ${customerId} not found when saving entitlements`)
    return
  }

  // Replace all entitlements for this customer (overwrite approach)
  data.customers[customerId].entitlements = entitlements
  data.customers[customerId].updatedAt = new Date().toISOString()

  await writeData(data)
  console.log(`💾 Saved ${Object.keys(entitlements).length} entitlements for customer ${customerId}`)
}

export async function getEntitlement(entitlementId) {
  const data = await readData()
  return data.entitlements?.[entitlementId] || null
}

export async function getCustomerEntitlements(customerId) {
  const data = await readData()
  if (!data.entitlements) return []

  return Object.values(data.entitlements).filter(
    entitlement => entitlement.customerId === customerId
  )
}

export async function getActiveEntitlementsByCustomer(customerId) {
  const data = await readData()
  if (!data.entitlements) return []

  return Object.values(data.entitlements).filter(
    entitlement => entitlement.customerId === customerId && entitlement.status === 'active'
  )
}

export async function removeEntitlement(entitlementId) {
  const data = await readData()
  if (data.entitlements && data.entitlements[entitlementId]) {
    delete data.entitlements[entitlementId]
    await writeData(data)
    return true
  }
  return false
}

// 🆕 NEW: Get customer with their entitlements
export async function getCustomerWithEntitlements(customerId) {
  const customer = await getCustomer(customerId)
  if (!customer) return null

  const entitlements = await getActiveEntitlementsByCustomer(customerId)

  return {
    ...customer,
    entitlements: entitlements.map(ent => ({
      id: ent.stripeEntitlementId,
      featureId: ent.featureId,
      featureLookupKey: ent.featureLookupKey,
      featureName: ent.featureName,
      status: ent.status
    }))
  }
}

// Get all data (for debugging)
export async function getAllData() {
  return await readData()
}

// 🆕 NEW: Helper to get customer's feature access
export async function customerHasFeature(customerId, featureLookupKey) {
  const entitlements = await getActiveEntitlementsByCustomer(customerId)
  return entitlements.some(ent => ent.featureLookupKey === featureLookupKey)
}

// 🆕 NEW: Get all features for a customer
export async function getCustomerFeatures(customerId) {
  const entitlements = await getActiveEntitlementsByCustomer(customerId)
  return entitlements.map(ent => ({
    lookupKey: ent.featureLookupKey,
    name: ent.featureName,
    id: ent.featureId
  }))
}
