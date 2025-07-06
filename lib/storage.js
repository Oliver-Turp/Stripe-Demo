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
      customers: {}
    }
  }
}

// Write data to JSON file
async function writeData(data) {
  await ensureDataDir()
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

// ===== CUSTOMER OPERATIONS =====

export async function saveCustomer(customerId, customerData) {
  const data = await readData()
  
  // Preserve existing nested data if it exists
  const existingCustomer = data.customers[customerId]
  const existingEntitlements = existingCustomer?.entitlements || {}
  const existingSubscription = existingCustomer?.subscription || null
  const existingSuspensionInfo = existingCustomer?.suspensionInfo || null
  const existingSuspendedEntitlements = existingCustomer?.suspendedEntitlements || {}
  
  data.customers[customerId] = {
    ...customerData,
    entitlements: existingEntitlements,
    subscription: existingSubscription,
    suspensionInfo: existingSuspensionInfo,
    suspendedEntitlements: existingSuspendedEntitlements,
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

// ===== SUBSCRIPTION OPERATIONS (nested in customer) =====

export async function saveCustomerSubscription(customerId, subscriptionData) {
  const data = await readData()
  
  if (!data.customers[customerId]) {
    console.warn(`Customer ${customerId} not found when saving subscription`)
    return
  }
  
  data.customers[customerId].subscription = subscriptionData
  data.customers[customerId].updatedAt = new Date().toISOString()
  
  await writeData(data)
  console.log(`💾 Saved subscription for customer ${customerId}`)
}

export async function getCustomerSubscription(customerId) {
  const customer = await getCustomer(customerId)
  return customer?.subscription || null
}

// ===== ENTITLEMENT OPERATIONS (nested in customer) =====

export async function saveCustomerEntitlements(customerId, entitlements) {
  const data = await readData()
  
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

export async function getCustomerEntitlements(customerId) {
  const customer = await getCustomer(customerId)
  return customer?.entitlements || {}
}

export async function getActiveEntitlementsByCustomer(customerId) {
  const entitlements = await getCustomerEntitlements(customerId)
  return Object.values(entitlements).filter(ent => ent.status === 'active')
}

// ===== FEATURE ACCESS HELPERS =====

export async function customerHasFeature(customerId, featureLookupKey) {
  const entitlements = await getActiveEntitlementsByCustomer(customerId)
  return entitlements.some(ent => ent.featureLookupKey === featureLookupKey)
}

export async function getCustomerFeatures(customerId) {
  const entitlements = await getActiveEntitlementsByCustomer(customerId)
  return entitlements.map(ent => ({
    lookupKey: ent.featureLookupKey,
    name: ent.featureName,
    id: ent.featureId
  }))
}

// ===== SUSPENSION OPERATIONS =====

export async function suspendCustomerEntitlements(customerId, suspensionInfo = {}) {
  try {
    console.log(`🔒 SUSPENDING: Starting suspension for customer ${customerId}`)
    
    const data = await readData()
    
    if (!data.customers[customerId]) {
      console.warn(`⚠️ SUSPENDING: Customer ${customerId} not found for suspension`)
      return false
    }
    
    const customer = data.customers[customerId]
    
    // If already suspended, just update suspension info
    if (customer.suspended === true) {
      console.log(`⚠️ SUSPENDING: Customer ${customerId} is already suspended - updating suspension info only`)
      
      customer.suspensionInfo = {
        ...customer.suspensionInfo,
        ...suspensionInfo,
        suspendedAt: customer.suspensionInfo?.suspendedAt || new Date().toISOString(),
        lastAttemptAt: new Date().toISOString()
      }
      
      await writeData(data)
      console.log(`🔒 SUSPENDING: Updated suspension info for already-suspended customer ${customerId}`)
      return true
    }
    
    console.log(`🔒 SUSPENDING: Current entitlements:`, Object.keys(customer.entitlements || {}))
    
    // Mark customer as suspended
    customer.suspended = true
    customer.suspensionInfo = {
      ...suspensionInfo,
      suspendedAt: new Date().toISOString()
    }
    
    // Move entitlements to suspended state
    if (customer.entitlements && Object.keys(customer.entitlements).length > 0) {
      customer.suspendedEntitlements = customer.entitlements
      customer.entitlements = {}
      console.log(`🔒 SUSPENDING: Moved ${Object.keys(customer.suspendedEntitlements).length} entitlements to suspended state`)
    } else {
      console.log(`🔒 SUSPENDING: No entitlements to suspend (already empty)`)
    }
    
    customer.updatedAt = new Date().toISOString()
    await writeData(data)
    
    console.log(`🔒 SUSPENDING: Customer ${customerId} suspended successfully`)
    return true
    
  } catch (error) {
    console.error('🚨 SUSPENDING: Error suspending customer entitlements:', error)
    throw error
  }
}

export async function restoreCustomerEntitlements(customerId) {
  try {
    console.log(`🔓 RESTORING: Starting restoration for customer ${customerId}`)
    
    const data = await readData()
    
    if (!data.customers[customerId]) {
      console.warn(`⚠️ RESTORING: Customer ${customerId} not found for restoration`)
      return false
    }
    
    const customer = data.customers[customerId]
    
    if (!customer.suspended) {
      console.log(`✅ RESTORING: Customer ${customerId} is not suspended - nothing to restore`)
      return true
    }
    
    // Restore entitlements from suspended state
    if (customer.suspendedEntitlements && Object.keys(customer.suspendedEntitlements).length > 0) {
      customer.entitlements = customer.suspendedEntitlements
      customer.suspendedEntitlements = {}
      console.log(`🔓 RESTORING: Restored ${Object.keys(customer.entitlements).length} entitlements`)
    }
    
    // Clear suspension
    customer.suspended = false
    customer.suspensionInfo = null
    customer.updatedAt = new Date().toISOString()
    
    await writeData(data)
    
    console.log(`🔓 RESTORING: Customer ${customerId} restored successfully`)
    return true
    
  } catch (error) {
    console.error('🚨 RESTORING: Error restoring customer entitlements:', error)
    throw error
  }
}

// ===== UTILITY FUNCTIONS =====

export async function getAllData() {
  return await readData()
}

export async function getAllCustomers() {
  const data = await readData()
  return data.customers || {}
}

// Get customer with clean entitlements format
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
