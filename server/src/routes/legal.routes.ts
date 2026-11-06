/**
 * legal.routes.ts — terms, privacy, refund policy and Explooro partner agreement (migration 104).
 *
 *   GET  /legal/documents                       public: newest version of each, no bodies
 *   GET  /legal/documents/:key[?version=N]      public: one document, filled in
 *   GET  /me/legal/pending                      signed in: what this account still has to agree to
 *   POST /me/legal/accept                       signed in: agree to newest versions
 *   GET  /admin/platform/legal                  platform.legal.view    (LOW)
 *   POST /admin/platform/legal/:key/versions    platform.legal.publish (CRITICAL: super admin only)
 *   PUT  /admin/platform/legal/company          platform.legal.publish (CRITICAL)
 *
 * WHY no module: the documents are a legal requirement, not a feature; switching them off would
 * leave the platform taking orders with no terms. The pages are locked LIVE for the same reason
 * (pageAccess LOCKED_PATHS).
 * WHY /me/* has no permission: every account may read and sign its own agreements, like
 * /me/profile; the service checks the document applies to the caller's role.
 * WHY publish is CRITICAL: a new version can ask every user to agree again before they carry on.
 */

import * as controller from '../controllers/legal.controller.ts';
import { LEGAL_DOC_KEYS } from '../config/legal.ts';

export default async function legalRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});
  const keyParams = { type: 'object', required: ['key'], properties: { key: { type: 'string', enum: [...LEGAL_DOC_KEYS] } } };
  const longText = (max) => ({ type: 'string', maxLength: max });

  app.get('/legal/documents', controller.listDocuments);

  app.get('/legal/documents/:key', {
    schema: {
      params: keyParams,
      querystring: { type: 'object', properties: { version: { type: 'integer', minimum: 1 } } },
    },
  }, controller.getDocument);

  app.get('/me/legal/pending', { preHandler: [auth] }, controller.getPending);

  app.post('/me/legal/accept', {
    preHandler: [auth],
    schema: {
      body: {
        type: 'object',
        required: ['document_ids'],
        additionalProperties: false,
        properties: { document_ids: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'integer', minimum: 1 } } },
      },
    },
  }, controller.acceptDocuments);

  app.get('/admin/platform/legal', {
    config: { page: '/admin/platform/legal' },
    preHandler: [auth, reqPerm('platform.legal.view')],
  }, controller.getAdminOverview);

  app.post('/admin/platform/legal/:key/versions', {
    config: { page: '/admin/platform/legal' },
    preHandler: [auth, reqPerm('platform.legal.publish')],
    schema: {
      params: keyParams,
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['base_version', 'title_en', 'title_bn', 'body_en', 'body_bn', 'change_note_en', 'change_note_bn', 'requires_reacceptance', 'reason'],
        properties: {
          base_version: { type: 'integer', minimum: 0 },
          title_en: longText(300),
          title_bn: longText(300),
          body_en: longText(70000),
          body_bn: longText(70000),
          change_note_en: longText(600),
          change_note_bn: longText(600),
          requires_reacceptance: { type: 'boolean' },
          reason: longText(600),
        },
      },
    },
  }, controller.publishVersion);

  app.put('/admin/platform/legal/company', {
    config: { page: '/admin/platform/legal' },
    preHandler: [auth, reqPerm('platform.legal.publish')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: {
          legal_name: longText(300),
          trade_license: longText(100),
          address_en: longText(400),
          address_bn: longText(400),
          support_email: longText(200),
          support_phone: longText(60),
          reason: longText(600),
        },
      },
    },
  }, controller.updateCompany);
}
