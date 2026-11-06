-- 104_legal_documents.sql — Prompt 12.6 req 7: terms, privacy, refund policy and Explooro partner
-- agreement, present and version-tracked, with re-acceptance prompts.
--
-- legal_documents holds every published version of every document. A version is never edited or
-- deleted once published (trigger below): what a person agreed to must stay readable exactly as it
-- was. A change is a new version. `requires_reacceptance` says whether that change asks everyone to
-- agree again (a material change) or only replaces the text people read (a typo, a new address).
--
-- legal_acceptances is one row per person per version they agreed to, with when, and from which IP
-- and browser. Written only by services/legal.service.ts.
--
-- Bodies use a small text format (## heading, paragraphs, "- " list items) and {{tokens}} the
-- service fills in when it serves the text: {{company.*}} from the `legal.company` setting (edited
-- at /admin/platform/legal) and {{returns.window_days}} from the returns_engine module. WHY tokens:
-- the company's address or the return window are configuration; written into the text they would
-- drift from what the platform actually does.

CREATE TABLE IF NOT EXISTS legal_documents (
  id                     BIGSERIAL PRIMARY KEY,
  doc_key                TEXT NOT NULL CHECK (doc_key IN ('terms', 'privacy', 'refund', 'partner_agreement')),
  version                INTEGER NOT NULL CHECK (version >= 1),
  title_en               TEXT NOT NULL,
  title_bn               TEXT NOT NULL,
  body_en                TEXT NOT NULL,
  body_bn                TEXT NOT NULL,
  change_note_en         TEXT,
  change_note_bn         TEXT,
  requires_reacceptance  BOOLEAN NOT NULL DEFAULT true,
  published_by           BIGINT REFERENCES users(id),
  published_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_key, version)
);

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id  BIGINT NOT NULL REFERENCES legal_documents(id),
  doc_key      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           TEXT,
  user_agent   TEXT,
  UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON legal_acceptances (user_id, doc_key, version DESC);
CREATE INDEX IF NOT EXISTS legal_acceptances_document_idx ON legal_acceptances (document_id);

-- WHY a trigger and not only service code: an UPDATE from psql, a script or a future endpoint would
-- silently rewrite what thousands of people agreed to. The database refuses it whoever asks.
CREATE OR REPLACE FUNCTION legal_documents_immutable() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'legal_documents rows are immutable; publish a new version instead';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS legal_documents_no_update ON legal_documents;
CREATE TRIGGER legal_documents_no_update
  BEFORE UPDATE OR DELETE ON legal_documents
  FOR EACH ROW EXECUTE FUNCTION legal_documents_immutable();

-- The company details the documents name. Empty until the owner fills them at /admin/platform/legal;
-- the admin page warns while any is empty. An existing row wins.
INSERT INTO platform_settings (key, value_json, value_type, group_key, label_en, label_bn)
VALUES (
  'legal.company',
  '{"legal_name": "", "trade_license": "", "address_en": "", "address_bn": "", "support_email": "", "support_phone": ""}'::jsonb,
  'OBJECT',
  'legal',
  'Company details shown in the legal documents',
  'আইনি নথিতে দেখানো কোম্পানির তথ্য'
)
ON CONFLICT (key) DO NOTHING;

