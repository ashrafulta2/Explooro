-- 113_legal_full_bangladesh.sql — the full Bangladesh version of all five legal documents, and the
-- business details they name.
--
-- 1. legal.company gains the details docs/legal-templates marked [[FILL]]: business type, DBID,
--    e-TIN/BIN, support hours, privacy and partner/supplier contacts, service providers, where data
--    is stored, supplier documents, the courts' city, and the time limits the documents promise.
--    Each is read into the text through a {{company.<field>}} token (legal.service.ts
--    COMPANY_FIELDS), so the owner edits them at /admin/platform/legal at any time without
--    publishing a version or asking anyone to agree again. Existing values win; a key already set
--    is never overwritten.
--    WHY the time limits get starting values and the rest stay empty: a missing number would read
--    "within — days", so each starts at the figure docs/legal-templates suggested and the owner
--    confirms it; the names, numbers and lists only the owner knows stay empty, and the admin page
--    warns about each until it is filled.
--
-- 2. Version 2 of every document, generated from docs/legal-templates with every [[FILL]] turned
--    into a token, every [[CHOOSE]] set to what the platform does today (customers spend the Vault
--    on Explooro; refunds go to the Vault; no arbitration clause; no advertising cookies; partners
--    advertise only through Explooro's ad tools; supplier parcels go the way the shipments page
--    shows), and every [[LAWYER]] note left out of the text. The lawyer's points are listed on the
--    admin page instead (admin.legal.review.*).
--    Inserted as the next version after whatever exists, once: a document that already has a
--    version with this change note is skipped, so a database where the owner published their own
--    version 2 keeps it and gets this one on top only if it was never added.
--    WHY requires_reacceptance: what people agree to has changed. The refund policy is signed by
--    nobody, so it does not ask.

UPDATE platform_settings
   SET value_json = '{"business_type_en": "", "business_type_bn": "", "dbid": "", "tax_ids": "", "support_hours_en": "", "support_hours_bn": "", "privacy_email": "", "partner_support": "", "supplier_support": "", "service_providers_en": "", "service_providers_bn": "", "data_location_en": "", "data_location_bn": "", "supplier_documents_en": "", "supplier_documents_bn": "", "court_city_en": "", "court_city_bn": "", "complaint_reply_days": "2", "complaint_resolve_days": "7", "return_review_days": "2", "return_check_days": "3", "return_appeal_days": "3", "refund_days": "7", "not_received_days": "2", "privacy_reply_days": "30", "records_years": "", "id_docs_years": "", "partner_explain_days": "7", "reward_claim_days": "30", "notice_days": "15", "supplier_dispatch_days": "2", "supplier_details_days": "7", "supplier_return_check_days": "3"}'::jsonb || value_json
 WHERE key = 'legal.company';

INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
SELECT 'terms', COALESCE(MAX(version), 0) + 1,
  'Terms of Use',
  'ব্যবহারের শর্তাবলি',
  $en$These Terms of Use ("terms") are an agreement between you and {{company.legal_name}} ("Explooro", "we", "us"), a {{company.business_type}} registered in Bangladesh, which runs the Explooro website and mobile app (together, "the platform"). By creating an account, browsing as a signed-in user or placing an order, you agree to these terms, our Privacy Policy and our Refund & Return Policy. If you do not agree, please do not use Explooro.

## 1. Who we are
- Registered name: {{company.legal_name}}
- Registered address: {{company.address}}
- Trade licence: {{company.trade_license}}
- Digital Business Identity (DBID): {{company.dbid}}
- e-TIN / BIN (VAT): {{company.tax_ids}}

## 2. Who can use Explooro
- You must be at least 18 years old, or use Explooro with a parent or guardian who agrees to these terms for you.
- One person, one account. The details you give us (name, mobile number, addresses) must be true, current and your own.
- You are responsible for everything done from your account. Keep your password and the codes we send you private, and tell us at once if you think someone else has used your account.
- Businesses that sell on Explooro (suppliers) and Explooro partners also agree to their own agreement, which adds to these terms.

## 3. How Explooro works
- **Suppliers** own and keep the products, are responsible for them, and pack and send your parcel.
- **Explooro partners** recommend products through their Explooro shop and links. They do not keep stock and do not set prices.
- **Explooro** runs the platform, shows prices, takes your payment and holds it safely until your order is delivered and the return window has passed. Only then are the supplier and the partner paid.
- Unless a product page says it is sold by Explooro itself, the contract of sale for a product is between you and its supplier. Explooro acts as the marketplace that arranges and protects that sale.

## 4. Products and information
- Suppliers write product descriptions and upload photos. We check listings, but colours on screen, sizes and small details can differ slightly from the real product.
- If a product is clearly not as described, you can return it under the Refund & Return Policy.
- We may remove any product or listing that breaks the law or our rules.

## 5. Prices and orders
- Prices are in Bangladeshi Taka (BDT) and include VAT where it applies. The delivery charge is shown separately at checkout before you confirm, and depends on your delivery district.
- An order is placed when you see the order confirmation. It is a request to buy; the supplier accepts it by preparing it for dispatch.
- A supplier or Explooro may cancel an order that cannot be filled, for example when the item is out of stock, the price was shown wrongly by an obvious mistake, or the order looks fraudulent. We will tell you why. If you already paid, the full amount goes back to your Explooro Vault.
- You may cancel an order from your account until it has been handed to the courier.
- We may limit how many of an item one person can buy, especially in flash sales and team purchases.

## 6. Offers, coupons and team purchases
- Each coupon, flash sale and team purchase has its own conditions, shown where you use it. A coupon cannot be exchanged for cash.
- A team purchase only goes ahead if enough people join in time. If it does not, the money you paid is returned to your Vault.
- If an order that used an offer is returned or cancelled, the offer is not given back as cash.

## 7. Paying
- You can pay by cash on delivery or from your Explooro Vault. Online methods (bKash, Nagad, Rocket, cards) are offered only when they appear at checkout.
- For cash on delivery we may ask you to confirm the order with a code sent to your phone, or ask for a small advance, to stop fake orders.
- Online payments are handled by the payment company you choose. We never see or store your card number or PIN.

## 8. Your Explooro Vault
- Your **Explooro Vault** is your balance on Explooro. Refunds, money you add, and any earnings you are entitled to go there.
- Customers can spend Vault money on orders and ads. Explooro partners and suppliers can also withdraw it as their own agreement describes.
- Vault money does not earn interest and is not a bank account. As a customer, you spend Vault money on Explooro.

## 9. Delivery
- We show an expected delivery time at checkout. It is an estimate: weather, holidays, strikes and courier delays can change it.
- The risk of loss passes to you when the parcel is delivered to you or someone you name.
- Please check the parcel in front of the delivery person when you can. If something is wrong, follow the Refund & Return Policy.

## 10. Returns, refunds and warranty
Returns, refunds and warranty claims follow our Refund & Return Policy, which is part of these terms.

## 11. Reviews, posts and other content you add
- You own the reviews, community posts, photos and chat messages you add ("your content"). You allow Explooro, free of charge, to show, store and adapt them on the platform and in our own promotion of Explooro.
- Your content must be honest and your own. It must not be illegal, hateful, threatening, sexually explicit, misleading, or belong to someone else.
- We may remove content that breaks these rules. You can delete your own posts; copies already shared may take a while to disappear.

## 12. What you must not do
- Place fake orders, refuse parcels on purpose, or use someone else's details or payment method.
- Create several accounts to collect rewards, referral earnings or coupons more than once.
- Post fake reviews, or pay or ask anyone to write them.
- Copy, scrape or resell the platform's content or data, or use bots to place orders or collect offers.
- Try to break, overload or get around the security of the platform.
- Use Explooro for anything illegal under the law of Bangladesh.

If you do, we may cancel orders, take back rewards, coupons or earnings gained that way, and limit, suspend or close your account. Where the law requires it, we may report it to the authorities.

## 13. Our name and content
The Explooro name, logo and the design and software of the platform belong to {{company.legal_name}}. You may not use them without our written permission, except to share links to Explooro pages.

## 14. Our responsibility
- We work hard to keep Explooro running and its information correct, but we cannot promise it will always be available, without delay, or free of mistakes.
- The supplier is responsible for the product itself: its quality, safety, legality, description and warranty. Explooro is responsible for running the platform and handling your money as these terms describe.
- As far as the law allows, we are not liable for indirect or consequential losses, such as lost profit or lost opportunity, and our total liability for an order is limited to the amount you paid for it.
- Nothing in these terms removes rights you have under the Consumer Rights Protection Act, 2009 or any other law of Bangladesh.

## 15. Events outside our control
We are not responsible for delays or failures caused by events we cannot reasonably control, such as natural disasters, floods, strikes, hartals, government orders, internet or power failures, or a failure of a bank, payment company or courier.

## 16. Closing an account
You can ask us to close your account at any time. We may suspend or close an account that breaks these terms or the law. Money that is yours in your Vault stays yours, except amounts gained by breaking these terms; we will return it once any open order, return or dispute is settled.

## 17. Changes to these terms
We may change these terms. When a change matters, we will ask you to read and agree to the new version the next time you use Explooro. Each version shows its number and the date it took effect. Smaller changes, such as fixing a typo or a new address, take effect when they are published.

## 18. Law and disputes
- These terms are governed by the laws of Bangladesh.
- Please contact us first so we can try to solve any problem. We aim to reply within {{company.complaint_reply_days}} working days and to resolve complaints within {{company.complaint_resolve_days}} working days.
- If we cannot solve it, you may complain to the Directorate of National Consumer Rights Protection, and any dispute may be decided by the courts of {{company.court_city}}.

## 19. Contact
{{company.legal_name}}
{{company.address}}
Trade licence: {{company.trade_license}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}
Support hours: {{company.support_hours}}$en$,
  $bn$এই ব্যবহারের শর্তাবলি ("শর্তাবলি") আপনার এবং {{company.legal_name}} ("Explooro", "আমরা")-এর মধ্যে একটি চুক্তি। {{company.legal_name}} বাংলাদেশে নিবন্ধিত একটি {{company.business_type}}, যা Explooro ওয়েবসাইট ও মোবাইল অ্যাপ (একসাথে "প্ল্যাটফর্ম") পরিচালনা করে। অ্যাকাউন্ট খুললে, সাইন ইন করে ব্রাউজ করলে বা অর্ডার করলে আপনি এই শর্তাবলি, আমাদের গোপনীয়তা নীতি এবং রিফান্ড ও রিটার্ন নীতিতে সম্মত হচ্ছেন। সম্মত না হলে অনুগ্রহ করে Explooro ব্যবহার করবেন না।

## ১. আমরা কারা
- নিবন্ধিত নাম: {{company.legal_name}}
- নিবন্ধিত ঠিকানা: {{company.address}}
- ট্রেড লাইসেন্স: {{company.trade_license}}
- ডিজিটাল বিজনেস আইডেন্টিটি (DBID): {{company.dbid}}
- ই-টিআইএন / বিআইএন (ভ্যাট): {{company.tax_ids}}

## ২. কারা Explooro ব্যবহার করতে পারেন
- আপনার বয়স কমপক্ষে ১৮ বছর হতে হবে, অথবা এমন বাবা-মা বা অভিভাবকের সাথে ব্যবহার করতে হবে যিনি আপনার হয়ে এই শর্তাবলিতে সম্মত হন।
- একজন মানুষ, একটি অ্যাকাউন্ট। আপনি যে তথ্য দেন (নাম, মোবাইল নম্বর, ঠিকানা) তা সত্য, হালনাগাদ ও আপনার নিজের হতে হবে।
- আপনার অ্যাকাউন্ট থেকে যা কিছু করা হয় তার দায় আপনার। পাসওয়ার্ড ও আমাদের পাঠানো কোড গোপন রাখুন, এবং অন্য কেউ আপনার অ্যাকাউন্ট ব্যবহার করেছে মনে হলে সঙ্গে সঙ্গে আমাদের জানান।
- যেসব ব্যবসা Explooro-তে বিক্রি করে (সরবরাহকারী) এবং Explooro শপ পার্টনাররা তাঁদের নিজস্ব চুক্তিতেও সম্মত হন, যা এই শর্তাবলির সাথে যুক্ত।

