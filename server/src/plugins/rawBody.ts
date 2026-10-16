/**
 * rawBody.ts — keeps the exact bytes of a JSON request body on `req.rawBody`.
 *
 * WHY: a webhook signature covers the bytes the sender transmitted. Re-serialising the parsed body
 * can change whitespace or key order, so a genuine signature would fail (or, worse, the check gets
 * loosened to make it pass). Call this inside a routes plugin: Fastify encapsulation means only the
 * routes registered in that plugin get the parser, everything else keeps the default one.
 */
export function addRawJsonBody(app) {
  // The default parser keeps the __proto__ / constructor poisoning protection.
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    if (!body) return done(null, {});
    parseJson(req, body, done);
  });
}
