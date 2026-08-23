/**
 * mock.js — Mock WhatsApp & Messenger Driver (Prompt 8.3).
 *
 * Simulates Meta Cloud API outbound messaging and records dispatched payloads for testing.
 */

const sentMessages = [];
const inboundQueue = [];

export function getSentMessages() {
  return sentMessages;
}

export function clearSentMessages() {
  sentMessages.length = 0;
}

export async function sendTextMessage(toPhone, text, options = {}) {
  const record = {
    type: 'text',
    to: toPhone,
    text,
    options,
    timestamp: new Date().toISOString(),
    messageId: `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`,
  };
  sentMessages.push(record);
  // eslint-disable-next-line no-console
  console.log(`[whatsapp:mock] TEXT to=${toPhone} text="${text}"`);
  return { success: true, messageId: record.messageId };
}

export async function sendInteractiveProductCard(toPhone, { product, checkoutUrl, headerText = null }) {
  const interactivePayload = {
    type: 'interactive',
    to: toPhone,
    interactive: {
      type: 'cta_url',
      header: {
        type: 'image',
        image: { link: product.image_url || '/placeholder-product.jpg' },
      },
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
    timestamp: new Date().toISOString(),
    messageId: `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`,
  };

  sentMessages.push(interactivePayload);
  // eslint-disable-next-line no-console
  console.log(`[whatsapp:mock] PRODUCT_CARD to=${toPhone} url=${checkoutUrl}`);
  return { success: true, messageId: interactivePayload.messageId, payload: interactivePayload };
}

export async function sendTemplateMessage(toPhone, templateName, components = []) {
  const record = {
    type: 'template',
    to: toPhone,
    templateName,
    components,
    timestamp: new Date().toISOString(),
    messageId: `wamid.mock.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`,
  };
  sentMessages.push(record);
  return { success: true, messageId: record.messageId };
}