## ৩. Explooro কীভাবে কাজ করে
- **সরবরাহকারীরা** পণ্যের মালিক, পণ্য নিজেদের কাছে রাখেন, পণ্যের দায় নেন, এবং আপনার পার্সেল প্যাক করে পাঠান।
- **Explooro শপ পার্টনাররা** তাঁদের Explooro শপ ও লিংকের মাধ্যমে পণ্যের সুপারিশ করেন। তাঁরা পণ্য রাখেন না এবং দাম ঠিক করেন না।
- **Explooro** প্ল্যাটফর্ম চালায়, দাম দেখায়, আপনার টাকা নেয় এবং অর্ডার ডেলিভারি হয়ে রিটার্নের সময় পার না হওয়া পর্যন্ত তা নিরাপদে জমা রাখে। তারপরই সরবরাহকারী ও শপ পার্টনার টাকা পান।
- পণ্যের পেজে Explooro নিজে বিক্রেতা বলে লেখা না থাকলে, পণ্য বিক্রির চুক্তি আপনার এবং সেই পণ্যের সরবরাহকারীর মধ্যে। Explooro সেই বিক্রির ব্যবস্থা করে ও সুরক্ষা দেয় এমন মার্কেটপ্লেস হিসেবে কাজ করে।

## ৪. পণ্য ও তথ্য
- পণ্যের বর্ণনা ও ছবি সরবরাহকারীরা দেন। আমরা লিস্টিং যাচাই করি, তবে পর্দায় রং, মাপ ও ছোটখাটো বিষয় আসল পণ্য থেকে সামান্য আলাদা হতে পারে।
- পণ্য স্পষ্টভাবে বর্ণনার সাথে না মিললে রিফান্ড ও রিটার্ন নীতি অনুযায়ী ফেরত দিতে পারবেন।
- আইন বা আমাদের নিয়ম ভাঙে এমন যেকোনো পণ্য বা লিস্টিং আমরা সরিয়ে দিতে পারি।

## ৫. দাম ও অর্ডার
- দাম বাংলাদেশি টাকায় (BDT), এবং প্রযোজ্য ক্ষেত্রে ভ্যাটসহ। ডেলিভারি চার্জ আপনি নিশ্চিত করার আগে চেকআউটে আলাদাভাবে দেখানো হয়, এবং তা আপনার ডেলিভারির জেলার ওপর নির্ভর করে।
- অর্ডার নিশ্চিতকরণ দেখলে অর্ডার দেওয়া হয়েছে। এটা কেনার অনুরোধ; সরবরাহকারী পাঠানোর জন্য প্রস্তুত করলে তা গৃহীত হয়।
- যে অর্ডার পূরণ করা সম্ভব নয়, যেমন পণ্য স্টকে নেই, স্পষ্ট ভুলে দাম ভুল দেখানো হয়েছে, বা অর্ডারটি প্রতারণামূলক মনে হয়, সরবরাহকারী বা Explooro তা বাতিল করতে পারে। আমরা কারণ জানাব। আগে টাকা দিয়ে থাকলে পুরো টাকা আপনার Explooro ভল্টে ফেরত যাবে।
- কুরিয়ারের হাতে দেওয়ার আগ পর্যন্ত আপনি অ্যাকাউন্ট থেকে অর্ডার বাতিল করতে পারেন।
- একজন একটি পণ্য কতগুলো কিনতে পারবেন, বিশেষ করে ফ্ল্যাশ সেল ও টিম পারচেজে, তা আমরা সীমিত করতে পারি।

## ৬. অফার, কুপন ও টিম পারচেজ
- প্রতিটি কুপন, ফ্ল্যাশ সেল ও টিম পারচেজের নিজস্ব শর্ত আছে, যা ব্যবহারের জায়গায় দেখানো হয়। কুপন নগদ টাকায় বদলানো যায় না।
- টিম পারচেজ তখনই হয় যখন সময়ের মধ্যে যথেষ্ট মানুষ যোগ দেন। না হলে আপনার দেওয়া টাকা ভল্টে ফেরত যায়।
- অফার ব্যবহার করা অর্ডার ফেরত বা বাতিল হলে অফারটি নগদ টাকা হিসেবে ফেরত দেওয়া হয় না।

## ৭. টাকা দেওয়া
- ক্যাশ অন ডেলিভারিতে বা আপনার Explooro ভল্ট থেকে টাকা দিতে পারেন। অনলাইন পদ্ধতি (বিকাশ, নগদ, রকেট, কার্ড) কেবল তখনই পাবেন যখন তা চেকআউটে দেখা যায়।
- ভুয়া অর্ডার ঠেকাতে ক্যাশ অন ডেলিভারির জন্য আমরা আপনার ফোনে পাঠানো কোড দিয়ে অর্ডার নিশ্চিত করতে বলতে পারি, বা অল্প কিছু অগ্রিম চাইতে পারি।
- অনলাইন পেমেন্ট আপনার বেছে নেওয়া পেমেন্ট কোম্পানি সামলায়। আমরা কখনো আপনার কার্ড নম্বর বা পিন দেখি না বা রাখি না।

## ৮. আপনার Explooro ভল্ট
- আপনার **Explooro ভল্ট** হলো Explooro-তে আপনার ব্যালেন্স। ফেরত টাকা, আপনার যোগ করা টাকা এবং আপনার প্রাপ্য আয় সেখানে জমা হয়।
- ক্রেতারা ভল্টের টাকা অর্ডার ও বিজ্ঞাপনে খরচ করতে পারেন। Explooro শপ পার্টনার ও সরবরাহকারীরা তাঁদের নিজস্ব চুক্তি অনুযায়ী তা তুলতেও পারেন।
- ভল্টের টাকায় কোনো সুদ হয় না এবং এটা ব্যাংক অ্যাকাউন্ট নয়। ক্রেতা হিসেবে ভল্টের টাকা আপনি Explooro-তে খরচ করেন।

## ৯. ডেলিভারি
- চেকআউটে আমরা ডেলিভারির আনুমানিক সময় দেখাই। এটা একটা আনুমান: আবহাওয়া, ছুটি, হরতাল ও কুরিয়ারের দেরিতে তা বদলাতে পারে।
- পার্সেল আপনার বা আপনার বলে দেওয়া কারো হাতে পৌঁছালে তার ক্ষতির ঝুঁকি আপনার।
- সম্ভব হলে ডেলিভারিম্যানের সামনেই পার্সেল দেখে নিন। কিছু ভুল থাকলে রিফান্ড ও রিটার্ন নীতি অনুসরণ করুন।

## ১০. রিটার্ন, রিফান্ড ও ওয়ারেন্টি
রিটার্ন, রিফান্ড ও ওয়ারেন্টি দাবি আমাদের রিফান্ড ও রিটার্ন নীতি অনুযায়ী হয়, যা এই শর্তাবলির অংশ।

## ১১. আপনার দেওয়া রিভিউ, পোস্ট ও অন্যান্য কনটেন্ট
- আপনার দেওয়া রিভিউ, কমিউনিটি পোস্ট, ছবি ও চ্যাট মেসেজ ("আপনার কনটেন্ট")-এর মালিক আপনি। আপনি Explooro-কে বিনা মূল্যে সেগুলো প্ল্যাটফর্মে ও Explooro-র নিজস্ব প্রচারে দেখানো, সংরক্ষণ ও প্রয়োজনমতো সাজানোর অনুমতি দিচ্ছেন।
- আপনার কনটেন্ট সৎ ও আপনার নিজের হতে হবে। তা বেআইনি, ঘৃণাপূর্ণ, হুমকিমূলক, যৌনতাপূর্ণ, বিভ্রান্তিকর বা অন্যের হতে পারবে না।
- এই নিয়ম ভাঙে এমন কনটেন্ট আমরা সরিয়ে দিতে পারি। নিজের পোস্ট আপনি মুছতে পারেন; আগেই শেয়ার হওয়া কপি মুছে যেতে কিছু সময় লাগতে পারে।

## ১২. যা করা যাবে না
- ভুয়া অর্ডার দেওয়া, ইচ্ছা করে পার্সেল ফিরিয়ে দেওয়া, বা অন্যের তথ্য বা পেমেন্ট পদ্ধতি ব্যবহার করা।
- পুরস্কার, রেফারেল আয় বা কুপন একাধিকবার পেতে একাধিক অ্যাকাউন্ট খোলা।
- ভুয়া রিভিউ দেওয়া, বা টাকা দিয়ে বা অনুরোধ করে কাউকে দিয়ে লেখানো।
- প্ল্যাটফর্মের কনটেন্ট বা তথ্য কপি, স্ক্র্যাপ বা পুনরায় বিক্রি করা, বা বট দিয়ে অর্ডার দেওয়া বা অফার সংগ্রহ করা।
- প্ল্যাটফর্ম ভাঙা, অতিরিক্ত চাপ দেওয়া বা এর নিরাপত্তা এড়ানোর চেষ্টা করা।
- বাংলাদেশের আইনে বেআইনি কোনো কাজে Explooro ব্যবহার করা।

এমন করলে আমরা অর্ডার বাতিল করতে পারি, এভাবে পাওয়া পুরস্কার, কুপন বা আয় ফেরত নিতে পারি, এবং আপনার অ্যাকাউন্ট সীমিত, স্থগিত বা বন্ধ করতে পারি। আইন যেখানে বলে, সেখানে আমরা কর্তৃপক্ষকে জানাতে পারি।

## ১৩. আমাদের নাম ও কনটেন্ট
Explooro নাম, লোগো এবং প্ল্যাটফর্মের নকশা ও সফটওয়্যারের মালিক {{company.legal_name}}। Explooro-র পেজের লিংক শেয়ার করা ছাড়া আমাদের লিখিত অনুমতি ছাড়া এগুলো ব্যবহার করা যাবে না।

## ১৪. আমাদের দায়
- আমরা Explooro চালু রাখতে ও এর তথ্য সঠিক রাখতে চেষ্টা করি, তবে এটা সবসময় পাওয়া যাবে, দেরি হবে না বা কোনো ভুল থাকবে না, এমন নিশ্চয়তা দিতে পারি না।
- পণ্যের নিজের দায় সরবরাহকারীর: এর মান, নিরাপত্তা, বৈধতা, বর্ণনা ও ওয়ারেন্টি। Explooro-র দায় প্ল্যাটফর্ম চালানো এবং এই শর্তাবলি অনুযায়ী আপনার টাকা সামলানো।
- আইন যতটা অনুমতি দেয়, পরোক্ষ ক্ষতি, যেমন লাভ বা সুযোগ হারানো, এর জন্য আমরা দায়ী নই, এবং একটি অর্ডারের জন্য আমাদের মোট দায় সেই অর্ডারে আপনার দেওয়া টাকার বেশি নয়।
- ভোক্তা-অধিকার সংরক্ষণ আইন, ২০০৯ বা বাংলাদেশের অন্য কোনো আইনে আপনার যে অধিকার আছে, এই শর্তাবলির কিছুই তা কেড়ে নেয় না।

## ১৫. আমাদের নিয়ন্ত্রণের বাইরের ঘটনা
প্রাকৃতিক দুর্যোগ, বন্যা, ধর্মঘট, হরতাল, সরকারি আদেশ, ইন্টারনেট বা বিদ্যুৎ বিভ্রাট, বা কোনো ব্যাংক, পেমেন্ট কোম্পানি বা কুরিয়ারের ব্যর্থতার মতো যুক্তিসঙ্গতভাবে আমাদের নিয়ন্ত্রণের বাইরের ঘটনায় দেরি বা ব্যর্থতার জন্য আমরা দায়ী নই।

