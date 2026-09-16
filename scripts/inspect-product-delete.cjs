const path = require('path')
const fs = require('fs')

for (const line of fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}

const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  throw new Error('Missing Supabase URL, anon key, or service-role key in .env')
}

async function select(key, table, query) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${table}: ${response.status} ${body}`)
  return JSON.parse(body)
}

async function inspect(role, key) {
  const products = await select(key, 'products', 'select=id,name,category,category_id,is_active,created_at&name=ilike.pant')
  const productIds = products.map((product) => product.id)
  const idFilter = productIds.length ? `in.(${productIds.join(',')})` : 'in.(-1)'
  const [variants, barcodes, movements] = await Promise.all([
    select(key, 'product_variants', `select=id,product_id,is_active&product_id=${idFilter}`),
    select(key, 'barcode_registry', `select=id,product_id,variant_id,is_active&product_id=${idFilter}`),
    select(key, 'inventory_movements', `select=id,product_id,variant_id&product_id=${idFilter}`),
  ])
  console.log(JSON.stringify({ role, products, variants, barcodes, movements }, null, 2))
}

Promise.all([inspect('anon', anonKey), inspect('service_role', serviceKey)]).catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
