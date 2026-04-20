const { Resend } = require("resend");

let _resend = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@decrocheai.online";

/**
 * Notify admin that a new client completed onboarding and needs a Twilio number.
 */
async function sendAdminOnboardingNotification({ user, company, owner, aiPrefs, documentUrls }) {
  if (!ADMIN_EMAIL) throw new Error("ADMIN_EMAIL env var not set");

  const subject = `[DécrocheAI] Nouveau client à provisionner — ${company.company_name}`;
  const html = `
    <h2>Nouveau client en attente de provisionnement</h2>
    <p><strong>Email :</strong> ${user.email}</p>
    <p><strong>User ID :</strong> ${user.id}</p>

    <h3>Entreprise</h3>
    <ul>
      <li><strong>Nom :</strong> ${company.company_name}</li>
      <li><strong>SIREN :</strong> ${company.siren}</li>
      <li><strong>Forme juridique :</strong> ${company.legal_form}</li>
      <li><strong>Adresse :</strong> ${company.address_street}, ${company.address_zip} ${company.address_city}</li>
      <li><strong>Téléphone pro actuel :</strong> ${company.professional_phone}</li>
    </ul>

    <h3>Gérant</h3>
    <ul>
      <li><strong>Nom :</strong> ${owner.first_name} ${owner.last_name}</li>
      <li><strong>Date de naissance :</strong> ${owner.date_of_birth}</li>
      <li><strong>Nationalité :</strong> ${owner.nationality}</li>
    </ul>

    <h3>Préférences IA</h3>
    <ul>
      <li><strong>Métier :</strong> ${aiPrefs.trade}</li>
      <li><strong>Zone :</strong> ${aiPrefs.intervention_zone || "—"}</li>
      <li><strong>Ton :</strong> ${aiPrefs.tone}</li>
      <li><strong>Horaires :</strong> ${aiPrefs.working_hours || "—"}</li>
      <li><strong>Message perso :</strong> ${aiPrefs.custom_message || "—"}</li>
    </ul>

    <h3>Documents</h3>
    <ul>
      ${documentUrls.kbis ? `<li><a href="${documentUrls.kbis}">KBIS / Avis SIRENE</a></li>` : "<li>KBIS : non fourni</li>"}
      ${documentUrls.addressProof ? `<li><a href="${documentUrls.addressProof}">Justificatif d'adresse</a></li>` : "<li>Justificatif adresse : non fourni</li>"}
      ${documentUrls.idDocument ? `<li><a href="${documentUrls.idDocument}">CNI / Passeport</a></li>` : "<li>CNI/Passeport : non fourni</li>"}
    </ul>

    <hr/>
    <p>Pour activer ce client, assignez-lui un numéro Twilio FR et mettez à jour le champ
    <code>assigned_phone_number</code> dans la table <code>companies</code> (user_id: ${user.id}).</p>
  `;

  const { error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject,
    html,
  });

  if (error) throw new Error(`Resend admin email error: ${error.message}`);
}

/**
 * Send confirmation email to the client after onboarding submission.
 */
async function sendClientOnboardingConfirmation({ email, firstName, companyName }) {
  const { error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "DécrocheAI — Votre inscription est bien reçue !",
    html: `
      <h2>Bonjour ${firstName},</h2>
      <p>Merci d'avoir complété votre inscription sur DécrocheAI !</p>
      <p>Votre dossier pour <strong>${companyName}</strong> est en cours de traitement.</p>
      <p>Votre numéro DécrocheAI sera actif sous <strong>3 à 5 jours ouvrés</strong>.
      Vous recevrez un email dès que votre ligne est prête.</p>
      <p>En cas de question, répondez simplement à cet email.</p>
      <br/>
      <p>L'équipe DécrocheAI</p>
    `,
  });

  if (error) throw new Error(`Resend client email error: ${error.message}`);
}

/**
 * Notify admin that a client clicked "Tester ma ligne".
 */
async function sendLineTestNotification({ email, companyName, professionalPhone, assignedPhone }) {
  if (!ADMIN_EMAIL) throw new Error("ADMIN_EMAIL env var not set");

  const { error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: `[DécrocheAI] Test de ligne — ${companyName}`,
    html: `
      <p><strong>${companyName}</strong> (${email}) vient de cliquer sur "Tester ma ligne".</p>
      <p><strong>Numéro à appeler :</strong> ${professionalPhone}</p>
      <p><strong>Numéro DécrocheAI assigné :</strong> ${assignedPhone}</p>
      <p>Appelez le numéro pro du client pour vérifier que la redirection fonctionne.</p>
    `,
  });

  if (error) throw new Error(`Resend line-test email error: ${error.message}`);
}

module.exports = { sendAdminOnboardingNotification, sendClientOnboardingConfirmation, sendLineTestNotification };