## ১৬. অ্যাকাউন্ট বন্ধ করা
যেকোনো সময় আপনি অ্যাকাউন্ট বন্ধ করতে বলতে পারেন। এই শর্তাবলি বা আইন ভাঙে এমন অ্যাকাউন্ট আমরা স্থগিত বা বন্ধ করতে পারি। এই শর্তাবলি ভেঙে পাওয়া টাকা ছাড়া, ভল্টে আপনার যে টাকা আছে তা আপনারই থাকবে; কোনো চলমান অর্ডার, রিটার্ন বা বিরোধ মিটে গেলে আমরা তা ফেরত দেব।

## ১৭. শর্তাবলির পরিবর্তন
আমরা এই শর্তাবলি বদলাতে পারি। গুরুত্বপূর্ণ পরিবর্তন হলে পরের বার Explooro ব্যবহারের সময় আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব। প্রতিটি সংস্করণে তার নম্বর ও কার্যকর হওয়ার তারিখ দেখানো থাকে। বানান ঠিক করা বা নতুন ঠিকানার মতো ছোট পরিবর্তন প্রকাশের সাথে সাথেই কার্যকর হয়।

## ১৮. আইন ও বিরোধ
- এই শর্তাবলি বাংলাদেশের আইন দ্বারা পরিচালিত।
- কোনো সমস্যা হলে আগে আমাদের সাথে যোগাযোগ করুন, যাতে আমরা তা সমাধানের চেষ্টা করতে পারি। আমরা {{company.complaint_reply_days}} কর্মদিবসের মধ্যে উত্তর দিতে এবং {{company.complaint_resolve_days}} কর্মদিবসের মধ্যে অভিযোগ নিষ্পত্তি করতে চেষ্টা করি।
- আমরা সমাধান করতে না পারলে আপনি জাতীয় ভোক্তা-অধিকার সংরক্ষণ অধিদপ্তরে অভিযোগ করতে পারেন, এবং যেকোনো বিরোধ {{company.court_city}}-র আদালত নিষ্পত্তি করবে।

## ১৯. যোগাযোগ
{{company.legal_name}}
{{company.address}}
ট্রেড লাইসেন্স: {{company.trade_license}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}
সাপোর্টের সময়: {{company.support_hours}}$bn$,
  'Full version written for doing business in Bangladesh.', 'বাংলাদেশে ব্যবসার জন্য লেখা পূর্ণ সংস্করণ।', true
FROM legal_documents
WHERE doc_key = 'terms'
-- WHY HAVING and not WHERE: an aggregate with no GROUP BY returns one row even when WHERE keeps none,
-- which would insert a second version 1.
HAVING NOT EXISTS (SELECT 1 FROM legal_documents WHERE doc_key = 'terms' AND change_note_en = 'Full version written for doing business in Bangladesh.');

INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
SELECT 'privacy', COALESCE(MAX(version), 0) + 1,
  'Privacy Policy',
  'গোপনীয়তা নীতি',
  $en$This policy explains what personal information {{company.legal_name}} ("Explooro", "we", "us") collects when you use the Explooro website and app, why we use it, who we share it with, how long we keep it, and the choices you have. It is part of our Terms of Use.

## 1. Who is responsible for your information
{{company.legal_name}}, {{company.address}}, decides how your information is used and is responsible for it. You can reach the person who handles privacy questions at {{company.privacy_email}}.

## 2. What we collect
- **Account details:** your name, mobile number, email if you give it, password (stored only in a form nobody can read back), your role (customer, Explooro partner, supplier) and, if you give it, your date of birth and photo.
- **Delivery details:** the names, phone numbers and addresses you save or type at checkout.
- **Orders and payments:** what you bought, what you paid and how, refunds, and your Vault transactions. We do not store card numbers or PINs; card and mobile banking payments are handled by the payment company.
- **Identity checks:** if you become an Explooro partner or supplier and withdraw money, the identity documents you upload (such as your NID), your trade licence if you are a business, and your bKash, Nagad or bank details for withdrawals.
- **If an Explooro partner orders for you:** the name, phone number and address they give us. We open an account in your name so the order shows in your own history.
- **What you add:** reviews, community posts, chat messages, photos, live streams and shop pages.
- **How you use Explooro:** products you view, search for and click, the pages you visit, and the device, browser, app version and IP address you use.
- **When you contact us:** what you tell our support team, and recordings of calls if we tell you the call is recorded.

## 3. Why we use it, and on what basis
- **To provide the service you asked for:** create your account, sign you in, send security codes, take and deliver your order, handle returns and warranty claims, and pay suppliers and Explooro partners.
- **To keep Explooro safe:** stop fake orders and fraud, for example by asking for a code before a cash-on-delivery order, and protect accounts from misuse.
- **To improve and personalise Explooro:** show you products, offers and ads that suit you, and understand which features work.
- **To talk to you:** answer you when you contact us, tell you about your orders, and send offers if you have not turned them off.
- **Because the law requires it:** keep transaction and tax records, and answer lawful requests from the authorities.

## 4. Who we share it with
- **The supplier** of your order gets the name, phone number and address needed to send the parcel.
- **Courier companies** get what they need to deliver or collect a parcel.
- **The Explooro partner** whose shop or link you bought from sees which products were ordered through them, not your phone number or address.
- **Service providers** who work for us: {{company.service_providers}}. They may use your information only to do that work for us.
- **Authorities**, when the law requires it, or to protect people from fraud or harm.
- **A new owner**, if Explooro's business is sold or merged, on the condition that they keep this policy's promises.

We do not sell your personal information.

## 5. Where it is stored
Your information is stored on servers {{company.data_location}}. Wherever it is stored, it is protected as this policy describes.

## 6. How long we keep it
- Behaviour data (views, clicks, searches) is deleted automatically after a limited period set in our data retention settings.
- Orders, payments and Vault transactions are kept for {{company.records_years}} years, as the law requires us to keep business records.
- Identity documents are kept while you are a partner or supplier and for {{company.id_docs_years}} years after, to answer any fraud or tax question.
- Account details are kept while your account is open, and for a limited time after it is closed to settle any order, refund or dispute.

## 7. Keeping it safe
Passwords are stored only in hashed form. Sensitive details, such as your date of birth and identity documents, are encrypted. Staff see only what their job needs, and every staff action on your account is recorded. No system is perfectly secure; if a breach affects you, we will tell you without undue delay and explain what we are doing about it.

## 8. Your rights and choices
- **See and correct:** you can see and correct your profile and addresses in your account at any time.
- **Get a copy:** you can ask for a copy of the personal information we hold about you.
- **Delete:** you can ask us to close your account and delete your information, except what the law makes us keep or what we need to settle an open order or dispute.
- **Marketing:** you can turn off offers and marketing messages in your notification settings. We will still send messages about your orders and your account's security.
- **Complain:** if you are unhappy with how we use your information, contact us first.

To use any of these rights, contact us at {{company.support_email}}. We reply within {{company.privacy_reply_days}} days, and we may ask you to prove who you are first.

## 9. Cookies and storage on your device
We use a secure cookie to keep you signed in, and your browser's storage to remember your cart, language and similar settings. Without them Explooro does not work properly. We do not use advertising cookies from other companies.

## 10. Children
Explooro is not meant for children under 18 without a parent or guardian. We do not knowingly collect information from children. If you think a child has given us information, contact us and we will remove it.

## 11. Links to other sites
Pages and posts on Explooro may link to other websites or apps, such as a payment company's page. Their own privacy policies apply there, not this one.

## 12. Changes
When we change this policy in a way that matters, we will ask you to read and agree to the new version the next time you use Explooro. Each version shows its number and the date it took effect.

## 13. Contact
{{company.legal_name}}, {{company.address}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}$en$,
  $bn$Explooro ওয়েবসাইট ও অ্যাপ ব্যবহারের সময় {{company.legal_name}} ("Explooro", "আমরা") আপনার কী কী ব্যক্তিগত তথ্য সংগ্রহ করে, কেন ব্যবহার করে, কার সাথে শেয়ার করে, কতদিন রাখে এবং আপনার কী কী বেছে নেওয়ার সুযোগ আছে, এই নীতিতে তা বলা হয়েছে। এটা আমাদের ব্যবহারের শর্তাবলির অংশ।

## ১. আপনার তথ্যের দায় কার
{{company.legal_name}}, {{company.address}}, আপনার তথ্য কীভাবে ব্যবহার হবে তা ঠিক করে এবং এর দায় নেয়। গোপনীয়তা নিয়ে প্রশ্ন থাকলে যোগাযোগ করুন: {{company.privacy_email}}।

## ২. আমরা কী সংগ্রহ করি
- **অ্যাকাউন্টের তথ্য:** আপনার নাম, মোবাইল নম্বর, দিলে ইমেইল, পাসওয়ার্ড (এমনভাবে রাখা হয় যে কেউ তা পড়তে পারে না), আপনার ভূমিকা (ক্রেতা, Explooro শপ পার্টনার, সরবরাহকারী), এবং দিলে আপনার জন্মতারিখ ও ছবি।
- **ডেলিভারির তথ্য:** আপনি যে নাম, ফোন নম্বর ও ঠিকানা সেভ করেন বা চেকআউটে লেখেন।
- **অর্ডার ও পেমেন্ট:** কী কিনেছেন, কত ও কীভাবে দিয়েছেন, ফেরত টাকা, এবং আপনার ভল্টের লেনদেন। আমরা কার্ড নম্বর বা পিন রাখি না; কার্ড ও মোবাইল ব্যাংকিং পেমেন্ট পেমেন্ট কোম্পানি সামলায়।
- **পরিচয় যাচাই:** শপ পার্টনার বা সরবরাহকারী হয়ে টাকা তুলতে চাইলে আপনার আপলোড করা পরিচয়পত্র (যেমন এনআইডি), ব্যবসা হলে ট্রেড লাইসেন্স, এবং টাকা তোলার জন্য বিকাশ, নগদ বা ব্যাংকের তথ্য।
- **শপ পার্টনার আপনার হয়ে অর্ডার দিলে:** তাঁর দেওয়া নাম, ফোন নম্বর ও ঠিকানা। অর্ডারটি যাতে আপনার নিজের ইতিহাসে দেখা যায়, সেজন্য আমরা আপনার নামে একটি অ্যাকাউন্ট খুলি।
- **আপনি যা যোগ করেন:** রিভিউ, কমিউনিটি পোস্ট, চ্যাট মেসেজ, ছবি, লাইভ স্ট্রিম ও শপ পেজ।
- **আপনি কীভাবে Explooro ব্যবহার করেন:** কোন পণ্য দেখেন, খোঁজেন ও ক্লিক করেন, কোন পেজে যান, এবং কোন ডিভাইস, ব্রাউজার, অ্যাপের সংস্করণ ও আইপি ঠিকানা ব্যবহার করেন।
- **আমাদের সাথে যোগাযোগ করলে:** আমাদের সাপোর্ট টিমকে আপনি যা বলেন, এবং কল রেকর্ড হচ্ছে বলে জানালে সেই কলের রেকর্ডিং।

## ৩. কেন ব্যবহার করি, এবং কিসের ভিত্তিতে
- **আপনার চাওয়া সেবা দিতে:** অ্যাকাউন্ট খোলা, সাইন ইন করানো, নিরাপত্তা কোড পাঠানো, অর্ডার নেওয়া ও পৌঁছে দেওয়া, রিটার্ন ও ওয়ারেন্টি দাবি সামলানো, এবং সরবরাহকারী ও শপ পার্টনারদের টাকা দেওয়া।
- **Explooro নিরাপদ রাখতে:** ভুয়া অর্ডার ও প্রতারণা ঠেকানো, যেমন ক্যাশ অন ডেলিভারি অর্ডারের আগে কোড চাওয়া, এবং অ্যাকাউন্টের অপব্যবহার রোধ করা।
- **Explooro উন্নত ও আপনার উপযোগী করতে:** আপনার পছন্দের পণ্য, অফার ও বিজ্ঞাপন দেখানো, এবং কোন ফিচার কাজে আসছে তা বোঝা।
- **আপনার সাথে কথা বলতে:** যোগাযোগ করলে উত্তর দেওয়া, অর্ডারের খবর জানানো, এবং আপনি বন্ধ না করলে অফার পাঠানো।
- **আইন চায় বলে:** লেনদেন ও করের রেকর্ড রাখা, এবং কর্তৃপক্ষের আইনসঙ্গত অনুরোধের উত্তর দেওয়া।