-- Version 1 of each document. WHY seeded here: the platform may not open without them, and a
-- migration is the one place that runs on every database exactly once.
-- NOTE: drafted from what the code does as of 2026-11-06. Have a Bangladeshi lawyer review the
-- text before launch; publish their edits as version 2 at /admin/platform/legal.
INSERT INTO legal_documents (doc_key, version, title_en, title_bn, body_en, body_bn, change_note_en, change_note_bn, requires_reacceptance)
VALUES
(
  'terms', 1,
  'Terms of Use',
  'ব্যবহারের শর্তাবলি',
  $en$These terms are an agreement between you and {{company.legal_name}} ("Explooro", "we"), which runs the Explooro website and app. By creating an account or placing an order you agree to them. If you do not agree, please do not use Explooro.

## 1. Who can use Explooro
- You must be at least 18 years old, or use Explooro with a parent or guardian who agrees to these terms for you.
- One person, one account. The details you give us (name, mobile number, addresses) must be true and your own.
- You are responsible for everything done from your account. Keep your password and the codes we send you private. Tell us at once if you think someone else has used your account.

## 2. How Explooro works
- **Suppliers** own and keep the products, set their price, and pack and send your parcel.
- **Explooro partners** recommend products through their Explooro shop and links. They do not keep stock and do not set prices.
- **Explooro** runs the platform, shows prices, takes your payment and holds it safely until your order is delivered and the return window has passed, then pays the supplier and the partner.

## 3. Prices and orders
- The price you see includes everything except the delivery charge, which is shown at checkout before you confirm. It depends on your delivery district.
- An order is placed when you see the order confirmation. A supplier or Explooro may cancel an order that cannot be filled (for example, the item is out of stock or the price was shown wrongly). If you already paid, the money is returned to your Explooro Vault.
- We may limit the quantity one person can buy, especially in flash sales and team purchases.

## 4. Paying
- You can pay cash on delivery, or from your Explooro Vault. Online methods (bKash, Nagad, cards) are offered only when they are available at checkout.
- For cash on delivery we may ask you to confirm the order with a code sent to your phone, or ask for a small advance, to stop fake orders.
- Your **Explooro Vault** is your balance on Explooro. Refunds, referral earnings and money you add go there. As a customer you can spend it on orders and ads; Explooro partners and suppliers can also withdraw it as described in their own agreement. Vault money does not earn interest.

## 5. Delivery
- We show an expected delivery time at checkout. It is an estimate, not a promise; weather, holidays and courier delays can change it.
- Please check your parcel when it arrives. If something is wrong, follow the Refund & Return Policy.

## 6. Returns and refunds
Returns, refunds and warranty claims follow our Refund & Return Policy, which is part of these terms.

## 7. What you must not do
- Place fake orders, refuse parcels on purpose, or use someone else's details or payment method.
- Create several accounts to collect rewards, referral earnings or coupons more than once.
- Post anything illegal, hateful, misleading, sexually explicit or that belongs to someone else, in reviews, community posts, chat, ads or shop pages.
- Try to break, overload, copy or get around the security of the platform.

If you do, we may cancel orders, take back rewards or earnings gained that way, and limit or close your account.

## 8. Your content
You own the reviews, posts and photos you add. You allow Explooro to show them on the platform and in our own promotion of Explooro. You can delete your posts; copies already shared may take a while to disappear.

## 9. Our responsibility
- We work hard to keep Explooro running and the information on it correct, but we cannot promise it will always be available or free of mistakes.
- The supplier is responsible for the product itself (its quality, safety and description). Explooro is responsible for running the platform and handling your money as these terms describe.
- As far as the law allows, we are not liable for indirect losses, such as lost profit, and our total liability for an order is limited to what you paid for it. Nothing here removes rights you have under the Consumer Rights Protection Act, 2009 or other law of Bangladesh.

## 10. Closing an account
You can ask us to close your account at any time. We may suspend or close an account that breaks these terms. Money that is yours in your Vault stays yours, except amounts gained by breaking these terms.

## 11. Changes to these terms
We may change these terms. When a change matters, we will ask you to read and agree to the new version the next time you use Explooro. Each version shows its number and the date it took effect.

## 12. Law and disputes
These terms are governed by the laws of Bangladesh. Please contact us first so we can try to solve any problem. If we cannot, the courts of Dhaka will decide.

## 13. Contact
{{company.legal_name}}
{{company.address}}
Trade licence: {{company.trade_license}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}$en$,
  $bn$এই শর্তাবলি আপনার এবং {{company.legal_name}} ("Explooro", "আমরা")-এর মধ্যে একটি চুক্তি। আমরা Explooro ওয়েবসাইট ও অ্যাপ পরিচালনা করি। অ্যাকাউন্ট খুললে বা অর্ডার করলে আপনি এই শর্তাবলিতে সম্মত হচ্ছেন। সম্মত না হলে অনুগ্রহ করে Explooro ব্যবহার করবেন না।

## ১. কারা Explooro ব্যবহার করতে পারবেন
- আপনার বয়স অন্তত ১৮ বছর হতে হবে, অথবা এমন একজন বাবা-মা বা অভিভাবকের সাথে ব্যবহার করতে হবে যিনি আপনার পক্ষে এই শর্তাবলিতে সম্মত।
- একজন মানুষ, একটি অ্যাকাউন্ট। আপনার দেওয়া তথ্য (নাম, মোবাইল নম্বর, ঠিকানা) সত্য ও আপনার নিজের হতে হবে।
- আপনার অ্যাকাউন্ট থেকে যা কিছু করা হয় তার দায় আপনার। পাসওয়ার্ড আর আমাদের পাঠানো কোড কাউকে দেবেন না। অন্য কেউ আপনার অ্যাকাউন্ট ব্যবহার করেছে মনে হলে সঙ্গে সঙ্গে আমাদের জানান।

## ২. Explooro কীভাবে কাজ করে
- **সরবরাহকারী** পণ্যের মালিক, পণ্য নিজের কাছে রাখেন, দাম ঠিক করেন এবং আপনার পার্সেল প্যাক করে পাঠান।
- **Explooro শপ পার্টনার** তাঁদের Explooro শপ ও লিংকের মাধ্যমে পণ্যের সুপারিশ করেন। তাঁরা পণ্য মজুত রাখেন না এবং দাম ঠিক করেন না।
- **Explooro** প্ল্যাটফর্ম চালায়, দাম দেখায়, আপনার টাকা নেয় এবং অর্ডার ডেলিভারি হয়ে রিটার্নের সময় পার না হওয়া পর্যন্ত টাকা নিরাপদে জমা রাখে, তারপর সরবরাহকারী ও পার্টনারকে টাকা দেয়।

## ৩. দাম ও অর্ডার
- যে দাম দেখেন তাতে ডেলিভারি চার্জ ছাড়া সব ধরা আছে। ডেলিভারি চার্জ আপনার জেলার উপর নির্ভর করে এবং নিশ্চিত করার আগে চেকআউটে দেখানো হয়।
- অর্ডার নিশ্চিতকরণ দেখলে অর্ডার হয়েছে বলে ধরা হবে। যে অর্ডার পূরণ করা সম্ভব নয় (যেমন পণ্য শেষ, বা দাম ভুল দেখানো হয়েছিল) সরবরাহকারী বা Explooro তা বাতিল করতে পারে। আগে টাকা দিয়ে থাকলে টাকা আপনার Explooro ভল্টে ফেরত যাবে।
- একজন কতগুলো কিনতে পারবেন তা আমরা সীমিত করতে পারি, বিশেষ করে ফ্ল্যাশ সেল ও টিম পারচেজে।

## ৪. পেমেন্ট
- আপনি ক্যাশ অন ডেলিভারিতে বা আপনার Explooro ভল্ট থেকে পেমেন্ট করতে পারেন। অনলাইন পদ্ধতি (বিকাশ, নগদ, কার্ড) কেবল তখনই দেখানো হবে যখন চেকআউটে সেগুলো চালু থাকবে।
- ভুয়া অর্ডার ঠেকাতে ক্যাশ অন ডেলিভারির ক্ষেত্রে আমরা আপনার ফোনে পাঠানো কোড দিয়ে অর্ডার নিশ্চিত করতে বলতে পারি, বা অল্প অগ্রিম চাইতে পারি।
- **Explooro ভল্ট** হলো Explooro-তে আপনার ব্যালেন্স। ফেরত টাকা, রেফারেলের আয় আর আপনার যোগ করা টাকা এখানে জমা হয়। ক্রেতা হিসেবে আপনি এটা অর্ডার ও বিজ্ঞাপনে খরচ করতে পারেন; শপ পার্টনার ও সরবরাহকারীরা তাঁদের নিজস্ব চুক্তি অনুযায়ী টাকা তুলতেও পারেন। ভল্টের টাকায় কোনো সুদ হয় না।

## ৫. ডেলিভারি
- চেকআউটে আমরা সম্ভাব্য ডেলিভারির সময় দেখাই। এটা একটা অনুমান, প্রতিশ্রুতি নয়; আবহাওয়া, ছুটি বা কুরিয়ারের দেরিতে তা বদলাতে পারে।
- পার্সেল পৌঁছালে দেখে নিন। কিছু ভুল থাকলে রিফান্ড ও রিটার্ন নীতি অনুযায়ী জানান।

## ৬. রিটার্ন ও রিফান্ড
রিটার্ন, রিফান্ড ও ওয়ারেন্টি দাবি আমাদের রিফান্ড ও রিটার্ন নীতি অনুযায়ী হবে। সেই নীতি এই শর্তাবলিরই অংশ।

## ৭. যা করা যাবে না
- ভুয়া অর্ডার দেওয়া, ইচ্ছা করে পার্সেল ফিরিয়ে দেওয়া, বা অন্যের তথ্য বা পেমেন্ট পদ্ধতি ব্যবহার করা।
- পুরস্কার, রেফারেলের আয় বা কুপন একাধিকবার নিতে একাধিক অ্যাকাউন্ট খোলা।
- রিভিউ, কমিউনিটি পোস্ট, চ্যাট, বিজ্ঞাপন বা শপ পেজে বেআইনি, ঘৃণা ছড়ানো, বিভ্রান্তিকর, অশ্লীল বা অন্যের মালিকানাধীন কিছু দেওয়া।
- প্ল্যাটফর্ম নষ্ট করা, অতিরিক্ত চাপ দেওয়া, কপি করা বা নিরাপত্তা এড়ানোর চেষ্টা করা।

এমন করলে আমরা অর্ডার বাতিল করতে পারি, এভাবে পাওয়া পুরস্কার বা আয় ফেরত নিতে পারি, এবং অ্যাকাউন্ট সীমিত বা বন্ধ করতে পারি।

## ৮. আপনার কনটেন্ট
আপনার দেওয়া রিভিউ, পোস্ট ও ছবির মালিক আপনি। আপনি Explooro-কে সেগুলো প্ল্যাটফর্মে এবং Explooro-র নিজস্ব প্রচারে দেখানোর অনুমতি দিচ্ছেন। আপনি নিজের পোস্ট মুছতে পারেন; আগে শেয়ার হওয়া কপি সরে যেতে কিছু সময় লাগতে পারে।

## ৯. আমাদের দায়
- Explooro চালু রাখতে ও এর তথ্য সঠিক রাখতে আমরা সর্বোচ্চ চেষ্টা করি, তবে এটা সবসময় চালু থাকবে বা কোনো ভুল থাকবে না, এমন প্রতিশ্রুতি দিতে পারি না।
- পণ্যের মান, নিরাপত্তা ও বর্ণনার দায় সরবরাহকারীর। প্ল্যাটফর্ম চালানো এবং এই শর্তাবলি অনুযায়ী আপনার টাকা সামলানোর দায় Explooro-র।
- আইন যতদূর অনুমতি দেয়, পরোক্ষ ক্ষতির (যেমন লাভের ক্ষতি) জন্য আমরা দায়ী নই, এবং কোনো অর্ডারের জন্য আমাদের মোট দায় আপনি সেই অর্ডারে যা দিয়েছেন তার মধ্যে সীমিত। ভোক্তা-অধিকার সংরক্ষণ আইন, ২০০৯ বা বাংলাদেশের অন্য কোনো আইনে আপনার যে অধিকার আছে, এখানে কিছুই তা কেড়ে নেয় না।

## ১০. অ্যাকাউন্ট বন্ধ করা
আপনি যেকোনো সময় অ্যাকাউন্ট বন্ধ করতে বলতে পারেন। এই শর্তাবলি ভাঙলে আমরা অ্যাকাউন্ট স্থগিত বা বন্ধ করতে পারি। আপনার ভল্টে আপনার যে টাকা আছে তা আপনারই থাকবে, শর্ত ভেঙে পাওয়া অংশ ছাড়া।

## ১১. শর্তাবলি পরিবর্তন
আমরা এই শর্তাবলি বদলাতে পারি। গুরুত্বপূর্ণ পরিবর্তন হলে পরের বার Explooro ব্যবহারের সময় আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব। প্রতিটি সংস্করণে তার নম্বর ও কার্যকর হওয়ার তারিখ দেখানো থাকে।

## ১২. আইন ও বিরোধ
এই শর্তাবলি বাংলাদেশের আইন অনুযায়ী চলবে। কোনো সমস্যা হলে আগে আমাদের জানান, যাতে আমরা সমাধানের চেষ্টা করতে পারি। না হলে ঢাকার আদালত সিদ্ধান্ত দেবেন।

## ১৩. যোগাযোগ
{{company.legal_name}}
{{company.address}}
ট্রেড লাইসেন্স: {{company.trade_license}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}$bn$,
  'First version.', 'প্রথম সংস্করণ।', true
),
(
  'privacy', 1,
  'Privacy Policy',
  'গোপনীয়তা নীতি',
  $en$This policy explains what information {{company.legal_name}} ("Explooro", "we") collects when you use Explooro, why, who we share it with, and the choices you have.

## 1. What we collect
- **Account details:** your name, mobile number, email if you give it, password (stored only in a form nobody can read back), and your role (customer, Explooro partner, supplier).
- **Delivery details:** the names, phone numbers and addresses you save or type at checkout.
- **Orders and payments:** what you bought, what you paid and how, refunds, and your Vault transactions. We do not store card numbers; a card payment is handled by the payment company.
- **Identity checks:** if you become an Explooro partner or supplier and withdraw money, the identity documents you upload, and your bKash, Nagad or bank details for withdrawals.
- **If an Explooro partner orders for you:** the name, phone number and address they give us. We open an account in your name so the order shows in your own history.
- **What you add:** reviews, community posts, chat messages, photos and shop pages.
- **How you use Explooro:** products you view, search for and click, and the device, browser and IP address you use. We use this to show products you are more likely to want and to spot fraud.

## 2. Why we use it
- To create your account, sign you in and send you security codes.
- To take your order, deliver it, handle returns, and pay suppliers and Explooro partners.
- To stop fake orders and fraud, for example by asking for a code before a cash-on-delivery order.
- To show you products, offers and ads that suit you.
- To answer you when you contact us, and to tell you about your orders.
- To meet our legal duties, such as keeping transaction records.

## 3. Who we share it with
- **The supplier** of your order gets the name, phone number and address needed to send the parcel.
- **Courier companies** get what they need to deliver it.
- **The Explooro partner** whose shop or link you bought from sees which products were ordered through them, not your phone number or address.
- **Service providers** who work for us: the SMS company that sends your codes, payment companies, hosting and storage. They may use your information only to do that work.
- **Authorities**, when the law requires it or to protect people from fraud or harm.

We do not sell your personal information.

## 4. How long we keep it
- Behaviour data (views, clicks, searches) is deleted automatically after a limited period set by our data retention settings.
- Orders, payments and Vault transactions are kept as long as the law requires us to keep business records.
- Account details are kept while your account is open, and for a limited time after it is closed to settle any order or dispute.

## 5. Keeping it safe
Passwords are stored only in hashed form. Sensitive details, such as your date of birth, are encrypted. Staff see only what their job needs, and every staff action on your account is recorded. No system is perfectly secure; if a breach affects you, we will tell you.

## 6. Your choices
- You can see and correct your profile and addresses in your account at any time.
- You can turn off marketing messages in your notification settings.
- To get a copy of your information, or to have your account closed and your information deleted (except what the law makes us keep), contact us at {{company.support_email}}.

## 7. Cookies and storage on your device
We use a secure cookie to keep you signed in, and your browser's storage to remember your cart, language and similar settings. Without them Explooro does not work properly.

## 8. Children
Explooro is not meant for children under 18 without a parent or guardian. If you think a child has given us information, contact us and we will remove it.

## 9. Changes
When we change this policy in a way that matters, we will ask you to read and agree to the new version the next time you use Explooro.

## 10. Contact
{{company.legal_name}}, {{company.address}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}$en$,
  $bn$Explooro ব্যবহারের সময় {{company.legal_name}} ("Explooro", "আমরা") কী তথ্য সংগ্রহ করে, কেন করে, কার সাথে শেয়ার করে এবং আপনার কী কী বেছে নেওয়ার সুযোগ আছে, এই নীতিতে তা বলা হয়েছে।

## ১. আমরা কী সংগ্রহ করি
- **অ্যাকাউন্টের তথ্য:** আপনার নাম, মোবাইল নম্বর, দিলে ইমেইল, পাসওয়ার্ড (এমনভাবে রাখা হয় যে কেউ তা পড়তে পারে না), আর আপনার ভূমিকা (ক্রেতা, Explooro শপ পার্টনার, সরবরাহকারী)।
- **ডেলিভারির তথ্য:** আপনি যে নাম, ফোন নম্বর ও ঠিকানা সেভ করেন বা চেকআউটে লেখেন।
- **অর্ডার ও পেমেন্ট:** কী কিনেছেন, কত ও কীভাবে দিয়েছেন, ফেরত টাকা, এবং আপনার ভল্টের লেনদেন। আমরা কার্ড নম্বর রাখি না; কার্ড পেমেন্ট পেমেন্ট কোম্পানি সামলায়।
- **পরিচয় যাচাই:** শপ পার্টনার বা সরবরাহকারী হয়ে টাকা তুলতে চাইলে আপনার আপলোড করা পরিচয়পত্র, এবং টাকা তোলার জন্য বিকাশ, নগদ বা ব্যাংকের তথ্য।
- **শপ পার্টনার আপনার হয়ে অর্ডার দিলে:** তাঁর দেওয়া নাম, ফোন নম্বর ও ঠিকানা। অর্ডারটি যাতে আপনার নিজের ইতিহাসে দেখা যায়, সেজন্য আমরা আপনার নামে একটি অ্যাকাউন্ট খুলি।
- **আপনি যা যোগ করেন:** রিভিউ, কমিউনিটি পোস্ট, চ্যাট মেসেজ, ছবি ও শপ পেজ।
- **আপনি কীভাবে Explooro ব্যবহার করেন:** কোন পণ্য দেখেন, খোঁজেন ও ক্লিক করেন, এবং কোন ডিভাইস, ব্রাউজার ও আইপি ঠিকানা ব্যবহার করেন। এগুলো দিয়ে আমরা আপনার পছন্দের পণ্য দেখাই এবং প্রতারণা ধরি।

## ২. কেন ব্যবহার করি
- অ্যাকাউন্ট খোলা, সাইন ইন করানো ও নিরাপত্তা কোড পাঠানোর জন্য।
- অর্ডার নেওয়া, ডেলিভারি দেওয়া, রিটার্ন সামলানো এবং সরবরাহকারী ও শপ পার্টনারদের টাকা দেওয়ার জন্য।
- ভুয়া অর্ডার ও প্রতারণা ঠেকাতে, যেমন ক্যাশ অন ডেলিভারি অর্ডারের আগে কোড চাওয়া।
- আপনার উপযোগী পণ্য, অফার ও বিজ্ঞাপন দেখাতে।
- আপনি যোগাযোগ করলে উত্তর দিতে এবং আপনার অর্ডারের খবর জানাতে।
- আইনি দায়িত্ব পালন করতে, যেমন লেনদেনের রেকর্ড রাখা।

## ৩. কার সাথে শেয়ার করি
- **আপনার অর্ডারের সরবরাহকারী** পার্সেল পাঠাতে যে নাম, ফোন নম্বর ও ঠিকানা লাগে তা পান।
- **কুরিয়ার কোম্পানি** ডেলিভারির জন্য যা লাগে তা পায়।
- **যে শপ পার্টনারের শপ বা লিংক থেকে কিনেছেন** তিনি দেখেন তাঁর মাধ্যমে কোন পণ্যের অর্ডার হয়েছে; আপনার ফোন নম্বর বা ঠিকানা দেখেন না।
- **যারা আমাদের হয়ে কাজ করে:** কোড পাঠানোর এসএমএস কোম্পানি, পেমেন্ট কোম্পানি, হোস্টিং ও স্টোরেজ। তারা আপনার তথ্য শুধু সেই কাজেই ব্যবহার করতে পারে।
- **কর্তৃপক্ষ**, যখন আইন তা চায়, অথবা মানুষকে প্রতারণা বা ক্ষতি থেকে বাঁচাতে।

আমরা আপনার ব্যক্তিগত তথ্য বিক্রি করি না।

## ৪. কতদিন রাখি
- আচরণের তথ্য (দেখা, ক্লিক, খোঁজ) আমাদের তথ্য সংরক্ষণ সেটিংসে ঠিক করা একটা নির্দিষ্ট সময় পরে নিজে থেকেই মুছে যায়।
- অর্ডার, পেমেন্ট ও ভল্টের লেনদেন যতদিন আইন ব্যবসার রেকর্ড রাখতে বলে ততদিন রাখা হয়।
- অ্যাকাউন্ট খোলা থাকা পর্যন্ত অ্যাকাউন্টের তথ্য রাখা হয়, এবং বন্ধ হওয়ার পর কোনো অর্ডার বা বিরোধ মেটাতে কিছুদিন।

## ৫. নিরাপদ রাখা
পাসওয়ার্ড শুধু হ্যাশ করা অবস্থায় রাখা হয়। জন্মতারিখের মতো সংবেদনশীল তথ্য এনক্রিপ্ট করা থাকে। কর্মীরা শুধু তাঁদের কাজের জন্য যা দরকার তা-ই দেখেন, এবং আপনার অ্যাকাউন্টে কর্মীদের প্রতিটি কাজ রেকর্ড করা হয়। কোনো ব্যবস্থাই পুরোপুরি নিরাপদ নয়; তথ্য ফাঁসে আপনি ক্ষতিগ্রস্ত হলে আমরা আপনাকে জানাব।

## ৬. আপনার পছন্দ
- আপনি যেকোনো সময় অ্যাকাউন্টে গিয়ে প্রোফাইল ও ঠিকানা দেখতে ও ঠিক করতে পারেন।
- নোটিফিকেশন সেটিংস থেকে প্রচারমূলক মেসেজ বন্ধ করতে পারেন।
- আপনার তথ্যের কপি পেতে, অথবা অ্যাকাউন্ট বন্ধ করে তথ্য মুছে ফেলতে (আইন যা রাখতে বলে তা ছাড়া), {{company.support_email}}-এ যোগাযোগ করুন।

## ৭. কুকি ও ডিভাইসের স্টোরেজ
আপনাকে সাইন ইন রাখতে আমরা একটি নিরাপদ কুকি ব্যবহার করি, আর কার্ট, ভাষা ও এমন সেটিংস মনে রাখতে আপনার ব্রাউজারের স্টোরেজ ব্যবহার করি। এগুলো ছাড়া Explooro ঠিকমতো চলে না।

## ৮. শিশু
বাবা-মা বা অভিভাবক ছাড়া ১৮ বছরের কম বয়সীদের জন্য Explooro নয়। কোনো শিশু আমাদের তথ্য দিয়েছে মনে হলে যোগাযোগ করুন, আমরা তা সরিয়ে দেব।

## ৯. পরিবর্তন
এই নীতিতে গুরুত্বপূর্ণ পরিবর্তন হলে পরের বার Explooro ব্যবহারের সময় আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব।

## ১০. যোগাযোগ
{{company.legal_name}}, {{company.address}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}$bn$,
  'First version.', 'প্রথম সংস্করণ।', true
),
(
  'refund', 1,
  'Refund & Return Policy',
  'রিফান্ড ও রিটার্ন নীতি',
  $en$This policy explains when you can return a product, how refunds work, and how warranty claims are handled on Explooro. It is part of our Terms of Use.

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

## 4. How you get your money back
- Refunds are paid into your **Explooro Vault** once the returned product has been checked. You can spend Vault money on your next order.
- If an order you already paid for is cancelled before delivery, the full amount goes back to your Vault straight away.
- If you return every item in a parcel, its delivery charge is refunded too. If you return only some, you are refunded for those items.

## 5. Warranty
Some products come with a warranty card from the supplier, shown in your account. Within the warranty period you can claim a repair, a replacement or a refund. The supplier is responsible for the warranty; Explooro helps you make the claim and follows it up.

## 6. Cash on delivery
If you refuse a cash-on-delivery parcel without a good reason, or keep ordering and refusing, we may stop offering you cash on delivery.

## 7. Contact
For any problem with an order, use the help or chat in your account, or contact {{company.support_email}} · {{company.support_phone}}.$en$,
  $bn$Explooro-তে কখন পণ্য ফেরত দিতে পারবেন, টাকা কীভাবে ফেরত পান এবং ওয়ারেন্টি দাবি কীভাবে সামলানো হয়, এই নীতিতে তা বলা হয়েছে। এটা আমাদের ব্যবহারের শর্তাবলির অংশ।

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

## ৪. টাকা কীভাবে ফেরত পান
- ফেরত আসা পণ্য যাচাই হলে ফেরত টাকা আপনার **Explooro ভল্টে** জমা হয়। ভল্টের টাকা পরের অর্ডারে খরচ করতে পারেন।
- আগে টাকা দেওয়া কোনো অর্ডার ডেলিভারির আগে বাতিল হলে পুরো টাকা সঙ্গে সঙ্গে আপনার ভল্টে ফেরত যায়।
- একটি পার্সেলের সব পণ্য ফেরত দিলে তার ডেলিভারি চার্জও ফেরত পাবেন। কয়েকটি ফেরত দিলে সেই পণ্যগুলোর টাকা ফেরত পাবেন।

## ৫. ওয়ারেন্টি
কিছু পণ্যের সাথে সরবরাহকারীর দেওয়া ওয়ারেন্টি কার্ড থাকে, যা আপনার অ্যাকাউন্টে দেখা যায়। ওয়ারেন্টির সময়ের মধ্যে মেরামত, বদলে দেওয়া বা টাকা ফেরতের দাবি করতে পারেন। ওয়ারেন্টির দায় সরবরাহকারীর; Explooro আপনাকে দাবি করতে সাহায্য করে এবং খোঁজ রাখে।

## ৬. ক্যাশ অন ডেলিভারি
যথাযথ কারণ ছাড়া ক্যাশ অন ডেলিভারির পার্সেল ফিরিয়ে দিলে, বা বারবার অর্ডার করে ফিরিয়ে দিলে, আমরা আপনার জন্য ক্যাশ অন ডেলিভারি বন্ধ করতে পারি।

## ৭. যোগাযোগ
অর্ডারে কোনো সমস্যা হলে আপনার অ্যাকাউন্টের হেল্প বা চ্যাট ব্যবহার করুন, অথবা {{company.support_email}} · {{company.support_phone}}-এ যোগাযোগ করুন।$bn$,
  'First version.', 'প্রথম সংস্করণ।', false
),
(
  'partner_agreement', 1,
  'Explooro Partner Agreement',
  'Explooro শপ পার্টনার চুক্তি',
  $en$This agreement is between you, as an Explooro partner, and {{company.legal_name}} ("Explooro", "we"). It adds to our Terms of Use and Privacy Policy, which also apply to you.

## 1. What an Explooro partner does
- You run an Explooro shop and share products and links with people you know and on social media.
- You do not buy, keep or send stock. The supplier keeps the product and sends the parcel; Explooro takes the payment.
- You do not set prices. The supplier sets the price and Explooro adds its own share; everyone sees the same price.

## 2. How you earn
- You earn rewards for the sales and the promotion you bring to Explooro, under the partner reward programme rules in effect at the time.
- Rewards are worked out and paid monthly into your Explooro Vault. We do not promise any fixed amount per sale or per month.
- A sale only counts if the product is active in your shop and the buyer is not you. Orders that are returned or cancelled do not earn.
- We may change the programme rules. A change never takes away rewards already paid for a closed month, except as section 4 allows.

## 3. Withdrawing your money
- You can withdraw your Vault balance to your own bKash, Nagad or bank account after you verify your identity.
- Withdrawals have a minimum amount and may take a few working days. They may be sent by hand by our team.
- You are responsible for any tax on what you earn.

## 4. How you must promote
- Be honest. Do not make claims about a product that are not in its description, or promise discounts, gifts or delivery times Explooro does not offer.
- Do not spam, buy fake followers or clicks, or post in groups where it is not allowed.
- Do not place orders yourself, or ask friends to order and cancel, to earn rewards. Do not use more than one partner account.
- Do not use the Explooro name or logo in a way that makes people think you are Explooro staff.

If you break these rules we may hold or take back the rewards involved, and suspend or end your partnership.

## 5. Your status
You are an independent partner, not an employee or agent of Explooro. You cannot make promises or agreements on Explooro's behalf.

## 6. Ending the partnership
You can stop being a partner at any time. We may end the partnership with notice, or at once if you break this agreement. Money that is yours in your Vault, earned within the rules, stays yours to withdraw.

## 7. Changes
When we change this agreement in a way that matters, we will ask you to read and agree to the new version before you continue as a partner.

## 8. Contact
{{company.legal_name}}, {{company.address}}
Email: {{company.support_email}} · Phone: {{company.support_phone}}$en$,
  $bn$এই চুক্তি Explooro শপ পার্টনার হিসেবে আপনার এবং {{company.legal_name}} ("Explooro", "আমরা")-এর মধ্যে। এটা আমাদের ব্যবহারের শর্তাবলি ও গোপনীয়তা নীতির সাথে যুক্ত, যেগুলো আপনার ক্ষেত্রেও প্রযোজ্য।

## ১. শপ পার্টনার কী করেন
- আপনি একটি Explooro শপ চালান এবং পরিচিতদের সাথে ও সোশ্যাল মিডিয়ায় পণ্য ও লিংক শেয়ার করেন।
- আপনি পণ্য কেনেন না, মজুত রাখেন না বা পাঠান না। পণ্য সরবরাহকারীর কাছে থাকে এবং তিনিই পার্সেল পাঠান; টাকা নেয় Explooro।
- আপনি দাম ঠিক করেন না। দাম ঠিক করেন সরবরাহকারী, Explooro তার সাথে নিজের অংশ যোগ করে; সবাই একই দাম দেখেন।

## ২. আপনি কীভাবে আয় করেন
- Explooro-তে আপনি যে বিক্রি ও প্রচার নিয়ে আসেন তার জন্য, তখনকার পার্টনার রিওয়ার্ড প্রোগ্রামের নিয়ম অনুযায়ী আপনি রিওয়ার্ড পান।
- রিওয়ার্ড প্রতি মাসে হিসাব করে আপনার Explooro ভল্টে দেওয়া হয়। প্রতি বিক্রি বা প্রতি মাসে কোনো নির্দিষ্ট অঙ্কের প্রতিশ্রুতি আমরা দিই না।
- পণ্যটি আপনার শপে সক্রিয় থাকলে এবং ক্রেতা আপনি নিজে না হলেই বিক্রি গণনা হয়। ফেরত বা বাতিল হওয়া অর্ডারে আয় হয় না।
- আমরা প্রোগ্রামের নিয়ম বদলাতে পারি। ৪ নম্বর অংশে যা বলা আছে তা ছাড়া, কোনো পরিবর্তন শেষ হওয়া মাসের জন্য আগে দেওয়া রিওয়ার্ড কেড়ে নেয় না।

## ৩. টাকা তোলা
- পরিচয় যাচাইয়ের পর আপনার ভল্টের ব্যালেন্স নিজের বিকাশ, নগদ বা ব্যাংক অ্যাকাউন্টে তুলতে পারেন।
- টাকা তোলার একটা ন্যূনতম অঙ্ক আছে এবং কয়েক কর্মদিবস লাগতে পারে। আমাদের টিম হাতে পাঠাতে পারে।
- আপনার আয়ের উপর কোনো কর থাকলে তার দায় আপনার।

## ৪. কীভাবে প্রচার করবেন
- সৎ থাকুন। পণ্যের বর্ণনায় নেই এমন দাবি করবেন না, এবং Explooro দেয় না এমন ছাড়, উপহার বা ডেলিভারির সময়ের প্রতিশ্রুতি দেবেন না।
- স্প্যাম করবেন না, ভুয়া ফলোয়ার বা ক্লিক কিনবেন না, এবং যে গ্রুপে অনুমতি নেই সেখানে পোস্ট করবেন না।
- রিওয়ার্ড পেতে নিজে অর্ডার দেবেন না, বা বন্ধুদের অর্ডার দিয়ে বাতিল করতে বলবেন না। একাধিক পার্টনার অ্যাকাউন্ট ব্যবহার করবেন না।
- Explooro-র নাম বা লোগো এমনভাবে ব্যবহার করবেন না যাতে মানুষ আপনাকে Explooro-র কর্মী ভাবে।

এই নিয়ম ভাঙলে আমরা সংশ্লিষ্ট রিওয়ার্ড আটকে রাখতে বা ফেরত নিতে পারি, এবং আপনার পার্টনারশিপ স্থগিত বা শেষ করতে পারি।

## ৫. আপনার অবস্থান
আপনি একজন স্বাধীন পার্টনার, Explooro-র কর্মী বা প্রতিনিধি নন। Explooro-র পক্ষে আপনি কোনো প্রতিশ্রুতি বা চুক্তি করতে পারবেন না।

## ৬. পার্টনারশিপ শেষ করা
আপনি যেকোনো সময় পার্টনার থাকা বন্ধ করতে পারেন। আমরা নোটিশ দিয়ে, অথবা আপনি এই চুক্তি ভাঙলে সঙ্গে সঙ্গে, পার্টনারশিপ শেষ করতে পারি। নিয়ম মেনে আয় করা যে টাকা আপনার ভল্টে আছে তা আপনারই থাকবে এবং তুলতে পারবেন।

## ৭. পরিবর্তন
এই চুক্তিতে গুরুত্বপূর্ণ পরিবর্তন হলে পার্টনার হিসেবে চালিয়ে যাওয়ার আগে আমরা আপনাকে নতুন সংস্করণ পড়ে সম্মতি দিতে বলব।

## ৮. যোগাযোগ
{{company.legal_name}}, {{company.address}}
ইমেইল: {{company.support_email}} · ফোন: {{company.support_phone}}$bn$,
  'First version.', 'প্রথম সংস্করণ।', true
)
ON CONFLICT (doc_key, version) DO NOTHING;
