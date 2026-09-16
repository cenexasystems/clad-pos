const fs = require('fs')
const path = require('path')

for (const line of fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
}

const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) throw new Error('Missing Supabase URL or service-role key in .env')

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function request(table, method, query) {
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, { method, headers })
  const body = await response.text()
  if (!response.ok) throw new Error(`${table}: ${response.status} ${body}`)
  return body ? JSON.parse(body) : []
}

async function run() {
  const products = await request(
    'products',
    'GET',
    'select=id,name,category,category_id,is_active&name=ilike.pant&category=eq.Tailoring&is_active=is.false'
  )
  if (products.length !== 1) {
    throw new Error(`Expected exactly one inactive Pant in Tailoring; found ${products.length}. No data changed.`)
  }

  const productId = products[0].id
  await request('barcode_registry', 'DELETE', `product_id=eq.${productId}`)
  await request('product_variants', 'DELETE', `product_id=eq.${productId}`)
  const deleted = await request('products', 'DELETE', `id=eq.${productId}`)

  if (deleted.length !== 1) throw new Error('Product deletion did not affect exactly one row.')
  console.log(`Purged inactive product ${productId} (${products[0].name}, ${products[0].category}).`)
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
