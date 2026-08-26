/**
 * vault.js — Mock API handlers for User Vault, Balances, Escrow & Withdrawals (Prompt 6.5).
 */

let mockWallet = {
  id: 'w-usr-1',
  user_id: 'usr-1',
  available_balance: '12450.00',
  pending_escrow_balance: '4800.00',
  lifetime_earned: '28650.00',
  lifetime_withdrawn: '11400.00',
  held_balance: '0.00',
  currency: 'BDT',
};

let mockEscrowTimeline = [
  {
    id: 'esc-101',
    sub_order_ref: 'ORD-DH-90123-1',
    product_title: 'Authentic Handloom Dhakai Jamdani Saree',
    amount: '2800.00',
    status: 'IN_ESCROW',
    release_date: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    remaining_seconds: 172800,
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  },
  {
    id: 'esc-102',
    sub_order_ref: 'ORD-DH-90123-2',
    product_title: 'Pure Rajshahi Silk Dupatta / Scarf',
    amount: '2000.00',
    status: 'IN_ESCROW',
    release_date: new Date(Date.now() + 96 * 3600 * 1000).toISOString(),
    remaining_seconds: 345600,
    created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
  },
];

let mockLedger = [
  {
    id: 'led-1',
    ref: 'LED-TX-901',
    type: 'CREDIT',
    category: 'SALE_COMMISSION',
    amount: '1200.00',
    running_balance: '12450.00',
    description: 'Commission from Order #ORD-DH-90123-1',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    id: 'led-2',
    ref: 'LED-TX-900',
    type: 'CREDIT',
    category: 'ESCROW_RELEASE',
    amount: '3500.00',
    running_balance: '11250.00',
    description: 'Escrow released for delivered sub-order #ORD-CTG-88210',
    created_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
  },
  {
    id: 'led-3',
    ref: 'LED-TX-899',
    type: 'DEBIT',
    category: 'PAYOUT_DISBURSE',
    amount: '5000.00',
    running_balance: '7750.00',
    description: 'bKash Payout disbursed to +8801711111111 (TrxID: 8N2K90A)',
    created_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
  },
  {
    id: 'led-4',
    ref: 'LED-TX-898',
    type: 'CREDIT',
    category: 'SALE_COMMISSION',
    amount: '4500.00',
    running_balance: '12750.00',
    description: 'Commission from Order #ORD-SYL-77192',
    created_at: new Date(Date.now() - 96 * 3600 * 1000).toISOString(),
  },
];

let mockPayoutRequests = [
  {
    id: 'po-1',
    ref: 'PO-882194',
    method: 'BKASH',
    account_number: '+8801711111111',
    account_name: 'Karim Ahmed',
    amount: '5000.00',
    fee_amount: '75.00',
    net_amount: '4925.00',
    status: 'DISBURSED',
    disbursed_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
    created_at: new Date(Date.now() - 76 * 3600 * 1000).toISOString(),
  },
];

export const vaultHandlers = [
  {
    method: 'GET',
    path: '/vault/overview',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            wallet: mockWallet,
            escrow_timeline: mockEscrowTimeline,
            recent_ledger: mockLedger.slice(0, 5),
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/vault/ledger',
    handler({ query }) {
      const category = query?.category;
      let txs = mockLedger;
      if (category) {
        txs = txs.filter((t) => t.category === category);
      }
      return {
        status: 200,
        body: {
          data: {
            ledger_transactions: txs,
          },
          meta: {
            total: txs.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/vault/payouts/me',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            payout_requests: mockPayoutRequests,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/vault/withdraw',
    handler({ body }) {
      const b = body || {};
      const amount = parseFloat(b.amount || 0);
      const avail = parseFloat(mockWallet.available_balance);

      if (!amount || amount < 100) {
        return {
          status: 400,
          body: {
            error: {
              code: 'INVALID_AMOUNT',
              message_en: 'Minimum withdrawal amount is ৳100.00',
              message_bn: 'সর্বনিম্ন উত্তোলনের পরিমাণ ৳১০০.০০',
            },
          },
        };
      }

      if (amount > avail) {
        return {
          status: 400,
          body: {
            error: {
              code: 'INSUFFICIENT_BALANCE',
              message_en: 'Requested amount exceeds available balance',
              message_bn: 'অনুরোধকৃত পরিমাণ আপনার ব্যবহারযোগ্য ব্যালেন্সের বেশি',
            },
          },
        };
      }

      // Calculate fee
      const fee = b.method === 'BANK' ? 0 : amount * 0.015;
      const net = amount - fee;

      const newPayout = {
        id: `po-${Date.now()}`,
        ref: `PO-${Date.now().toString().slice(-6)}`,
        method: b.method || 'BKASH',
        account_number: b.account_number,
        account_name: b.account_name,
        bank_name: b.bank_name || null,
        amount: amount.toFixed(2),
        fee_amount: fee.toFixed(2),
        net_amount: net.toFixed(2),
        status: 'PENDING',
        created_at: new Date().toISOString(),
      };

      // Update wallet
      mockWallet.available_balance = (avail - amount).toFixed(2);
      mockWallet.held_balance = (parseFloat(mockWallet.held_balance) + amount).toFixed(2);
      mockPayoutRequests.unshift(newPayout);

      return {
        status: 201,
        body: {
          data: {
            payout: newPayout,
            wallet: mockWallet,
            message_en: 'Payout request submitted successfully',
          },
        },
      };
    },
  },
];

export default vaultHandlers;
