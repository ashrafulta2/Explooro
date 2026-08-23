/**
 * cloud-api.js — Meta WhatsApp Cloud API v20.0 Driver (Prompt 8.3).
 */

export function createCloudApiClient(config = {}) {
  const {
    phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken = process.env.WHATSAPP_ACCESS_TOKEN,
    apiVersion = 'v20.0',
  } = config;

  const baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  async function postToMeta(payload) {
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
