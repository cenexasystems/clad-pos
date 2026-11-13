# Production release: new Supabase migrations

This folder holds every database change made after migration 0027, ready for the MAIN Supabase.

## Easiest: one file
1. Open the main Supabase project, then **SQL Editor, New query**.
2. Paste the whole of `RUN_ALL_IN_ONE.sql` and press **Run**.
3. It is safe to run twice. If it says "Success", you are done.

## Or one by one
Run these files, in this order, the same way:

| # | File | What it adds |
|---|------|--------------|
| 0028 | `20261111_0028_customer_birthdays.sql` | Birthdays tab: customer birthdays, offers, message template |
| 0029 | `20261111_0029_coupon_whatsapp_sharing.sql` | Coupons on WhatsApp: coupon image + send log |
| 0030 | `20261112_0030_update_order_with_stock.sql` | Edit bills in Order History (stock stays correct) |
| 0031 | `20261113_0031_product_images_bucket.sql` | product-images storage bucket (product + coupon pictures) |
| 0032 | `20261113_0032_orders_optional_remarks.sql` | Blank remarks / reference number no longer break a sale |
| 0033 | `20261114_0033_order_returns.sql` | Returns and refunds, return invoices |
| 0034 | `20261115_0034_shop_settings.sql` | Settings page: shop profile, theme colour, passwords |

## Notes
- Production must already have migrations 0001 to 0027 (the files in `../migrations`).
- Do not run migrations 0001 to 0027 again: some of them change the shop name and address.
- The staging Supabase was built from all migrations and these files were tested on it.
- After running, open **Settings** in the app and press **Save shop profile** once, so the saved shop details are used.
