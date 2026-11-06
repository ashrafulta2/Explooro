-- 106_return_shipping_cost.sql
--
-- Who pays to send a returned product back (owner decision 2026-11-06: "do it the way Daraz does").
--
--   * The supplier's fault (damaged, wrong item, defective, not as described): the customer pays
--     nothing. The delivery charge comes back with a whole-parcel refund (as before), a courier
--     pickup is free, and a customer who sent it back by hand is repaid the courier receipt up to
--     a limit. The supplier pays these, as the one at fault.
--   * The customer's choice (changed mind, size, other): the customer pays. The delivery charge is
--     not refunded (the supplier already paid the courier to deliver), and a courier pickup costs a
--     fixed fee taken from the refund.
-- Staff may switch the payer when approving a return (an "other" that turns out to be a defect).
-- One file decides and moves the money: server/src/services/returnShipping.service.ts.
--
-- 1. The rules. Configuration, set by a super admin at /admin/platform/operations
--    (platform.operations.update, CRITICAL). The amounts are Taka.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'returns.shipping_policy',
  '{"supplier_fault_reasons": ["DAMAGED", "WRONG_ITEM", "DEFECTIVE", "NOT_AS_DESCRIBED"], "max_courier_refund": 150, "pickup_fee": 100}'::jsonb,
  'OBJECT',
  'Who pays to send a return back',
  'ফেরত পাঠানোর খরচ কে দেবে',
  'operations',
  false
)
ON CONFLICT (key) DO NOTHING;

-- 2. Per return: the payer decided at approval, the courier receipt staff typed at inspection
--    (only for a hand-sent return the supplier pays for), and what the refund then moved.
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS return_shipping_paid_by TEXT
  CHECK (return_shipping_paid_by IN ('SUPPLIER', 'CUSTOMER'));
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS customer_courier_cost NUMERIC(14,2)
  CHECK (customer_courier_cost >= 0);
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS shipping_settlement_json JSONB;

-- 3. The refund policy says so. A new version, never an edit (migration 104's trigger refuses
--    edits). Not a re-acceptance: nobody agrees to the refund policy (server/src/config/legal.ts).
--    WHY max(version) + 1 and the NOT EXISTS: the owner may already have published a version 2 from
--    /admin/platform/legal, and a re-run must not add a second copy.
INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
SELECT
  'refund',
  (SELECT COALESCE(MAX(version), 0) + 1 FROM legal_documents WHERE doc_key = 'refund'),
  'Refund & Return Policy',
  'রিফান্ড ও রিটার্ন নীতি',
  $en$This policy explains when you can return a product, how refunds work, who pays to send a product back, and how warranty claims are handled on Explooro. It is part of our Terms of Use.

## 1. Your money is held safely until delivery
When you pay, Explooro holds the money. The supplier and the Explooro partner are paid only after your order is delivered and the return window has passed. That is how we can refund you if something goes wrong.

## 2. Returning a product
- You can ask for a return within **{{returns.window_days}} days** of delivery, from the order's page in your account.
- Tell us why (for example: damaged, wrong item, not as described, missing parts) and add photos if you can. Photos make the decision faster.
- Keep the product, its box, tags and everything that came with it, unused, until the return is decided.
- Food, personal care and hygiene items, underwear, and items made to your order can be returned only if they arrive damaged, wrong or not as described.

## 3. What happens next
- The supplier or our team reviews your request. If it is approved, we arrange a pickup or tell you where to send the product.
- When the product is back and checked, we refund you.
- If your request is not approved, we tell you why. You can ask our team to look at it again.

## 4. Who pays to send it back
- **If the problem is ours or the supplier's** (the product is damaged, wrong, faulty or not as described), you pay nothing. If we send a courier, the pickup is free. If you send it yourself, keep the courier's receipt: we repay it with your refund, up to **Tk {{returns.max_courier_refund}}**. If you return the whole parcel, its delivery charge is refunded too.
- **If you changed your mind** (including size or any other reason of your own), you pay to send it back. If you send it yourself, you pay the courier. If we send a courier, **Tk {{returns.pickup_fee}}** is taken from your refund. The delivery charge is not refunded.
- Our team decides which case applies when your return is approved, and your returns page shows it.

## 5. How you get your money back
- Refunds are paid into your **Explooro Vault** once the returned product has been checked. You can spend Vault money on your next order.
- If an order you already paid for is cancelled before delivery, the full amount goes back to your Vault straight away.
- If you return only some items in a parcel, you are refunded for those items.

## 6. Warranty
Some products come with a warranty card from the supplier, shown in your account. Within the warranty period you can claim a repair, a replacement or a refund. The supplier is responsible for the warranty; Explooro helps you make the claim and follows it up.

## 7. Cash on delivery
If you refuse a cash-on-delivery parcel without a good reason, or keep ordering and refusing, we may stop offering you cash on delivery.

## 8. Contact
For any problem with an order, use the help or chat in your account, or contact {{company.support_email}} · {{company.support_phone}}.$en$,
  $bn$Explooro-তে কখন পণ্য ফেরত দিতে পারবেন, টাকা কীভাবে ফেরত পান, পণ্য ফেরত পাঠানোর খরচ কে দেবে এবং ওয়ারেন্টি দাবি কীভাবে সামলানো হয়, এই নীতিতে তা বলা হয়েছে। এটা আমাদের ব্যবহারের শর্তাবলির অংশ।

## ১. ডেলিভারি পর্যন্ত আপনার টাকা নিরাপদে জমা থাকে
আপনি টাকা দিলে তা Explooro-র কাছে জমা থাকে। অর্ডার ডেলিভারি হয়ে রিটার্নের সময় পার হওয়ার পরই সরবরাহকারী ও শপ পার্টনার টাকা পান। এ কারণেই কিছু ভুল হলে আমরা আপনাকে টাকা ফেরত দিতে পারি।

