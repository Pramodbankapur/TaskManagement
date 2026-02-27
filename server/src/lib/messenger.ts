const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;

function canSendTwilio(): boolean {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);
}

function authHeader(): string {
  const token = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  return `Basic ${token}`;
}

async function sendTwilioMessage(from: string, to: string, body: string): Promise<void> {
  if (!canSendTwilio()) {
    console.log(`[msg-simulated] from=${from} to=${to} body=${body}`);
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const payload = new URLSearchParams({ From: from, To: to, Body: body });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload.toString()
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Twilio error: ${errorBody}`);
  }
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!TWILIO_SMS_FROM) {
    console.log(`[sms-simulated] to=${to} body=${body}`);
    return;
  }
  await sendTwilioMessage(TWILIO_SMS_FROM, to, body);
}

export async function sendWhatsApp(to: string, body: string): Promise<void> {
  if (!TWILIO_WHATSAPP_FROM) {
    console.log(`[whatsapp-simulated] to=${to} body=${body}`);
    return;
  }
  const formattedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const formattedFrom = TWILIO_WHATSAPP_FROM.startsWith("whatsapp:")
    ? TWILIO_WHATSAPP_FROM
    : `whatsapp:${TWILIO_WHATSAPP_FROM}`;
  await sendTwilioMessage(formattedFrom, formattedTo, body);
}
