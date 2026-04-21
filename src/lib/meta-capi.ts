import crypto from 'crypto';

const PIXEL_ID = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const API_VERSION = 'v21.0';

interface CAPIUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbc?: string;
  fbp?: string;
}

interface CAPIEvent {
  eventName: string;
  eventTime?: number;
  eventSourceUrl?: string;
  actionSource?: 'website' | 'app' | 'email' | 'phone_call';
  userData: CAPIUserData;
  customData?: Record<string, any>;
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function formatUserData(userData: CAPIUserData) {
  const formatted: Record<string, any> = {};

  if (userData.email) formatted.em = [hashValue(userData.email)];
  if (userData.phone) formatted.ph = [hashValue(userData.phone)];
  if (userData.firstName) formatted.fn = [hashValue(userData.firstName)];
  if (userData.lastName) formatted.ln = [hashValue(userData.lastName)];
  if (userData.clientIpAddress) formatted.client_ip_address = userData.clientIpAddress;
  if (userData.clientUserAgent) formatted.client_user_agent = userData.clientUserAgent;
  if (userData.fbc) formatted.fbc = userData.fbc;
  if (userData.fbp) formatted.fbp = userData.fbp;

  return formatted;
}

export async function sendCAPIEvent(event: CAPIEvent): Promise<{ success: boolean; error?: string }> {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('[CAPI] META_PIXEL_ID 또는 META_CAPI_ACCESS_TOKEN이 설정되지 않았습니다.');
    return { success: false, error: 'Missing configuration' };
  }

  const eventData = {
    event_name: event.eventName,
    event_time: event.eventTime || Math.floor(Date.now() / 1000),
    event_source_url: event.eventSourceUrl,
    action_source: event.actionSource || 'website',
    user_data: formatUserData(event.userData),
    custom_data: event.customData,
  };

  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [eventData],
        access_token: ACCESS_TOKEN,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[CAPI] Error:', result);
      return { success: false, error: JSON.stringify(result) };
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[CAPI] Event sent:', event.eventName, result);
    }

    return { success: true };
  } catch (error) {
    console.error('[CAPI] Network error:', error);
    return { success: false, error: String(error) };
  }
}