## ২. পণ্য ফেরত দেওয়া
- ডেলিভারির **{{returns.window_days}} দিনের** মধ্যে আপনার অ্যাকাউন্টে অর্ডারের পেজ থেকে রিটার্নের অনুরোধ করতে পারেন।
- কারণ জানান (যেমন: ভাঙা, ভুল পণ্য, বর্ণনার সাথে মেলে না, কিছু অংশ নেই) এবং সম্ভব হলে ছবি দিন। ছবি থাকলে সিদ্ধান্ত দ্রুত হয়।
- সিদ্ধান্ত না হওয়া পর্যন্ত পণ্য, বাক্স, ট্যাগ ও সাথে আসা সবকিছু অব্যবহৃত অবস্থায় রাখুন।
- খাবার, ব্যক্তিগত পরিচর্যা ও স্বাস্থ্যবিধির পণ্য, অন্তর্বাস, এবং আপনার জন্য বিশেষভাবে বানানো পণ্য কেবল ভাঙা, ভুল বা বর্ণনার সাথে না মিললে ফেরত দেওয়া যায়।

## ৩. এরপর কী হয়
- সরবরাহকারী বা আমাদের টিম আপনার অনুরোধ দেখেন। অনুমোদন হলে আমরা পণ্য নিয়ে আসার ব্যবস্থা করি, বা কোথায় পাঠাতে হবে জানাই।
- পণ্য ফিরে এসে যাচাই হলে আমরা টাকা ফেরত দিই।
- অনুরোধ অনুমোদন না হলে আমরা কারণ জানাই। আপনি আমাদের টিমকে আবার দেখতে বলতে পারেন।

## ৪. ফেরত পাঠানোর খরচ কে দেবে
- **সমস্যা আমাদের বা সরবরাহকারীর হলে** (পণ্য ভাঙা, ভুল, ত্রুটিপূর্ণ বা বর্ণনার সাথে মেলে না), আপনাকে কিছু দিতে হবে না। আমরা কুরিয়ার পাঠালে পণ্য নিয়ে যাওয়া বিনা খরচে। নিজে পাঠালে কুরিয়ারের রসিদ রেখে দিন: রিফান্ডের সাথে আমরা সর্বোচ্চ **{{returns.max_courier_refund}} টাকা** পর্যন্ত তা ফেরত দেব। পুরো পার্সেল ফেরত দিলে তার ডেলিভারি চার্জও ফেরত পাবেন।
- **আপনি মত বদলালে** (সাইজ বা আপনার নিজের অন্য যেকোনো কারণসহ), ফেরত পাঠানোর খরচ আপনার। নিজে পাঠালে কুরিয়ারের খরচ আপনি দেবেন। আমরা কুরিয়ার পাঠালে রিফান্ড থেকে **{{returns.pickup_fee}} টাকা** কাটা হবে। ডেলিভারি চার্জ ফেরত হবে না।
- রিটার্ন অনুমোদনের সময় আমাদের টিম ঠিক করে কোনটি প্রযোজ্য, আর আপনার রিটার্নের পেজে তা দেখা যায়।

## ৫. টাকা কীভাবে ফেরত পান
- ফেরত আসা পণ্য যাচাই হলে ফেরত টাকা আপনার **Explooro ভল্টে** জমা হয়। ভল্টের টাকা পরের অর্ডারে খরচ করতে পারেন।
- আগে টাকা দেওয়া কোনো অর্ডার ডেলিভারির আগে বাতিল হলে পুরো টাকা সঙ্গে সঙ্গে আপনার ভল্টে ফেরত যায়।
- একটি পার্সেলের কয়েকটি পণ্য ফেরত দিলে সেই পণ্যগুলোর টাকা ফেরত পাবেন।

## ৬. ওয়ারেন্টি
কিছু পণ্যের সাথে সরবরাহকারীর দেওয়া ওয়ারেন্টি কার্ড থাকে, যা আপনার অ্যাকাউন্টে দেখা যায়। ওয়ারেন্টির সময়ের মধ্যে মেরামত, বদলে দেওয়া বা টাকা ফেরতের দাবি করতে পারেন। ওয়ারেন্টির দায় সরবরাহকারীর; Explooro আপনাকে দাবি করতে সাহায্য করে এবং খোঁজ রাখে।

## ৭. ক্যাশ অন ডেলিভারি
যথাযথ কারণ ছাড়া ক্যাশ অন ডেলিভারির পার্সেল ফিরিয়ে দিলে, বা বারবার অর্ডার করে ফিরিয়ে দিলে, আমরা আপনার জন্য ক্যাশ অন ডেলিভারি বন্ধ করতে পারি।

## ৮. যোগাযোগ
অর্ডারে কোনো সমস্যা হলে আপনার অ্যাকাউন্টের হেল্প বা চ্যাট ব্যবহার করুন, অথবা {{company.support_email}} · {{company.support_phone}}-এ যোগাযোগ করুন।$bn$,
  'Says who pays to send a return back: nothing when the product was faulty or wrong, the customer when they changed their mind.',
  'ফেরত পাঠানোর খরচ কে দেবে তা যোগ হলো: পণ্য ত্রুটিপূর্ণ বা ভুল হলে কিছু লাগবে না, ক্রেতা মত বদলালে খরচ ক্রেতার।',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM legal_documents WHERE doc_key = 'refund' AND body_en LIKE '%{{returns.pickup_fee}}%'
);
