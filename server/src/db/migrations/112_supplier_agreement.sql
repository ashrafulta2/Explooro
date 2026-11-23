-- 112_supplier_agreement.sql — a fifth legal document: the supplier agreement, which every account
-- holding the `supplier` role must agree to (server/src/config/legal.ts acceptedBy ['supplier']).
--
-- WHY a new doc_key and not a part of the partner agreement: suppliers and partners agree to
-- different things (a supplier owns the stock, sets the supplier price and pays for its own faults;
-- a partner keeps no stock), and each must be asked again only when its own agreement changes.
--
-- The inline CHECK of migration 104 was created unnamed, so Postgres named it
-- legal_documents_doc_key_check. It is replaced, not loosened to free text: a typo in a doc_key
-- would publish a document nobody is ever asked to agree to.
--
-- Version 1 is plain text with no figures: the markup, flash sale limits, return charges and the
-- withdrawal minimum are platform settings, shown where the supplier meets them. The fuller
-- fill-in template is docs/legal-templates/supplier-agreement.md; publish it as version 2 at
-- /admin/platform/legal once a lawyer has reviewed it.

-- WHY a loop and not only DROP ... IF EXISTS by name: if the CHECK ever got another name, a silent
-- no-op would leave the old list in force beside the new one and the INSERT below would fail.
DO $do$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'legal_documents'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%doc_key%'
  LOOP
    EXECUTE format('ALTER TABLE legal_documents DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$do$;
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_doc_key_check
  CHECK (doc_key IN ('terms', 'privacy', 'refund', 'partner_agreement', 'supplier_agreement'));

INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
VALUES (
  'supplier_agreement', 1,
  'Explooro Supplier Agreement',
  'Explooro সরবরাহকারী চুক্তি',
  $en$This agreement is between you, the business selling products on Explooro ("you", "supplier"), and {{company.legal_name}} ("Explooro", "we"). It adds to our Terms of Use, Privacy Policy and Refund & Return Policy, which also apply to you.

## 1. Becoming a supplier
- You must be a business, or a person aged 18 or over, based in Bangladesh and legally allowed to sell the products you list.
- Before you can sell or withdraw money, you must give us the true identity and business documents your supplier account asks for, and keep them up to date.
- We may accept or refuse an application, and may ask for more documents at any time.

## 2. What you are responsible for
- **The product:** you own it, keep it in stock, and are responsible for its quality, safety, legality, labelling, expiry date and warranty.
- **The listing:** the title, description, photos, variants and stock you upload must be true and kept up to date. You must have the right to use every photo and brand name you upload.
- **Packing and sending:** you pack each order safely and send it without delay, the way your shipments page shows.
- **Returns and warranty:** you accept returns and warranty claims as the Refund & Return Policy and your product's warranty describe.

## 3. What Explooro does
- Runs the platform, shows your products to customers, and lets Explooro partners recommend them.
- Takes the customer's payment and holds it safely until the order is delivered and the return window has passed, then pays your share into your Explooro Vault.
- Handles customer support, returns and disputes, and may ask you for information to settle them.
- May check, hide or remove a listing that breaks the law or our rules.

## 4. Prices
- You set your **supplier price** for each product. Explooro adds its markup to work out the retail price customers see; the product form shows it before you save. Explooro partners cannot change it.
- You also set the reward offered to Explooro partners for each product, within the limits the product form shows.
- Prices must include VAT where it applies. You may not charge a customer anything beyond what Explooro shows them.
- You must not raise a price just before a sale to make a discount look bigger.

## 5. Flash sales
- You may run flash sales on your own products from your supplier account, within the limits shown there.
- **You pay the discount of a flash sale you create:** your share of each sale goes down by the discount. Flash sales and coupons Explooro creates itself are paid by Explooro.

## 6. How and when you are paid
- For each delivered order, your share is shown on the order in your account.
- It is released into your Explooro Vault after the order is delivered and the customer's return window has passed without a return.
- You can withdraw your Vault balance to a bKash, Nagad or bank account in your business's or your own name. The minimum amount, any fee and how long it takes are shown on the withdrawal page before you confirm.

## 7. Returns, refunds and warranty
- When a return is approved because the product was damaged, wrong, faulty, expired or not as described, **you pay** the customer's refund and the cost of sending it back, as the Refund & Return Policy describes.
- When a customer returns a product because they changed their mind, the customer pays to send it back and the product comes back to you.
- Accept returned products at your return address and tell us at once of any problem with them.
- If your Vault cannot cover an amount you owe, it is recovered from your future sales.

## 8. Cancellations and late orders
If you cannot fill an order, cancel it at once from your account; the customer is refunded in full. If you often cancel, send late or send wrong products, we may lower your products in search, pause your listings, or end this agreement.

## 9. Products you must not sell
Anything illegal in Bangladesh, fake or copied brands, stolen goods, weapons, drugs, tobacco and alcohol, adult content, medicines that need a prescription, and food, cosmetics or medical items without the licences and labels the law requires or past their expiry date.

## 10. Customers' information
You receive a customer's name, phone number and address only to send their order. Do not use it for anything else, do not copy, sell or share it, and do not contact customers to sell to them outside Explooro.

## 11. Selling outside Explooro
Do not ask a customer who found you on Explooro to pay or order outside Explooro, or put your own phone number, page or website in a listing, parcel or message for that purpose.

## 12. Your content and our name
You allow Explooro, free of charge, to show and adapt your product photos and descriptions on the platform and in our promotion of your products and of Explooro. You may say that you sell on Explooro, but you may not use the Explooro name or logo in any other way without our written permission.

## 13. Tax
You are responsible for your own VAT, income tax and business records. Where the law requires us to deduct tax at source from what we pay you, we will deduct it and show it in your Vault statement.

## 14. Your status and responsibility
- You are an independent business, not an employee, agent or partner of Explooro, and cannot make promises on Explooro's behalf.
- You are responsible for any claim, fine or loss caused by your products, your listings, or your breaking this agreement or the law.
- As far as the law allows, Explooro is not liable for lost sales or profit caused by the platform being unavailable, or by a courier or payment company.

## 15. Ending the agreement
You can stop selling at any time after filling every open order. We may end the agreement with reasonable notice, or at once if you break it or the law. Money that is yours in your Vault is paid out once every open order, return and warranty claim is settled, less anything you owe.

## 16. Changes
When we change this agreement in a way that matters, we will ask you to read and agree to the new version before you continue selling.

## 17. Law and disputes
This agreement is governed by the laws of Bangladesh. Please contact us first so we can try to solve any problem. If we cannot, the courts of Dhaka will decide.

## 18. Contact
{{company.legal_name}}, {{company.address}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}$en$,
  $bn$এই চুক্তি Explooro-তে পণ্য বিক্রি করা ব্যবসা ("আপনি", "সরবরাহকারী") এবং {{company.legal_name}} ("Explooro", "আমরা")-এর মধ্যে। এটা আমাদের ব্যবহারের শর্তাবলি, গোপনীয়তা নীতি এবং রিফান্ড ও রিটার্ন নীতির সাথে যুক্ত, যেগুলো আপনার ক্ষেত্রেও প্রযোজ্য।

## ১. সরবরাহকারী হওয়া
- আপনাকে বাংলাদেশভিত্তিক একটি ব্যবসা, বা ১৮ বছর বা তার বেশি বয়সী একজন মানুষ হতে হবে, যিনি তালিকাভুক্ত পণ্য আইনসঙ্গতভাবে বিক্রি করতে পারেন।
- বিক্রি করার বা টাকা তোলার আগে আপনার সরবরাহকারী অ্যাকাউন্ট যে পরিচয় ও ব্যবসার কাগজপত্র চায় তা সত্যভাবে দিতে হবে এবং হালনাগাদ রাখতে হবে।
- আমরা আবেদন গ্রহণ বা বাতিল করতে পারি, এবং যেকোনো সময় আরও কাগজপত্র চাইতে পারি।

## ২. আপনার দায়িত্ব
- **পণ্য:** আপনি এর মালিক, স্টকে রাখেন, এবং এর মান, নিরাপত্তা, বৈধতা, লেবেল, মেয়াদ ও ওয়ারেন্টির দায় আপনার।
- **লিস্টিং:** আপনার আপলোড করা নাম, বর্ণনা, ছবি, ভ্যারিয়েন্ট ও স্টক সত্য ও হালনাগাদ রাখতে হবে। আপলোড করা প্রতিটি ছবি ও ব্র্যান্ডের নাম ব্যবহারের অধিকার আপনার থাকতে হবে।
- **প্যাক করা ও পাঠানো:** প্রতিটি অর্ডার নিরাপদে প্যাক করে দেরি না করে পাঠাবেন, আপনার শিপমেন্ট পেজে যেভাবে দেখানো আছে।
- **রিটার্ন ও ওয়ারেন্টি:** রিফান্ড ও রিটার্ন নীতি এবং আপনার পণ্যের ওয়ারেন্টিতে যেমন বলা আছে, সেই অনুযায়ী রিটার্ন ও ওয়ারেন্টি দাবি মেনে নেবেন।

## ৩. Explooro কী করে
- প্ল্যাটফর্ম চালায়, ক্রেতাদের আপনার পণ্য দেখায়, এবং Explooro শপ পার্টনারদের সেগুলোর সুপারিশ করতে দেয়।
- ক্রেতার টাকা নেয় এবং অর্ডার ডেলিভারি হয়ে রিটার্নের সময় পার না হওয়া পর্যন্ত নিরাপদে জমা রাখে, তারপর আপনার অংশ আপনার Explooro ভল্টে দেয়।
- ক্রেতার সাপোর্ট, রিটার্ন ও বিরোধ সামলায়, এবং তা মেটাতে আপনার কাছে তথ্য চাইতে পারে।
- আইন বা আমাদের নিয়ম ভাঙে এমন লিস্টিং যাচাই করতে, লুকাতে বা সরাতে পারে।

## ৪. দাম
- প্রতিটি পণ্যের **সরবরাহকারীর দাম** আপনি ঠিক করেন। Explooro তার সাথে নিজের মার্কআপ যোগ করে ক্রেতাদের দেখানো খুচরা দাম ঠিক করে; সেভ করার আগে পণ্যের ফর্মে তা দেখা যায়। Explooro শপ পার্টনাররা তা বদলাতে পারেন না।
- প্রতিটি পণ্যের জন্য Explooro শপ পার্টনারদের পুরস্কারও আপনি ঠিক করেন, পণ্যের ফর্মে দেখানো সীমার মধ্যে।
- প্রযোজ্য ক্ষেত্রে দাম ভ্যাটসহ হতে হবে। Explooro ক্রেতাকে যা দেখায় তার বাইরে আপনি ক্রেতার কাছে কিছু চাইতে পারবেন না।
- ছাড় বড় দেখাতে সেলের ঠিক আগে দাম বাড়ানো যাবে না।

## ৫. ফ্ল্যাশ সেল
- আপনার সরবরাহকারী অ্যাকাউন্ট থেকে সেখানে দেখানো সীমার মধ্যে নিজের পণ্যে ফ্ল্যাশ সেল চালাতে পারেন।
- **আপনার তৈরি ফ্ল্যাশ সেলের ছাড় আপনি দেন:** প্রতিটি বিক্রিতে আপনার অংশ ছাড়ের পরিমাণে কমে। Explooro নিজে যেসব ফ্ল্যাশ সেল ও কুপন তৈরি করে তার খরচ Explooro দেয়।

## ৬. কীভাবে ও কখন টাকা পান
- প্রতিটি ডেলিভারি হওয়া অর্ডারে আপনার অংশ আপনার অ্যাকাউন্টে অর্ডারের পাশে দেখা যায়।
- অর্ডার ডেলিভারি হয়ে ক্রেতার রিটার্নের সময় কোনো রিটার্ন ছাড়া পার হলে তা আপনার Explooro ভল্টে আসে।
- ভল্টের ব্যালেন্স আপনার ব্যবসার বা আপনার নিজের নামে থাকা বিকাশ, নগদ বা ব্যাংক অ্যাকাউন্টে তুলতে পারেন। সর্বনিম্ন পরিমাণ, কোনো চার্জ থাকলে তা, এবং কতদিন লাগবে, নিশ্চিত করার আগে টাকা তোলার পেজে দেখানো হয়।

## ৭. রিটার্ন, রিফান্ড ও ওয়ারেন্টি
- পণ্য ভাঙা, ভুল, ত্রুটিপূর্ণ, মেয়াদোত্তীর্ণ বা বর্ণনার সাথে না মেলায় রিটার্ন অনুমোদন হলে, রিফান্ড ও রিটার্ন নীতি অনুযায়ী ক্রেতার রিফান্ড ও ফেরত পাঠানোর খরচ **আপনি দেন**।
- ক্রেতা মত বদলে পণ্য ফেরত দিলে ফেরত পাঠানোর খরচ ক্রেতা দেন, এবং পণ্যটি আপনার কাছে ফিরে আসে।
- ফেরত আসা পণ্য আপনার রিটার্নের ঠিকানায় গ্রহণ করুন এবং কোনো সমস্যা থাকলে সঙ্গে সঙ্গে আমাদের জানান।
- আপনার পাওনা কোনো টাকা ভল্টে না থাকলে তা আপনার ভবিষ্যৎ বিক্রি থেকে আদায় করা হয়।

## ৮. বাতিল ও দেরির অর্ডার
কোনো অর্ডার পূরণ করতে না পারলে সঙ্গে সঙ্গে অ্যাকাউন্ট থেকে বাতিল করুন; ক্রেতা পুরো টাকা ফেরত পান। বারবার বাতিল করলে, দেরিতে পাঠালে বা ভুল পণ্য পাঠালে আমরা সার্চে আপনার পণ্য নিচে নামাতে, লিস্টিং বন্ধ রাখতে বা এই চুক্তি শেষ করতে পারি।

## ৯. যেসব পণ্য বিক্রি করা যাবে না
বাংলাদেশে বেআইনি যেকোনো কিছু, নকল ব্র্যান্ড, চুরি করা পণ্য, অস্ত্র, মাদক, তামাক ও মদ, প্রাপ্তবয়স্কদের কনটেন্ট, প্রেসক্রিপশন লাগে এমন ওষুধ, এবং আইন যে লাইসেন্স ও লেবেল চায় তা ছাড়া বা মেয়াদ পার হওয়া খাবার, প্রসাধনী ও চিকিৎসা সামগ্রী।

## ১০. ক্রেতাদের তথ্য
ক্রেতার নাম, ফোন নম্বর ও ঠিকানা আপনি পান শুধু তাঁর অর্ডার পাঠাতে। অন্য কোনো কাজে ব্যবহার করবেন না, কপি, বিক্রি বা শেয়ার করবেন না, এবং Explooro-র বাইরে বিক্রির জন্য ক্রেতার সাথে যোগাযোগ করবেন না।

## ১১. Explooro-র বাইরে বিক্রি
Explooro-তে আপনাকে খুঁজে পাওয়া কোনো ক্রেতাকে Explooro-র বাইরে টাকা দিতে বা অর্ডার করতে বলবেন না, বা সেই উদ্দেশ্যে লিস্টিং, পার্সেল বা মেসেজে নিজের ফোন নম্বর, পেজ বা ওয়েবসাইট দেবেন না।

## ১২. আপনার কনটেন্ট ও আমাদের নাম
আপনি Explooro-কে বিনা মূল্যে আপনার পণ্যের ছবি ও বর্ণনা প্ল্যাটফর্মে এবং আপনার পণ্য ও Explooro-র প্রচারে দেখানো ও প্রয়োজনমতো সাজানোর অনুমতি দিচ্ছেন। আপনি Explooro-তে বিক্রি করেন বলতে পারেন, তবে আমাদের লিখিত অনুমতি ছাড়া Explooro নাম বা লোগো অন্য কোনোভাবে ব্যবহার করতে পারবেন না।

## ১৩. কর
আপনার নিজের ভ্যাট, আয়কর ও ব্যবসার হিসাবের দায় আপনার। আইন যেখানে আপনাকে দেওয়া টাকা থেকে উৎসে কর কাটতে বলে, সেখানে আমরা তা কেটে আপনার ভল্টের বিবরণীতে দেখাব।

## ১৪. আপনার অবস্থান ও দায়
- আপনি একটি স্বাধীন ব্যবসা, Explooro-র কর্মী, এজেন্ট বা অংশীদার নন, এবং Explooro-র হয়ে কোনো প্রতিশ্রুতি দিতে পারেন না।
- আপনার পণ্য, লিস্টিং, বা এই চুক্তি বা আইন ভাঙার কারণে হওয়া যেকোনো দাবি, জরিমানা বা ক্ষতির দায় আপনার।
- আইন যতটা অনুমতি দেয়, প্ল্যাটফর্ম বন্ধ থাকা বা কোনো কুরিয়ার বা পেমেন্ট কোম্পানির কারণে হারানো বিক্রি বা লাভের জন্য Explooro দায়ী নয়।

## ১৫. চুক্তি শেষ করা
সব চলমান অর্ডার পূরণ করে আপনি যেকোনো সময় বিক্রি বন্ধ করতে পারেন। আমরা যুক্তিসঙ্গত নোটিশ দিয়ে, অথবা আপনি এই চুক্তি বা আইন ভাঙলে সঙ্গে সঙ্গে চুক্তি শেষ করতে পারি। সব চলমান অর্ডার, রিটার্ন ও ওয়ারেন্টি দাবি মিটে গেলে, আপনার পাওনা বাদ দিয়ে, ভল্টে আপনার টাকা আপনাকে দেওয়া হয়।

## ১৬. পরিবর্তন
এই চুক্তিতে গুরুত্বপূর্ণ পরিবর্তন হলে বিক্রি চালিয়ে যাওয়ার আগে আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব।

## ১৭. আইন ও বিরোধ
এই চুক্তি বাংলাদেশের আইন দ্বারা পরিচালিত। কোনো সমস্যা হলে আগে আমাদের সাথে যোগাযোগ করুন, যাতে আমরা তা সমাধানের চেষ্টা করতে পারি। না পারলে ঢাকার আদালত নিষ্পত্তি করবে।

## ১৮. যোগাযোগ
{{company.legal_name}}, {{company.address}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}$bn$,
  'First version.', 'প্রথম সংস্করণ।', true
)
ON CONFLICT (doc_key, version) DO NOTHING;