## ৪. কার সাথে শেয়ার করি
- **আপনার অর্ডারের সরবরাহকারী** পার্সেল পাঠাতে যে নাম, ফোন নম্বর ও ঠিকানা লাগে তা পান।
- **কুরিয়ার কোম্পানি** পার্সেল পৌঁছাতে বা নিয়ে আসতে যা লাগে তা পায়।
- **যে শপ পার্টনারের শপ বা লিংক থেকে কিনেছেন** তিনি দেখেন তাঁর মাধ্যমে কোন পণ্যের অর্ডার হয়েছে; আপনার ফোন নম্বর বা ঠিকানা দেখেন না।
- **যারা আমাদের হয়ে কাজ করে:** {{company.service_providers}}। তারা আপনার তথ্য শুধু আমাদের হয়ে সেই কাজেই ব্যবহার করতে পারে।
- **কর্তৃপক্ষ**, যখন আইন তা চায়, অথবা মানুষকে প্রতারণা বা ক্ষতি থেকে বাঁচাতে।
- **নতুন মালিক**, যদি Explooro-র ব্যবসা বিক্রি বা একীভূত হয়, এই শর্তে যে তারা এই নীতির প্রতিশ্রুতি মেনে চলবে।

আমরা আপনার ব্যক্তিগত তথ্য বিক্রি করি না।

## ৫. কোথায় রাখা হয়
আপনার তথ্য সার্ভারে রাখা হয়: {{company.data_location}}। যেখানেই রাখা হোক, এই নীতিতে বলা উপায়ে তা সুরক্ষিত থাকে।

## ৬. কতদিন রাখি
- আচরণের তথ্য (দেখা, ক্লিক, খোঁজ) আমাদের তথ্য সংরক্ষণ সেটিংসে ঠিক করা একটা নির্দিষ্ট সময় পরে নিজে থেকেই মুছে যায়।
- অর্ডার, পেমেন্ট ও ভল্টের লেনদেন {{company.records_years}} বছর রাখা হয়, কারণ আইন ব্যবসার রেকর্ড রাখতে বলে।
- পরিচয়পত্র আপনি শপ পার্টনার বা সরবরাহকারী থাকা পর্যন্ত এবং তারপর {{company.id_docs_years}} বছর রাখা হয়, যাতে প্রতারণা বা করের কোনো প্রশ্নের উত্তর দেওয়া যায়।
- অ্যাকাউন্ট খোলা থাকা পর্যন্ত অ্যাকাউন্টের তথ্য রাখা হয়, এবং বন্ধ হওয়ার পর কোনো অর্ডার, রিফান্ড বা বিরোধ মেটাতে কিছুদিন।

## ৭. নিরাপদ রাখা
পাসওয়ার্ড শুধু হ্যাশ করা অবস্থায় রাখা হয়। জন্মতারিখ ও পরিচয়পত্রের মতো সংবেদনশীল তথ্য এনক্রিপ্ট করা থাকে। কর্মীরা শুধু তাঁদের কাজের জন্য যা দরকার তা-ই দেখেন, এবং আপনার অ্যাকাউন্টে কর্মীদের প্রতিটি কাজ রেকর্ড করা হয়। কোনো ব্যবস্থাই পুরোপুরি নিরাপদ নয়; তথ্য ফাঁসে আপনি ক্ষতিগ্রস্ত হলে আমরা অযথা দেরি না করে আপনাকে জানাব এবং আমরা কী করছি তা বলব।

## ৮. আপনার অধিকার ও পছন্দ
- **দেখা ও ঠিক করা:** যেকোনো সময় অ্যাকাউন্টে গিয়ে প্রোফাইল ও ঠিকানা দেখতে ও ঠিক করতে পারেন।
- **কপি পাওয়া:** আপনার সম্পর্কে আমাদের কাছে থাকা ব্যক্তিগত তথ্যের কপি চাইতে পারেন।
- **মুছে ফেলা:** অ্যাকাউন্ট বন্ধ করে তথ্য মুছে ফেলতে বলতে পারেন, তবে আইন যা রাখতে বলে বা কোনো চলমান অর্ডার বা বিরোধ মেটাতে যা লাগে তা ছাড়া।
- **প্রচারমূলক মেসেজ:** নোটিফিকেশন সেটিংস থেকে অফার ও প্রচারমূলক মেসেজ বন্ধ করতে পারেন। আপনার অর্ডার ও অ্যাকাউন্টের নিরাপত্তা নিয়ে মেসেজ তখনও পাঠানো হবে।
- **অভিযোগ:** আমরা আপনার তথ্য যেভাবে ব্যবহার করি তাতে অসন্তুষ্ট হলে আগে আমাদের জানান।

এই অধিকারগুলোর কোনোটি ব্যবহার করতে {{company.support_email}}-এ যোগাযোগ করুন। আমরা {{company.privacy_reply_days}} দিনের মধ্যে উত্তর দিই, এবং আগে আপনার পরিচয় প্রমাণ করতে বলতে পারি।

## ৯. কুকি ও ডিভাইসের স্টোরেজ
আপনাকে সাইন ইন রাখতে আমরা একটি নিরাপদ কুকি ব্যবহার করি, আর কার্ট, ভাষা ও এমন সেটিংস মনে রাখতে আপনার ব্রাউজারের স্টোরেজ ব্যবহার করি। এগুলো ছাড়া Explooro ঠিকমতো চলে না। আমরা অন্য কোম্পানির বিজ্ঞাপনী কুকি ব্যবহার করি না।

## ১০. শিশু
বাবা-মা বা অভিভাবক ছাড়া ১৮ বছরের কম বয়সীদের জন্য Explooro নয়। আমরা জেনেশুনে শিশুদের তথ্য সংগ্রহ করি না। কোনো শিশু আমাদের তথ্য দিয়েছে মনে হলে যোগাযোগ করুন, আমরা তা সরিয়ে দেব।

## ১১. অন্য সাইটের লিংক
Explooro-র পেজ ও পোস্টে অন্য ওয়েবসাইট বা অ্যাপের লিংক থাকতে পারে, যেমন পেমেন্ট কোম্পানির পেজ। সেখানে এই নীতি নয়, তাদের নিজস্ব গোপনীয়তা নীতি প্রযোজ্য।

## ১২. পরিবর্তন
এই নীতিতে গুরুত্বপূর্ণ পরিবর্তন হলে পরের বার Explooro ব্যবহারের সময় আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব। প্রতিটি সংস্করণে তার নম্বর ও কার্যকর হওয়ার তারিখ দেখানো থাকে।

## ১৩. যোগাযোগ
{{company.legal_name}}, {{company.address}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}$bn$,
  'Full version written for doing business in Bangladesh.', 'বাংলাদেশে ব্যবসার জন্য লেখা পূর্ণ সংস্করণ।', true
FROM legal_documents
WHERE doc_key = 'privacy'
-- WHY HAVING and not WHERE: an aggregate with no GROUP BY returns one row even when WHERE keeps none,
-- which would insert a second version 1.
HAVING NOT EXISTS (SELECT 1 FROM legal_documents WHERE doc_key = 'privacy' AND change_note_en = 'Full version written for doing business in Bangladesh.');

INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
SELECT 'refund', COALESCE(MAX(version), 0) + 1,
  'Refund & Return Policy',
  'রিফান্ড ও রিটার্ন নীতি',
  $en$This policy explains when you can cancel an order or return a product, who pays to send it back, how and when you get your money, and how warranty claims are handled on Explooro. It is part of our Terms of Use and does not take away any right you have under the Consumer Rights Protection Act, 2009.

## 1. Your money is held safely until delivery
When you pay, Explooro holds the money. The supplier and the Explooro partner are paid only after your order is delivered and the return window has passed. That is how we can refund you if something goes wrong.

## 2. Cancelling an order
- You can cancel an order from your account until it has been handed to the courier. If you already paid, the full amount goes back to your Explooro Vault straight away.
- If the supplier or Explooro cancels your order (for example, the item is out of stock), you are refunded in full in the same way.
- Once the parcel is with the courier it can no longer be cancelled, but you can refuse it at the door or return it as described below.

## 3. Returning a product
- You can ask for a return within **{{returns.window_days}} days** of delivery, from the order's page in your account.
- Tell us why (for example: damaged, wrong item, not as described, missing parts, or you changed your mind) and add photos or a short video if you can. They make the decision faster.
- Keep the product, its box, tags, free gifts and everything that came with it, unused and undamaged, until the return is decided.
- A product with a broken seal, or that has been used, washed or altered, can be returned only if it was faulty when it arrived.

## 4. Products that cannot be returned for a change of mind
These can be returned only if they arrive damaged, wrong, expired or not as described:
- Food, groceries and anything that spoils.
- Personal care, beauty, hygiene and health products once opened.
- Underwear, swimwear and socks.
- Items made or altered to your order, such as tailored or printed items.
- Digital products, gift cards and mobile recharge.

## 5. What happens next
- The supplier or our team reviews your request within {{company.return_review_days}} working days. If it is approved, we arrange a pickup or tell you where to send the product. Your returns page shows the address and the next step.
- When the product is back, it is checked within {{company.return_check_days}} working days, then we refund you.
- If your request is not approved, we tell you why. You can ask our team to look at it again, and they will reply within {{company.return_appeal_days}} working days.
- If the returned product is not in the condition you described, we may send it back to you instead of refunding.

## 6. Who pays to send it back
- **If the problem is ours or the supplier's** (the product is damaged, wrong, faulty, expired or not as described), you pay nothing. If we send a courier, the pickup is free. If you send it yourself, keep the courier's receipt: we repay it with your refund, up to **Tk {{returns.max_courier_refund}}**. If you return the whole parcel, its delivery charge is refunded too.
- **If you changed your mind** (including size, colour or any other reason of your own), you pay to send it back. If you send it yourself, you pay the courier. If we send a courier, **Tk {{returns.pickup_fee}}** is taken from your refund. The delivery charge is not refunded.
- Our team decides which case applies when your return is approved, and your returns page shows it.

## 7. How and when you get your money back
- Refunds are paid into your **Explooro Vault** once the returned product has been checked, usually within {{company.refund_days}} working days of the product reaching us. You can spend Vault money on any order.
- If you return only some items in a parcel, you are refunded for those items.
- Coupons and offer discounts are not refunded as cash: you are refunded what you actually paid for the item.

## 8. If your parcel never arrives
If the courier marks your order as delivered but you did not receive it, tell us within {{company.not_received_days}} days. We will check with the courier and, if it was not delivered to you or someone you named, refund you in full or send it again.

## 9. Warranty
- Some products come with a warranty from the supplier, shown on the product page and in your account. The period and what it covers are set by the supplier or the manufacturer.
- Within the warranty period you can claim a repair, a replacement or a refund from your account. The supplier decides which, as the warranty describes.
- The supplier is responsible for the warranty. Explooro helps you make the claim, arranges pickup where we can, and follows it up.
- A warranty does not cover damage from misuse, accidents, water, unauthorised repair or normal wear.

## 10. Cash on delivery
If you refuse a cash-on-delivery parcel without a good reason, or keep ordering and refusing, we may stop offering you cash on delivery or ask for an advance on your next orders.

## 11. Misuse of returns
If we see returns being used to cheat, such as returning a different or used product, or making many false claims, we may refuse the return, take back a refund already given, and limit or close the account.

