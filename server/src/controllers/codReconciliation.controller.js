/**
 * codReconciliation.controller.js — HTTP Controller for COD Reconciliation & Courier Settlement (Prompt 6.4).
 */

import * as codService from '../services/codReconciliation.service.js';

/**
 * Parses simple CSV content into array of settlement records.
 */
function parseCsvContent(csvText) {
  const lines = String(csvText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Check header
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('consignment') || header.includes('order') || header.includes('amount');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const records = [];
  for (const line of dataLines) {
    const cols = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 2) continue;

    // Expected order: consignment_id, sub_order_ref, courier_reported, deposit_received
    records.push({
      consignment_id: cols[0] || null,
      sub_order_ref: cols[1] || null,
      courier_reported: parseFloat(cols[2] || '0') || 0,
      deposit_received: parseFloat(cols[3] || cols[2] || '0') || 0,
    });
  }

  return records;
}

export async function uploadSettlementReport(req, reply) {
  let records = req.body?.records;
  const courier = req.body?.courier || req.query?.courier || 'STEADFAST';
  const batchRef = req.body?.batch_ref || req.query?.batch_ref || null;
  const tolerance = req.body?.tolerance ? parseFloat(req.body.tolerance) : 0.00;

  if (typeof req.body?.csv_content === 'string') {
    records = parseCsvContent(req.body.csv_content);
  } else if (typeof req.body === 'string') {
    records = parseCsvContent(req.body);
  }

  if (!Array.isArray(records) || records.length === 0) {
    return reply.status(400).send({
      error: {
        code: 'EMPTY_SETTLEMENT_REPORT',
        message_en: 'No valid settlement records provided for reconciliation.',
        message_bn: 'পুনর্মিলনের জন্য কোনো বৈধ সেটেলমেন্ট রেকর্ড পাওয়া যায়নি।',
      },
    });
  }

  const result = await codService.ingestSettlementReport(req.server.db, {
    courier,
    batchRef,
    records,
    tolerance,
    importedBy: req.user?.id,
  });

  return reply.status(201).send({
    data: result,
  });
}

export async function listReconciliations(req, reply) {
  const status = req.query.status || null;
  const courier = req.query.courier || null;
  const hasVariance = req.query.has_variance === 'true' || req.query.has_variance === true;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;

  const result = await codService.listReconciliations(req.server.db, {
    status,
    courier,
    hasVariance,
    limit,
    cursor,
  });

  return reply.send({
    data: {
      reconciliations: result.reconciliations,
      next_cursor: result.nextCursor,
      count: result.count,
    },
  });
}

export async function getAgingReport(req, reply) {
  const alertThresholdDays = req.query.alert_threshold_days
    ? parseInt(req.query.alert_threshold_days, 10)
    : 7;

  const report = await codService.getAgingReport(req.server.db, {
    alertThresholdDays,
  });

  return reply.send({
    data: report,
  });
}

export async function resolveDiscrepancy(req, reply) {
  const reconId = parseInt(req.params.id, 10);
  const resolutionReason = req.body?.resolution_reason || req.body?.reason;

  const result = await codService.resolveDiscrepancy(req.server.db, {
    reconId,
    resolutionReason,
    resolvedBy: req.user?.id,
    role: req.user?.role || 'admin',
  });

  if (result.isPendingMakerChecker) {
    return reply.status(202).send({
      data: result,
      meta: {
        maker_checker: {
          pending_action_id: result.pendingAction?.id,
          action_ref: result.pendingAction?.ref,
          requires_super_admin: true,
        },
      },
    });
  }

  return reply.send({
    data: result,
  });
}
