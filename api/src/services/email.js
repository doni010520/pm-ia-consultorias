import { Resend } from 'resend';

let resend = null;

export function initEmail() {
  if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ Resend (email) inicializado');
  } else {
    console.warn('⚠️ RESEND_API_KEY não configurado — convites não enviarão email');
  }
}

/**
 * Envia email de convite para novo membro
 */
export async function sendInviteEmail({ to, inviteeName, inviterName, role, inviteLink, organizationName }) {
  if (!resend) {
    console.warn('⚠️ Email não enviado (Resend não configurado). Link:', inviteLink);
    return { success: false, reason: 'Resend não configurado' };
  }

  const roleLabels = {
    admin: 'Administrador',
    manager: 'Gerente',
    member: 'Membro',
  };

  const fromEmail = process.env.EMAIL_FROM || 'PM-IA <onboarding@resend.dev>';

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject: `Convite para ${organizationName || 'PM-IA'} — Gestão de Projetos`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a5f,#0f1f33);padding:32px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">PM-IA</h1>
              <p style="color:#93c5fd;margin:4px 0 0;font-size:14px;">Gestão de Projetos com IA</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h2 style="color:#1e3a5f;margin:0 0 16px;font-size:20px;">Olá, ${inviteeName}!</h2>
              <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 16px;">
                <strong>${inviterName}</strong> convidou você para participar da equipe como <strong>${roleLabels[role] || role}</strong>.
              </p>
              <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Clique no botão abaixo para criar sua senha e acessar o sistema:
              </p>
              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${inviteLink}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">
                      Aceitar Convite
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#6b7280;font-size:13px;line-height:1.5;margin:24px 0 0;">
                Este convite expira em 7 dias. Se você não reconhece este convite, ignore este email.
              </p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
              <p style="color:#9ca3af;font-size:12px;margin:0;">
                Se o botão não funcionar, copie e cole este link no navegador:<br>
                <a href="${inviteLink}" style="color:#1e3a5f;word-break:break-all;">${inviteLink}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `.trim(),
    });

    if (error) {
      console.error('❌ Erro ao enviar email:', error);
      return { success: false, reason: error.message };
    }

    console.log('✅ Email de convite enviado para:', to, 'id:', data?.id);
    return { success: true, emailId: data?.id };
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error);
    return { success: false, reason: error.message };
  }
}