## 12. Contact
For any problem with an order, use the help or chat in your account, or contact {{company.support_email}} · {{company.support_phone}}.$en$,
  $bn$Explooro-তে কখন অর্ডার বাতিল বা পণ্য ফেরত দিতে পারবেন, ফেরত পাঠানোর খরচ কে দেবে, কীভাবে ও কখন টাকা ফেরত পাবেন, এবং ওয়ারেন্টি দাবি কীভাবে সামলানো হয়, এই নীতিতে তা বলা হয়েছে। এটা আমাদের ব্যবহারের শর্তাবলির অংশ এবং ভোক্তা-অধিকার সংরক্ষণ আইন, ২০০৯-এ আপনার কোনো অধিকার কেড়ে নেয় না।

## ১. ডেলিভারি পর্যন্ত আপনার টাকা নিরাপদে জমা থাকে
আপনি টাকা দিলে তা Explooro-র কাছে জমা থাকে। অর্ডার ডেলিভারি হয়ে রিটার্নের সময় পার হওয়ার পরই সরবরাহকারী ও শপ পার্টনার টাকা পান। এ কারণেই কিছু ভুল হলে আমরা আপনাকে টাকা ফেরত দিতে পারি।

## ২. অর্ডার বাতিল করা
- কুরিয়ারের হাতে দেওয়ার আগ পর্যন্ত আপনি অ্যাকাউন্ট থেকে অর্ডার বাতিল করতে পারেন। আগে টাকা দিয়ে থাকলে পুরো টাকা সঙ্গে সঙ্গে আপনার Explooro ভল্টে ফেরত যায়।
- সরবরাহকারী বা Explooro আপনার অর্ডার বাতিল করলে (যেমন পণ্য স্টকে নেই), একইভাবে পুরো টাকা ফেরত পান।
- পার্সেল কুরিয়ারের কাছে চলে গেলে আর বাতিল করা যায় না, তবে দরজায় ফিরিয়ে দিতে পারেন বা নিচের নিয়মে ফেরত দিতে পারেন।

## ৩. পণ্য ফেরত দেওয়া
- ডেলিভারির **{{returns.window_days}} দিনের** মধ্যে আপনার অ্যাকাউন্টে অর্ডারের পেজ থেকে রিটার্নের অনুরোধ করতে পারেন।
- কারণ জানান (যেমন: ভাঙা, ভুল পণ্য, বর্ণনার সাথে মেলে না, কিছু অংশ নেই, অথবা আপনি মত বদলেছেন) এবং সম্ভব হলে ছবি বা ছোট ভিডিও দিন। এতে সিদ্ধান্ত দ্রুত হয়।
- সিদ্ধান্ত না হওয়া পর্যন্ত পণ্য, বাক্স, ট্যাগ, ফ্রি উপহার ও সাথে আসা সবকিছু অব্যবহৃত ও অক্ষত অবস্থায় রাখুন।
- সিল ভাঙা, অথবা ব্যবহার করা, ধোয়া বা বদলানো পণ্য কেবল তখনই ফেরত দেওয়া যায় যদি তা আসার সময়ই ত্রুটিপূর্ণ ছিল।

## ৪. যেসব পণ্য মত বদলালে ফেরত দেওয়া যায় না
এগুলো কেবল ভাঙা, ভুল, মেয়াদোত্তীর্ণ বা বর্ণনার সাথে না মিললে ফেরত দেওয়া যায়:
- খাবার, মুদি পণ্য ও যা নষ্ট হয়ে যায়।
- খোলার পর ব্যক্তিগত পরিচর্যা, সৌন্দর্য, স্বাস্থ্যবিধি ও স্বাস্থ্য পণ্য।
- অন্তর্বাস, সাঁতারের পোশাক ও মোজা।
- আপনার অর্ডার অনুযায়ী বানানো বা বদলানো পণ্য, যেমন মাপমতো সেলাই বা প্রিন্ট করা পণ্য।
- ডিজিটাল পণ্য, গিফট কার্ড ও মোবাইল রিচার্জ।

## ৫. এরপর কী হয়
- সরবরাহকারী বা আমাদের টিম {{company.return_review_days}} কর্মদিবসের মধ্যে আপনার অনুরোধ দেখেন। অনুমোদন হলে আমরা পণ্য নিয়ে আসার ব্যবস্থা করি, বা কোথায় পাঠাতে হবে জানাই। আপনার রিটার্ন পেজে ঠিকানা ও পরের ধাপ দেখা যায়।
- পণ্য ফিরে এলে {{company.return_check_days}} কর্মদিবসের মধ্যে যাচাই করা হয়, তারপর আমরা টাকা ফেরত দিই।
- অনুরোধ অনুমোদন না হলে আমরা কারণ জানাই। আপনি আমাদের টিমকে আবার দেখতে বলতে পারেন, তাঁরা {{company.return_appeal_days}} কর্মদিবসের মধ্যে উত্তর দেবেন।
- ফেরত আসা পণ্য আপনার বর্ণনার মতো অবস্থায় না থাকলে, টাকা ফেরতের বদলে আমরা পণ্যটি আপনাকে আবার পাঠিয়ে দিতে পারি।

## ৬. ফেরত পাঠানোর খরচ কে দেবে
- **সমস্যা আমাদের বা সরবরাহকারীর হলে** (পণ্য ভাঙা, ভুল, ত্রুটিপূর্ণ, মেয়াদোত্তীর্ণ বা বর্ণনার সাথে মেলে না), আপনাকে কিছু দিতে হবে না। আমরা কুরিয়ার পাঠালে পণ্য নিয়ে যাওয়া বিনা খরচে। নিজে পাঠালে কুরিয়ারের রসিদ রেখে দিন: রিফান্ডের সাথে আমরা সর্বোচ্চ **{{returns.max_courier_refund}} টাকা** পর্যন্ত তা ফেরত দেব। পুরো পার্সেল ফেরত দিলে তার ডেলিভারি চার্জও ফেরত পাবেন।
- **আপনি মত বদলালে** (সাইজ, রং বা আপনার নিজের অন্য যেকোনো কারণসহ), ফেরত পাঠানোর খরচ আপনার। নিজে পাঠালে কুরিয়ারের খরচ আপনি দেবেন। আমরা কুরিয়ার পাঠালে রিফান্ড থেকে **{{returns.pickup_fee}} টাকা** কাটা হবে। ডেলিভারি চার্জ ফেরত হবে না।
- আপনার রিটার্ন অনুমোদনের সময় আমাদের টিম ঠিক করে কোনটি প্রযোজ্য, এবং আপনার রিটার্ন পেজে তা দেখা যায়।

## ৭. কীভাবে ও কখন টাকা ফেরত পাবেন
- ফেরত আসা পণ্য যাচাই হলে ফেরত টাকা আপনার **Explooro ভল্টে** জমা হয়, সাধারণত পণ্য আমাদের কাছে পৌঁছানোর {{company.refund_days}} কর্মদিবসের মধ্যে। ভল্টের টাকা যেকোনো অর্ডারে খরচ করতে পারেন।
- একটি পার্সেলের কয়েকটি পণ্য ফেরত দিলে সেই পণ্যগুলোর টাকা ফেরত পাবেন।
- কুপন ও অফারের ছাড় নগদ টাকায় ফেরত হয় না: পণ্যের জন্য আপনি আসলে যা দিয়েছেন তা-ই ফেরত পাবেন।

## ৮. পার্সেল যদি কখনো না আসে
কুরিয়ার আপনার অর্ডার ডেলিভারি হয়েছে দেখালেও আপনি না পেয়ে থাকলে {{company.not_received_days}} দিনের মধ্যে আমাদের জানান। আমরা কুরিয়ারের সাথে যাচাই করব, এবং আপনার বা আপনার বলে দেওয়া কারো হাতে না পৌঁছালে পুরো টাকা ফেরত দেব বা আবার পাঠাব।

## ৯. ওয়ারেন্টি
- কিছু পণ্যের সাথে সরবরাহকারীর ওয়ারেন্টি থাকে, যা পণ্যের পেজে ও আপনার অ্যাকাউন্টে দেখা যায়। এর মেয়াদ ও কী কী কভার করে তা সরবরাহকারী বা প্রস্তুতকারক ঠিক করেন।
- ওয়ারেন্টির সময়ের মধ্যে আপনার অ্যাকাউন্ট থেকে মেরামত, বদলে দেওয়া বা টাকা ফেরতের দাবি করতে পারেন। ওয়ারেন্টিতে যেমন বলা আছে, সেই অনুযায়ী সরবরাহকারী ঠিক করেন কোনটি হবে।
- ওয়ারেন্টির দায় সরবরাহকারীর। Explooro আপনাকে দাবি করতে সাহায্য করে, যেখানে সম্ভব পণ্য নিয়ে আসার ব্যবস্থা করে, এবং খোঁজ রাখে।
- অপব্যবহার, দুর্ঘটনা, পানি, অনুমোদনহীন মেরামত বা স্বাভাবিক ক্ষয়ে হওয়া ক্ষতি ওয়ারেন্টিতে পড়ে না।

## ১০. ক্যাশ অন ডেলিভারি
যথাযথ কারণ ছাড়া ক্যাশ অন ডেলিভারির পার্সেল ফিরিয়ে দিলে, বা বারবার অর্ডার করে ফিরিয়ে দিলে, আমরা আপনার জন্য ক্যাশ অন ডেলিভারি বন্ধ করতে পারি বা পরের অর্ডারে অগ্রিম চাইতে পারি।

## ১১. রিটার্নের অপব্যবহার
অন্য বা ব্যবহার করা পণ্য ফেরত দেওয়া, বা অনেক মিথ্যা দাবি করার মতো প্রতারণায় রিটার্ন ব্যবহার হতে দেখলে আমরা রিটার্ন বাতিল করতে পারি, আগে দেওয়া রিফান্ড ফেরত নিতে পারি, এবং অ্যাকাউন্ট সীমিত বা বন্ধ করতে পারি।

## ১২. যোগাযোগ
অর্ডারে কোনো সমস্যা হলে আপনার অ্যাকাউন্টের হেল্প বা চ্যাট ব্যবহার করুন, অথবা {{company.support_email}} · {{company.support_phone}}-এ যোগাযোগ করুন।$bn$,
  'Full version written for doing business in Bangladesh.', 'বাংলাদেশে ব্যবসার জন্য লেখা পূর্ণ সংস্করণ।', false
FROM legal_documents
WHERE doc_key = 'refund'
-- WHY HAVING and not WHERE: an aggregate with no GROUP BY returns one row even when WHERE keeps none,
-- which would insert a second version 1.
HAVING NOT EXISTS (SELECT 1 FROM legal_documents WHERE doc_key = 'refund' AND change_note_en = 'Full version written for doing business in Bangladesh.');

INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
SELECT 'partner_agreement', COALESCE(MAX(version), 0) + 1,
  'Explooro Partner Agreement',
  'Explooro শপ পার্টনার চুক্তি',
  $en$This agreement is between you, as an Explooro partner ("you", "partner"), and {{company.legal_name}} ("Explooro", "we", "us"). It adds to our Terms of Use, Privacy Policy and Refund & Return Policy, which also apply to you. If this agreement and the Terms of Use disagree on something about your partnership, this agreement wins.

## 1. Becoming a partner
- You must be at least 18 years old, live in Bangladesh, and give true details about yourself.
- One person may hold only one partner account. A partner account cannot be sold, rented or handed to someone else.
- We may accept or refuse an application, and may ask you to verify your identity before you can withdraw money.

## 2. What an Explooro partner does
- You run an Explooro shop and share products and links with people you know and on social media.
- You do not buy, keep or send stock. The supplier keeps the product and sends the parcel; Explooro takes the payment and handles returns.
- You do not set prices. The supplier sets the price and Explooro adds its own share; everyone sees the same price, whoever they buy through.
- You may order for a customer on their behalf only with their permission, using their real name, phone number and address.

