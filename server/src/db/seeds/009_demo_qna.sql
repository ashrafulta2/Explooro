-- 009_demo_qna.sql (Prompt 4.6)
-- Demo Product Q&A: a couple of answered questions and one still-open one, so QnASection has both
-- states to render. Answers come from the product's actual supplier (responder must be
-- saler/supplier — enforced in qna.service.js, not by a DB CHECK, since role membership can change).

INSERT INTO product_questions (product_id, user_id, body, upvote_count, status, created_at)
SELECT x.product_id, u.id, x.body, x.upvotes, 'PUBLISHED', now() - x.age
FROM (VALUES
  (1,  '+8801700000007', 'Does this Panjabi shrink after the first wash?', 6, interval '18 days'),
  (1,  '+8801700000006', 'Is the XL true to size for someone 6ft2 / 95kg?', 2, interval '9 days'),
  (11, '+8801700000007', 'Does the smartwatch support both iOS and Android for notifications?', 4, interval '12 days'),
  (5,  '+8801700000007', 'Is this saree machine-washable or dry-clean only?', 9, interval '20 days')
) AS x(product_id, phone, body, upvotes, age)
JOIN users u ON u.phone = x.phone
WHERE NOT EXISTS (
  SELECT 1 FROM product_questions pq
  WHERE pq.product_id = x.product_id AND pq.user_id = u.id AND pq.body = x.body
);

INSERT INTO product_answers (question_id, responder_id, body, created_at)
SELECT q.id, r.id, x.answer_body, q.created_at + interval '1 day'
FROM (VALUES
  (1, 'It is pre-shrunk cotton — a single cold wash shrinks under 2%, well within the size chart tolerance. We recommend cold water and air drying to keep the embroidery crisp.', '+8801700000005'),
  (11, 'Yes — the companion app has both iOS and Android builds and mirrors call, SMS, and app notifications on both.', '+8801700000015'),
  (5, 'Dry-clean only, please — the hand-woven thread count can loosen with machine agitation. We include a care card with every order.', '+8801700000005')
) AS x(product_id, answer_body, responder_phone)
JOIN product_questions q ON q.product_id = x.product_id AND q.body IN (
  'Does this Panjabi shrink after the first wash?',
  'Does the smartwatch support both iOS and Android for notifications?',
  'Is this saree machine-washable or dry-clean only?'
)
JOIN users r ON r.phone = x.responder_phone
WHERE NOT EXISTS (SELECT 1 FROM product_answers pa WHERE pa.question_id = q.id);
