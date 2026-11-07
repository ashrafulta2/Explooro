/**
 * cloud-api.ts — Meta WhatsApp Cloud API v20.0 Driver (Prompt 8.3).
 */

import { credential } from '../credentialStore.ts';

/**
 * Test Connection (integration.service.ts): reads the phone number's own record from the Graph
 * API. It sends no message, so it is safe to run at any time, and it fails exactly when sending
 * would: a wrong number ID or a token without access to it.
 */
export async function probePhoneNumber(
  { phoneNumberId, accessToken, apiVersion = 'v20.0' }: { phoneNumberId?: string; accessToken?: string; apiVersion?: string },
  { fetchImpl = fetch, signal }: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
) {
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId ?? '')}?fields=display_phone_number,verified_name`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken ?? ''}` }, signal });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, detail: `Meta answered HTTP ${res.status}: ${String(body?.error?.message ?? 'no detail').slice(0, 160)}` };
  }
  return { ok: true, detail: `Meta knows this number (${body?.display_phone_number ?? phoneNumberId}).` };
}

export function createCloudApiClient(config: Record<string, string | undefined> = {}) {
  const {
    // A value saved at /admin/platform/integrations first, then .env (credentialStore.ts).
    phoneNumberId = credential('whatsapp_cloud', 'phone_number_id', 'WHATSAPP_PHONE_NUMBER_ID'),
    accessToken = credential('whatsapp_cloud', 'access_token', 'WHATSAPP_ACCESS_TOKEN'),
    apiVersion = 'v20.0',
  } = config;

  const baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  async function postToMeta(payload): Promise<any> {
    if (!phoneNumberId || !accessToken) {
      throw new Error('WHATSAPP_CONFIG_MISSING: Missing phoneNumberId or accessToken.');
    }

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(`WHATSAPP_API_ERROR: ${res.status} ${JSON.stringify(errBody)}`);
    }

    return res.json();
  }

  return {
    async sendTextMessage(toPhone, text) {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/\D/g, ''),
        type: 'text',
        text: { body: text },
      };
      const res = await postToMeta(payload);
      return { success: true, messageId: res.messages?.[0]?.id };
    },

    async sendInteractiveProductCard(toPhone, { product, checkoutUrl, headerText }) {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/\D/g, ''),
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: product.image_url ? { type: 'image', image: { link: product.image_url } } : undefined,
          body: {
            text: headerText || `*${product.title}*\n\nPrice: ৳${product.price}\n\n${product.description || ''}`,
          },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'Buy Now / অর্ডার করুন',
              url: checkoutUrl,
            },
          },
        },
      };

      const res = await postToMeta(payload);
      return { success: true, messageId: res.messages?.[0]?.id };
    },

    async sendTemplateMessage(toPhone, templateName, components = []) {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/\D/g, ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'bn' },
          components,
        },
      };

      const res = await postToMeta(payload);
      return { success: true, messageId: res.messages?.[0]?.id };
    },
  };
}
