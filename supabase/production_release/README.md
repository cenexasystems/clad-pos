# Production release: new Supabase migrations

This folder holds every database change made after migration 0027, ready for the MAIN Supabase.

## Easiest: one file
1. Open the main Supabase project, then **SQL Editor, New query**.
2. Paste the whole of `RUN_ALL_IN_ONE.sql` and press **Run**.
3. It is safe to run twice. If it says "Success", you are done.

## Or one by one
Run these files, in this order, the same way:

| Date-No. | File | What it adds |
|---|---|---|
| 261102-0028 | `20261102_0028_clad_barcode_format.sql` | Barcode codes part 1 (other developer): 8-digit item codes. Part 2 replaces it, so it is safe even if already applied |
| 261102-0029 | `20261102_0029_clad_item_code_format.sql` | Barcode codes part 2 (other developer): generated item codes are CLAD + 7 digits |
| 261111-0028 | `20261111_0028_customer_birthdays.sql` | Birthdays tab: customer birthdays, offers, message template |
| 261111-0029 | `20261111_0029_coupon_whatsapp_sharing.sql` | Coupons on WhatsApp: coupon image + send log |
| 261112-0030 | `20261112_0030_update_order_with_stock.sql` | Edit bills in Order History (stock stays correct) |
| 261113-0031 | `20261113_0031_product_images_bucket.sql` | product-images storage bucket (product + coupon pictures) |
| 261113-0032 | `20261113_0032_orders_optional_remarks.sql` | Blank remarks / reference number no longer break a sale |
| 261114-0033 | `20261114_0033_order_returns.sql` | Returns and refunds, return invoices |
| 261115-0034 | `20261115_0034_shop_settings.sql` | Settings page: shop profile, theme colour, passwords |
| 261116-0035 | `20261116_0035_order_exchange.sql` | Exchange: credit note + new bill in one step |

## Notes
- Production must already have migrations 0001 to 0027 (the files in `../migrations`).
- Do not run migrations 0001 to 0027 again: some of them change the shop name and address.
- The two `20261102` barcode files came from the other developer. If production already has them, running them again is harmless.
- The staging Supabase was built from all migrations and these files were tested on it.
- After running, open **Settings** in the app and press **Save shop profile** once, so the saved shop details are used.