## 3. How you earn
- You earn rewards for the sales and the promotion you bring to Explooro, under the partner reward programme rules in effect at the time.
- Rewards are worked out and paid monthly into your Explooro Vault. We do not promise any fixed amount per sale or per month.
- A sale only counts if the product is active in your shop and the buyer is not you. Orders that are cancelled, refused or returned do not earn.
- We may change the programme rules. A change never takes away rewards already paid for a closed month, except as section 6 allows.

## 4. Withdrawing your money
- You can withdraw your Vault balance to your own bKash, Nagad or bank account, in your own name, after you verify your identity.
- The minimum amount, any withdrawal fee and how long it takes are shown on the withdrawal page before you confirm. Withdrawals may take a few working days and may be sent by hand by our team.
- If we find that a withdrawal was made with money gained by breaking this agreement, we may take it back from your Vault.

## 5. Tax
You are responsible for any tax on what you earn, and for keeping your own records. Where the law requires us to deduct tax at source from your rewards, we will deduct it and show it in your Vault statement.

## 6. How you must promote
- Be honest. Do not make claims about a product that are not in its description, or promise discounts, gifts, warranties or delivery times Explooro does not offer.
- Make it clear when a post is promoting your Explooro shop.
- Do not spam, buy fake followers, likes or clicks, or post in groups or pages where it is not allowed.
- Do not place orders yourself, or ask friends to order and cancel, to earn rewards. Do not use more than one partner account.
- Do not post content that is illegal, hateful, sexually explicit, or that uses other people's photos, music or brands without permission.
- Do not use the Explooro name or logo in a way that makes people think you are Explooro staff, and do not run paid ads using the Explooro name except through Explooro's own ad tools.

If you break these rules we may hold or take back the rewards involved, and suspend or end your partnership. Where we can, we will tell you what was wrong and give you {{company.partner_explain_days}} days to explain before we decide.

## 7. Customers' information
You may see some information about orders made through your shop. Use it only to help those customers with their orders. Do not copy it, sell it, share it or use it to contact people for anything else.

## 8. Your content and your shop
- You own the posts, photos and videos you make. You allow Explooro to show them on the platform and in our own promotion of Explooro, free of charge.
- Your shop name and picture must not copy another brand, include contact details for buying outside Explooro, or break the rules in section 6. We may change or remove them if they do.

## 9. Your status
You are an independent partner, not an employee, agent or legal representative of Explooro. This agreement does not create a job, a partnership firm or a joint venture. You cannot make promises or agreements on Explooro's behalf, and you pay your own costs (internet, phone, travel).

## 10. Our responsibility
We work hard to keep your shop and links working and to work out rewards correctly. If you think a reward is wrong, tell us within {{company.reward_claim_days}} days of it being paid, and we will check it. As far as the law allows, we are not liable for lost earnings caused by the platform being unavailable, or by changes to the programme rules made under section 3.

## 11. Ending the partnership
- You can stop being a partner at any time from your account or by contacting us.
- We may end the partnership with {{company.notice_days}} days' notice, or at once if you break this agreement or the law.
- Money that is yours in your Vault, earned within the rules, stays yours to withdraw. Rewards for the month in which the partnership ends are worked out when that month closes.

## 12. Changes
When we change this agreement in a way that matters, we will ask you to read and agree to the new version before you continue as a partner.

## 13. Law and disputes
This agreement is governed by the laws of Bangladesh. Please contact us first so we can try to solve any problem. If we cannot, the courts of {{company.court_city}} will decide.

## 14. Contact
{{company.legal_name}}, {{company.address}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}
Partner support: {{company.partner_support}}$en$,
  $bn$এই চুক্তি Explooro শপ পার্টনার ("আপনি", "পার্টনার") হিসেবে আপনার এবং {{company.legal_name}} ("Explooro", "আমরা")-এর মধ্যে। এটা আমাদের ব্যবহারের শর্তাবলি, গোপনীয়তা নীতি এবং রিফান্ড ও রিটার্ন নীতির সাথে যুক্ত, যেগুলো আপনার ক্ষেত্রেও প্রযোজ্য। আপনার পার্টনারশিপ নিয়ে কোনো বিষয়ে এই চুক্তি আর ব্যবহারের শর্তাবলি আলাদা কথা বললে, এই চুক্তি প্রাধান্য পাবে।

## ১. পার্টনার হওয়া
- আপনার বয়স কমপক্ষে ১৮ বছর হতে হবে, বাংলাদেশে থাকতে হবে, এবং নিজের সম্পর্কে সত্য তথ্য দিতে হবে।
- একজন মানুষ কেবল একটি পার্টনার অ্যাকাউন্ট রাখতে পারেন। পার্টনার অ্যাকাউন্ট বিক্রি, ভাড়া বা অন্য কাউকে দেওয়া যায় না।
- আমরা আবেদন গ্রহণ বা বাতিল করতে পারি, এবং টাকা তোলার আগে আপনার পরিচয় যাচাই করতে বলতে পারি।

## ২. Explooro শপ পার্টনার কী করেন
- আপনি একটি Explooro শপ চালান এবং পরিচিতদের সাথে ও সোশ্যাল মিডিয়ায় পণ্য ও লিংক শেয়ার করেন।
- আপনি পণ্য কেনেন না, রাখেন না বা পাঠান না। সরবরাহকারী পণ্য রাখেন ও পার্সেল পাঠান; Explooro টাকা নেয় ও রিটার্ন সামলায়।
- আপনি দাম ঠিক করেন না। সরবরাহকারী দাম ঠিক করেন এবং Explooro তার নিজের অংশ যোগ করে; যার মাধ্যমেই কেনা হোক, সবাই একই দাম দেখেন।
- কোনো ক্রেতার হয়ে অর্ডার দিতে পারেন কেবল তাঁর অনুমতি নিয়ে, তাঁর আসল নাম, ফোন নম্বর ও ঠিকানা দিয়ে।

## ৩. আপনি কীভাবে আয় করেন
- আপনি Explooro-তে যে বিক্রি ও প্রচার আনেন তার জন্য, সেই সময়ে কার্যকর শপ পার্টনার পুরস্কার প্রোগ্রামের নিয়ম অনুযায়ী পুরস্কার পান।
- পুরস্কার মাসে একবার হিসাব করে আপনার Explooro ভল্টে দেওয়া হয়। প্রতি বিক্রি বা প্রতি মাসে কোনো নির্দিষ্ট পরিমাণের প্রতিশ্রুতি আমরা দিই না।
- বিক্রি কেবল তখনই গোনা হয় যখন পণ্যটি আপনার শপে চালু আছে এবং ক্রেতা আপনি নিজে নন। বাতিল, ফিরিয়ে দেওয়া বা ফেরত আসা অর্ডারে আয় হয় না।
- আমরা প্রোগ্রামের নিয়ম বদলাতে পারি। ধারা ৬-এ যা বলা আছে তা ছাড়া, কোনো পরিবর্তন শেষ হয়ে যাওয়া মাসের জন্য আগেই দেওয়া পুরস্কার কেড়ে নেয় না।

## ৪. টাকা তোলা
- পরিচয় যাচাইয়ের পর আপনার ভল্টের ব্যালেন্স আপনার নিজের নামে থাকা বিকাশ, নগদ বা ব্যাংক অ্যাকাউন্টে তুলতে পারেন।
- সর্বনিম্ন পরিমাণ, কোনো চার্জ থাকলে তা, এবং কতদিন লাগবে, আপনি নিশ্চিত করার আগে টাকা তোলার পেজে দেখানো হয়। টাকা তুলতে কয়েক কর্মদিবস লাগতে পারে এবং আমাদের টিম হাতে পাঠাতে পারে।
- এই চুক্তি ভেঙে পাওয়া টাকা দিয়ে টাকা তোলা হয়েছে দেখলে আমরা তা আপনার ভল্ট থেকে ফেরত নিতে পারি।

## ৫. কর
আপনার আয়ের ওপর যেকোনো করের দায় এবং নিজের হিসাব রাখার দায় আপনার। আইন যেখানে আপনার পুরস্কার থেকে উৎসে কর কাটতে বলে, সেখানে আমরা তা কেটে আপনার ভল্টের বিবরণীতে দেখাব।

## ৬. কীভাবে প্রচার করবেন
- সৎ থাকুন। পণ্যের বর্ণনায় নেই এমন দাবি করবেন না, বা Explooro দেয় না এমন ছাড়, উপহার, ওয়ারেন্টি বা ডেলিভারির সময়ের প্রতিশ্রুতি দেবেন না।
- কোনো পোস্ট আপনার Explooro শপের প্রচার হলে তা স্পষ্ট রাখুন।
- স্প্যাম করবেন না, ভুয়া ফলোয়ার, লাইক বা ক্লিক কিনবেন না, বা যেসব গ্রুপ বা পেজে অনুমতি নেই সেখানে পোস্ট করবেন না।
- পুরস্কার পেতে নিজে অর্ডার দেবেন না, বা বন্ধুদের অর্ডার করে বাতিল করতে বলবেন না। একাধিক পার্টনার অ্যাকাউন্ট ব্যবহার করবেন না।
- বেআইনি, ঘৃণাপূর্ণ, যৌনতাপূর্ণ কনটেন্ট, বা অনুমতি ছাড়া অন্যের ছবি, গান বা ব্র্যান্ড ব্যবহার করা কনটেন্ট পোস্ট করবেন না।
- Explooro-র নাম বা লোগো এমনভাবে ব্যবহার করবেন না যাতে মানুষ ভাবে আপনি Explooro-র কর্মী, এবং Explooro-র নিজস্ব বিজ্ঞাপন টুল ছাড়া Explooro নাম দিয়ে পেইড বিজ্ঞাপন চালাবেন না।

এই নিয়ম ভাঙলে আমরা সংশ্লিষ্ট পুরস্কার আটকে রাখতে বা ফেরত নিতে পারি, এবং আপনার পার্টনারশিপ স্থগিত বা শেষ করতে পারি। সম্ভব হলে সিদ্ধান্ত নেওয়ার আগে আমরা জানাব কী ভুল হয়েছে এবং ব্যাখ্যা দিতে আপনাকে {{company.partner_explain_days}} দিন সময় দেব।

## ৭. ক্রেতাদের তথ্য
আপনার শপের মাধ্যমে হওয়া অর্ডারের কিছু তথ্য আপনি দেখতে পারেন। তা শুধু সেই ক্রেতাদের অর্ডারে সাহায্য করতে ব্যবহার করুন। কপি, বিক্রি বা শেয়ার করবেন না, বা অন্য কোনো কাজে মানুষের সাথে যোগাযোগ করতে ব্যবহার করবেন না।

## ৮. আপনার কনটেন্ট ও শপ
- আপনার বানানো পোস্ট, ছবি ও ভিডিওর মালিক আপনি। আপনি Explooro-কে বিনা মূল্যে সেগুলো প্ল্যাটফর্মে ও Explooro-র নিজস্ব প্রচারে দেখানোর অনুমতি দিচ্ছেন।
- আপনার শপের নাম ও ছবি অন্য ব্র্যান্ডের নকল হতে পারবে না, Explooro-র বাইরে কেনার জন্য যোগাযোগের তথ্য রাখতে পারবে না, বা ধারা ৬-এর নিয়ম ভাঙতে পারবে না। ভাঙলে আমরা তা বদলে বা সরিয়ে দিতে পারি।

## ৯. আপনার অবস্থান
আপনি একজন স্বাধীন পার্টনার, Explooro-র কর্মী, এজেন্ট বা আইনি প্রতিনিধি নন। এই চুক্তি কোনো চাকরি, অংশীদারি প্রতিষ্ঠান বা যৌথ উদ্যোগ তৈরি করে না। আপনি Explooro-র হয়ে কোনো প্রতিশ্রুতি বা চুক্তি করতে পারেন না, এবং নিজের খরচ (ইন্টারনেট, ফোন, যাতায়াত) নিজে বহন করেন।

## ১০. আমাদের দায়
আপনার শপ ও লিংক চালু রাখতে এবং পুরস্কার সঠিকভাবে হিসাব করতে আমরা চেষ্টা করি। কোনো পুরস্কার ভুল মনে হলে তা দেওয়ার {{company.reward_claim_days}} দিনের মধ্যে আমাদের জানান, আমরা যাচাই করব। আইন যতটা অনুমতি দেয়, প্ল্যাটফর্ম বন্ধ থাকা বা ধারা ৩ অনুযায়ী প্রোগ্রামের নিয়ম বদলানোর কারণে হারানো আয়ের জন্য আমরা দায়ী নই।

## ১১. পার্টনারশিপ শেষ করা
- যেকোনো সময় অ্যাকাউন্ট থেকে বা আমাদের সাথে যোগাযোগ করে আপনি পার্টনারশিপ ছেড়ে দিতে পারেন।
- আমরা {{company.notice_days}} দিনের নোটিশ দিয়ে, অথবা আপনি এই চুক্তি বা আইন ভাঙলে সঙ্গে সঙ্গে পার্টনারশিপ শেষ করতে পারি।
- নিয়মের মধ্যে আয় করা, ভল্টে আপনার যে টাকা আছে তা আপনারই থাকবে এবং তুলতে পারবেন। যে মাসে পার্টনারশিপ শেষ হয়, সেই মাসের পুরস্কার মাস শেষ হলে হিসাব করা হয়।

## ১২. পরিবর্তন
এই চুক্তিতে গুরুত্বপূর্ণ পরিবর্তন হলে পার্টনার হিসেবে চালিয়ে যাওয়ার আগে আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব।

## ১৩. আইন ও বিরোধ
এই চুক্তি বাংলাদেশের আইন দ্বারা পরিচালিত। কোনো সমস্যা হলে আগে আমাদের সাথে যোগাযোগ করুন, যাতে আমরা তা সমাধানের চেষ্টা করতে পারি। না পারলে {{company.court_city}}-র আদালত নিষ্পত্তি করবে।

## ১৪. যোগাযোগ
{{company.legal_name}}, {{company.address}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}
পার্টনার সাপোর্ট: {{company.partner_support}}$bn$,
  'Full version written for doing business in Bangladesh.', 'বাংলাদেশে ব্যবসার জন্য লেখা পূর্ণ সংস্করণ।', true
FROM legal_documents
WHERE doc_key = 'partner_agreement'
-- WHY HAVING and not WHERE: an aggregate with no GROUP BY returns one row even when WHERE keeps none,
-- which would insert a second version 1.
HAVING NOT EXISTS (SELECT 1 FROM legal_documents WHERE doc_key = 'partner_agreement' AND change_note_en = 'Full version written for doing business in Bangladesh.');

INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
SELECT 'supplier_agreement', COALESCE(MAX(version), 0) + 1,
  'Explooro Supplier Agreement',
  'Explooro সরবরাহকারী চুক্তি',
  $en$This agreement is between you, the business selling products on Explooro ("you", "supplier"), and {{company.legal_name}} ("Explooro", "we", "us"). It adds to our Terms of Use, Privacy Policy and Refund & Return Policy, which also apply to you. If this agreement and the Terms of Use disagree on something about selling on Explooro, this agreement wins.

## 1. Becoming a supplier
- You must be a business or a person aged 18 or over, based in Bangladesh, legally allowed to sell the products you list.
- Before you can sell or withdraw money, you must give us true, current details and documents: {{company.supplier_documents}}.
- Tell us within {{company.supplier_details_days}} days if any of these details change.
- We may accept or refuse an application, and may ask for more documents at any time.

## 2. What you are responsible for
- **The product:** you own it, keep it in stock, and are responsible for its quality, safety, legality, labelling, expiry date and warranty.
- **The listing:** the title, description, photos, sizes, variants and stock count you upload must be true and kept up to date. You must have the right to use every photo and brand name you upload.
- **Packing and sending:** you pack each order safely and hand it to the courier, or send it yourself, within {{company.supplier_dispatch_days}} working days of the order.
- **Returns and warranty:** you accept returns and warranty claims as the Refund & Return Policy and your product's warranty describe.

## 3. What Explooro does
- Runs the platform, shows your products to customers, and lets Explooro partners recommend them.
- Takes the customer's payment, holds it safely until the order is delivered and the return window has passed, then pays your share into your Explooro Vault.
- Handles customer support, returns and disputes, and may ask you for information to settle them.
- We may check, edit for clarity, hide or remove a listing that breaks the law or our rules.

## 4. Prices
- You set your **supplier price** for each product. Explooro adds its markup to work out the retail price customers see; the supplier product form shows the retail price before you save. Explooro partners cannot change it.
- You also set the reward offered to Explooro partners for each product, within the limits the product form shows.
- Prices must include VAT where it applies. You may not charge a customer anything beyond what Explooro shows them.
- A price change applies to new orders only. You must not raise a price just before a sale to make a discount look bigger.

## 5. Flash sales and offers
- You may run flash sales on your own products from your supplier account, within the limits shown there. A product must have sold at its current price for the required time first.
- **You pay the discount of a flash sale you create:** your share of each sale goes down by the discount; Explooro's and the partners' shares do not.
- Flash sales and coupons that Explooro creates itself are paid by Explooro, unless we agree otherwise with you in writing.

## 6. Delivery charge
The customer pays the delivery charge shown at checkout. Parcels are sent the way your shipments page shows: booked through the courier Explooro works with, or sent by you with the courier name and tracking number recorded there.

## 7. How and when you are paid
- For each delivered order, your share is the supplier price (less any flash sale discount you funded), shown on the order in your account.
- It is released into your Explooro Vault after the order is delivered and the customer's return window has passed without a return.
- You can withdraw your Vault balance to a bKash, Nagad or bank account in your business's or your own name. The minimum amount, any fee and how long it takes are shown on the withdrawal page before you confirm.

## 8. Returns, refunds and warranty
- When a return is approved because the product was damaged, wrong, faulty, expired or not as described, **you pay** the customer's refund and the cost of sending it back, as the Refund & Return Policy describes. The amount is taken from your share of that order or from your Vault.
- When a customer returns a product because they changed their mind, the customer pays to send it back and you receive the product back.
- You must accept the returned product at your return address and tell us of any problem with it within {{company.supplier_return_check_days}} days of receiving it, or the return is treated as accepted.
- If your Vault cannot cover an amount you owe, it is recovered from your future sales.

## 9. Cancellations and late orders
- If you cannot fill an order, cancel it at once from your account. The customer is refunded in full.
- If you often cancel, send late, or send wrong products, we may lower your products in search, pause your listings, or end this agreement.

## 10. Products you must not sell
- Anything illegal in Bangladesh, fake or copied brands, stolen goods, weapons, drugs, tobacco and alcohol, adult content, and medicines that need a prescription.
- Food, cosmetics and medical items without the licences and labels the law requires, or past their expiry date.

## 11. Customers' information
You receive the customer's name, phone number and address only to send their order. Use it for nothing else. Do not copy it, sell it, share it, or contact customers to sell outside Explooro.

## 12. Selling outside Explooro
You may not ask a customer who found you on Explooro to pay or order outside Explooro, or put your own phone number, page or website in a listing, parcel or message for that purpose.

## 13. Your content and our name
- You allow Explooro, free of charge, to show, resize and adapt your product photos and descriptions on the platform and in our own promotion of your products and of Explooro.
- You may say that you sell on Explooro, but you may not use the Explooro name or logo in any other way without our written permission.

## 14. Tax and invoices
You are responsible for your own VAT, income tax and business records. Where the law requires us to deduct tax at source from what we pay you, we will deduct it and show it in your Vault statement.

## 15. Your status
You are an independent business, not an employee, agent or partner of Explooro. You cannot make promises or agreements on Explooro's behalf.

## 16. Responsibility and claims
- You are responsible for any claim, fine or loss caused by your products, your listings or your breaking this agreement or the law, and you will cover Explooro's reasonable costs from such a claim.
- As far as the law allows, Explooro is not liable for lost sales or profit caused by the platform being unavailable, or by a courier or payment company.

## 17. Ending the agreement
- You can stop selling at any time by giving {{company.notice_days}} days' notice and filling every open order.
- We may end the agreement with {{company.notice_days}} days' notice, or at once if you break it or the law.
- Money that is yours in your Vault is paid out once every open order, return and warranty claim is settled, less anything you owe.

## 18. Changes
When we change this agreement in a way that matters, we will ask you to read and agree to the new version before you continue selling. Changes to the settings this agreement points to (such as the markup or the flash sale limits) apply to new prices and new orders.

## 19. Law and disputes
This agreement is governed by the laws of Bangladesh. Please contact us first so we can try to solve any problem. If we cannot, the courts of {{company.court_city}} will decide.

## 20. Contact
{{company.legal_name}}, {{company.address}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}
Supplier support: {{company.supplier_support}}$en$,
  $bn$এই চুক্তি Explooro-তে পণ্য বিক্রি করা ব্যবসা ("আপনি", "সরবরাহকারী") এবং {{company.legal_name}} ("Explooro", "আমরা")-এর মধ্যে। এটা আমাদের ব্যবহারের শর্তাবলি, গোপনীয়তা নীতি এবং রিফান্ড ও রিটার্ন নীতির সাথে যুক্ত, যেগুলো আপনার ক্ষেত্রেও প্রযোজ্য। Explooro-তে বিক্রি নিয়ে কোনো বিষয়ে এই চুক্তি আর ব্যবহারের শর্তাবলি আলাদা কথা বললে, এই চুক্তি প্রাধান্য পাবে।

## ১. সরবরাহকারী হওয়া
- আপনাকে বাংলাদেশভিত্তিক একটি ব্যবসা বা ১৮ বছর বা তার বেশি বয়সী একজন মানুষ হতে হবে, যিনি তালিকাভুক্ত পণ্য আইনসঙ্গতভাবে বিক্রি করতে পারেন।
- বিক্রি করার বা টাকা তোলার আগে আপনাকে সত্য ও হালনাগাদ তথ্য ও কাগজপত্র দিতে হবে: {{company.supplier_documents}}।
- এই তথ্যের কোনোটি বদলালে {{company.supplier_details_days}} দিনের মধ্যে আমাদের জানান।
- আমরা আবেদন গ্রহণ বা বাতিল করতে পারি, এবং যেকোনো সময় আরও কাগজপত্র চাইতে পারি।

## ২. আপনার দায়িত্ব
- **পণ্য:** আপনি এর মালিক, স্টকে রাখেন, এবং এর মান, নিরাপত্তা, বৈধতা, লেবেল, মেয়াদ ও ওয়ারেন্টির দায় আপনার।
- **লিস্টিং:** আপনার আপলোড করা নাম, বর্ণনা, ছবি, সাইজ, ভ্যারিয়েন্ট ও স্টকের সংখ্যা সত্য ও হালনাগাদ রাখতে হবে। আপলোড করা প্রতিটি ছবি ও ব্র্যান্ডের নাম ব্যবহারের অধিকার আপনার থাকতে হবে।
- **প্যাক করা ও পাঠানো:** প্রতিটি অর্ডার অর্ডারের {{company.supplier_dispatch_days}} কর্মদিবসের মধ্যে নিরাপদে প্যাক করে কুরিয়ারকে দেবেন, বা নিজে পাঠাবেন।
- **রিটার্ন ও ওয়ারেন্টি:** রিফান্ড ও রিটার্ন নীতি এবং আপনার পণ্যের ওয়ারেন্টিতে যেমন বলা আছে, সেই অনুযায়ী রিটার্ন ও ওয়ারেন্টি দাবি মেনে নেবেন।

## ৩. Explooro কী করে
- প্ল্যাটফর্ম চালায়, ক্রেতাদের আপনার পণ্য দেখায়, এবং Explooro শপ পার্টনারদের সেগুলোর সুপারিশ করতে দেয়।
- ক্রেতার টাকা নেয়, অর্ডার ডেলিভারি হয়ে রিটার্নের সময় পার না হওয়া পর্যন্ত নিরাপদে জমা রাখে, তারপর আপনার অংশ আপনার Explooro ভল্টে দেয়।
- ক্রেতার সাপোর্ট, রিটার্ন ও বিরোধ সামলায়, এবং তা মেটাতে আপনার কাছে তথ্য চাইতে পারে।
- আইন বা আমাদের নিয়ম ভাঙে এমন লিস্টিং আমরা যাচাই করতে, স্পষ্ট করতে সম্পাদনা করতে, লুকাতে বা সরাতে পারি।

## ৪. দাম
- প্রতিটি পণ্যের **সরবরাহকারীর দাম** আপনি ঠিক করেন। Explooro তার সাথে নিজের মার্কআপ যোগ করে ক্রেতাদের দেখানো খুচরা দাম ঠিক করে; সেভ করার আগে সরবরাহকারীর পণ্যের ফর্মে খুচরা দাম দেখা যায়। Explooro শপ পার্টনাররা তা বদলাতে পারেন না।
- প্রতিটি পণ্যের জন্য Explooro শপ পার্টনারদের পুরস্কারও আপনি ঠিক করেন, পণ্যের ফর্মে দেখানো সীমার মধ্যে।
- প্রযোজ্য ক্ষেত্রে দাম ভ্যাটসহ হতে হবে। Explooro ক্রেতাকে যা দেখায় তার বাইরে আপনি ক্রেতার কাছে কিছু চাইতে পারবেন না।
- দামের পরিবর্তন কেবল নতুন অর্ডারে প্রযোজ্য। ছাড় বড় দেখাতে সেলের ঠিক আগে দাম বাড়ানো যাবে না।

## ৫. ফ্ল্যাশ সেল ও অফার
- আপনার সরবরাহকারী অ্যাকাউন্ট থেকে সেখানে দেখানো সীমার মধ্যে নিজের পণ্যে ফ্ল্যাশ সেল চালাতে পারেন। তার আগে পণ্যটি বর্তমান দামে নির্ধারিত সময় ধরে বিক্রি হতে হবে।
- **আপনার তৈরি ফ্ল্যাশ সেলের ছাড় আপনি দেন:** প্রতিটি বিক্রিতে আপনার অংশ ছাড়ের পরিমাণে কমে; Explooro-র ও শপ পার্টনারদের অংশ কমে না।
- Explooro নিজে যেসব ফ্ল্যাশ সেল ও কুপন তৈরি করে তার খরচ Explooro দেয়, যদি না আপনার সাথে লিখিতভাবে অন্য কিছু ঠিক হয়।

## ৬. ডেলিভারি চার্জ
চেকআউটে দেখানো ডেলিভারি চার্জ ক্রেতা দেন। পার্সেল আপনার শিপমেন্ট পেজে যেভাবে দেখানো আছে সেভাবে পাঠানো হয়: Explooro-র সাথে কাজ করা কুরিয়ারে বুক করে, অথবা আপনি নিজে পাঠিয়ে সেখানে কুরিয়ারের নাম ও ট্র্যাকিং নম্বর লিখে।

## ৭. কীভাবে ও কখন টাকা পান
- প্রতিটি ডেলিভারি হওয়া অর্ডারে আপনার অংশ হলো সরবরাহকারীর দাম (আপনার দেওয়া ফ্ল্যাশ সেলের ছাড় বাদে), যা আপনার অ্যাকাউন্টে অর্ডারের পাশে দেখা যায়।
- অর্ডার ডেলিভারি হয়ে ক্রেতার রিটার্নের সময় কোনো রিটার্ন ছাড়া পার হলে তা আপনার Explooro ভল্টে আসে।
- ভল্টের ব্যালেন্স আপনার ব্যবসার বা আপনার নিজের নামে থাকা বিকাশ, নগদ বা ব্যাংক অ্যাকাউন্টে তুলতে পারেন। সর্বনিম্ন পরিমাণ, কোনো চার্জ থাকলে তা, এবং কতদিন লাগবে, নিশ্চিত করার আগে টাকা তোলার পেজে দেখানো হয়।

## ৮. রিটার্ন, রিফান্ড ও ওয়ারেন্টি
- পণ্য ভাঙা, ভুল, ত্রুটিপূর্ণ, মেয়াদোত্তীর্ণ বা বর্ণনার সাথে না মেলায় রিটার্ন অনুমোদন হলে, রিফান্ড ও রিটার্ন নীতি অনুযায়ী ক্রেতার রিফান্ড ও ফেরত পাঠানোর খরচ **আপনি দেন**। সেই অর্ডারে আপনার অংশ থেকে বা আপনার ভল্ট থেকে তা কাটা হয়।
- ক্রেতা মত বদলে পণ্য ফেরত দিলে ফেরত পাঠানোর খরচ ক্রেতা দেন, এবং পণ্যটি আপনার কাছে ফিরে আসে।
- ফেরত আসা পণ্য আপনার রিটার্নের ঠিকানায় গ্রহণ করতে হবে এবং পাওয়ার {{company.supplier_return_check_days}} দিনের মধ্যে কোনো সমস্যা থাকলে জানাতে হবে, নইলে রিটার্নটি গৃহীত বলে ধরা হবে।
- আপনার পাওনা কোনো টাকা ভল্টে না থাকলে তা আপনার ভবিষ্যৎ বিক্রি থেকে আদায় করা হয়।

## ৯. বাতিল ও দেরির অর্ডার
- কোনো অর্ডার পূরণ করতে না পারলে সঙ্গে সঙ্গে অ্যাকাউন্ট থেকে বাতিল করুন। ক্রেতা পুরো টাকা ফেরত পান।
- বারবার বাতিল করলে, দেরিতে পাঠালে বা ভুল পণ্য পাঠালে আমরা সার্চে আপনার পণ্য নিচে নামাতে, লিস্টিং বন্ধ রাখতে বা এই চুক্তি শেষ করতে পারি।

## ১০. যেসব পণ্য বিক্রি করা যাবে না
- বাংলাদেশে বেআইনি যেকোনো কিছু, নকল ব্র্যান্ড, চুরি করা পণ্য, অস্ত্র, মাদক, তামাক ও মদ, প্রাপ্তবয়স্কদের কনটেন্ট, এবং প্রেসক্রিপশন লাগে এমন ওষুধ।
- আইন যে লাইসেন্স ও লেবেল চায় তা ছাড়া, বা মেয়াদ পার হওয়া খাবার, প্রসাধনী ও চিকিৎসা সামগ্রী।

## ১১. ক্রেতাদের তথ্য
ক্রেতার নাম, ফোন নম্বর ও ঠিকানা আপনি পান শুধু তাঁর অর্ডার পাঠাতে। অন্য কোনো কাজে ব্যবহার করবেন না। কপি, বিক্রি বা শেয়ার করবেন না, বা Explooro-র বাইরে বিক্রির জন্য ক্রেতার সাথে যোগাযোগ করবেন না।

## ১২. Explooro-র বাইরে বিক্রি
Explooro-তে আপনাকে খুঁজে পাওয়া কোনো ক্রেতাকে Explooro-র বাইরে টাকা দিতে বা অর্ডার করতে বলতে পারবেন না, বা সেই উদ্দেশ্যে লিস্টিং, পার্সেল বা মেসেজে নিজের ফোন নম্বর, পেজ বা ওয়েবসাইট দিতে পারবেন না।

## ১৩. আপনার কনটেন্ট ও আমাদের নাম
- আপনি Explooro-কে বিনা মূল্যে আপনার পণ্যের ছবি ও বর্ণনা প্ল্যাটফর্মে এবং আপনার পণ্য ও Explooro-র নিজস্ব প্রচারে দেখানো, ছোট-বড় করা ও প্রয়োজনমতো সাজানোর অনুমতি দিচ্ছেন।
- আপনি Explooro-তে বিক্রি করেন বলতে পারেন, তবে আমাদের লিখিত অনুমতি ছাড়া Explooro নাম বা লোগো অন্য কোনোভাবে ব্যবহার করতে পারবেন না।

## ১৪. কর ও ইনভয়েস
আপনার নিজের ভ্যাট, আয়কর ও ব্যবসার হিসাবের দায় আপনার। আইন যেখানে আপনাকে দেওয়া টাকা থেকে উৎসে কর কাটতে বলে, সেখানে আমরা তা কেটে আপনার ভল্টের বিবরণীতে দেখাব।

## ১৫. আপনার অবস্থান
আপনি একটি স্বাধীন ব্যবসা, Explooro-র কর্মী, এজেন্ট বা অংশীদার নন। আপনি Explooro-র হয়ে কোনো প্রতিশ্রুতি বা চুক্তি করতে পারেন না।

## ১৬. দায় ও দাবি
- আপনার পণ্য, লিস্টিং, বা এই চুক্তি বা আইন ভাঙার কারণে হওয়া যেকোনো দাবি, জরিমানা বা ক্ষতির দায় আপনার, এবং এমন দাবিতে Explooro-র যুক্তিসঙ্গত খরচ আপনি বহন করবেন।
- আইন যতটা অনুমতি দেয়, প্ল্যাটফর্ম বন্ধ থাকা বা কোনো কুরিয়ার বা পেমেন্ট কোম্পানির কারণে হারানো বিক্রি বা লাভের জন্য Explooro দায়ী নয়।

## ১৭. চুক্তি শেষ করা
- {{company.notice_days}} দিনের নোটিশ দিয়ে এবং সব চলমান অর্ডার পূরণ করে আপনি যেকোনো সময় বিক্রি বন্ধ করতে পারেন।
- আমরা {{company.notice_days}} দিনের নোটিশ দিয়ে, অথবা আপনি এই চুক্তি বা আইন ভাঙলে সঙ্গে সঙ্গে চুক্তি শেষ করতে পারি।
- সব চলমান অর্ডার, রিটার্ন ও ওয়ারেন্টি দাবি মিটে গেলে, আপনার পাওনা বাদ দিয়ে, ভল্টে আপনার টাকা আপনাকে দেওয়া হয়।

## ১৮. পরিবর্তন
এই চুক্তিতে গুরুত্বপূর্ণ পরিবর্তন হলে বিক্রি চালিয়ে যাওয়ার আগে আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব। এই চুক্তিতে উল্লেখ করা সেটিংসের পরিবর্তন (যেমন মার্কআপ বা ফ্ল্যাশ সেলের সীমা) নতুন দাম ও নতুন অর্ডারে প্রযোজ্য।

## ১৯. আইন ও বিরোধ
এই চুক্তি বাংলাদেশের আইন দ্বারা পরিচালিত। কোনো সমস্যা হলে আগে আমাদের সাথে যোগাযোগ করুন, যাতে আমরা তা সমাধানের চেষ্টা করতে পারি। না পারলে {{company.court_city}}-র আদালত নিষ্পত্তি করবে।

## ২০. যোগাযোগ
{{company.legal_name}}, {{company.address}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}
সরবরাহকারী সাপোর্ট: {{company.supplier_support}}$bn$,
  'Full version written for doing business in Bangladesh.', 'বাংলাদেশে ব্যবসার জন্য লেখা পূর্ণ সংস্করণ।', true
FROM legal_documents
WHERE doc_key = 'supplier_agreement'
-- WHY HAVING and not WHERE: an aggregate with no GROUP BY returns one row even when WHERE keeps none,
-- which would insert a second version 1.
HAVING NOT EXISTS (SELECT 1 FROM legal_documents WHERE doc_key = 'supplier_agreement' AND change_note_en = 'Full version written for doing business in Bangladesh.');
