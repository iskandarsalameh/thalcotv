// The page a phone lands on after scanning the QR code on the TV. It takes an
// add-on link, encrypts it with the key from the QR code and hands it to the
// relay for the TV to pick up.

import './pair.css';
import { listen, parseFragment, send } from '../core/pairing';
import pasteSvg from '@phosphor-icons/core/assets/bold/clipboard-text-bold.svg?raw';
import tvSvg from '@phosphor-icons/core/assets/bold/television-simple-bold.svg?raw';
import openSvg from '@phosphor-icons/core/assets/bold/arrow-square-out-bold.svg?raw';
import okSvg from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw';
import warnSvg from '@phosphor-icons/core/assets/fill/warning-fill.svg?raw';

/** Same Phosphor icons as the TV interface, sized and coloured by CSS. */
function icon(svg: string): string {
  return svg.replace('<svg ', '<svg class="icon" aria-hidden="true" ');
}

function label(el: HTMLElement, svg: string, text: string): void {
  el.innerHTML = icon(svg);
  el.appendChild(document.createTextNode(text));
}

type Strings = Record<
  | 'title' | 'intro' | 'noCode' | 'configureStep' | 'configureText' | 'configureOpen' | 'pasteStep' | 'pasteStepOnly'
  | 'paste' | 'send' | 'sending' | 'sent' | 'installed' | 'declined' | 'failed' | 'invalid' | 'network' | 'note',
  string
>;

const STRINGS: Record<string, Strings> = {
  en: {
    title: 'Add to Thalco TV',
    intro: 'Paste the link of an add-on and it will appear on your TV.',
    noCode: 'Open this page by scanning the code shown on your TV: Settings, Add-ons, Add from Phone.',
    configureStep: 'Set up the add-on',
    configureText: 'Set the add-on up, then copy its install link. Tip: press and hold the Install button and choose Copy Link.',
    configureOpen: 'Open Setup Page',
    pasteStep: 'Paste the install link',
    pasteStepOnly: 'Add-on link',
    paste: 'Paste',
    send: 'Send to TV',
    sending: 'Sending…',
    sent: 'Sent. Confirm on your TV.',
    installed: 'Installed on your TV: {name}',
    declined: 'Not installed: it was declined on the TV.',
    failed: 'The TV could not find an add-on at that link. Check it and try again.',
    invalid: 'That does not look like a link.',
    network: 'Could not send. Check your connection and try again.',
    note: 'The link is encrypted on this phone and only your TV can read it.',
  },
  ar: {
    title: 'أضف إلى Thalco TV',
    intro: 'الصق رابط الإضافة وسيظهر على تلفازك.',
    noCode: 'افتح هذه الصفحة بمسح الرمز الظاهر على التلفاز: الإعدادات، الإضافات، إضافة من الهاتف.',
    configureStep: 'أعدّ الإضافة',
    configureText: 'أعدّ الإضافة ثم انسخ رابط التثبيت. تلميح: اضغط مطوّلًا على زر Install واختر نسخ الرابط.',
    configureOpen: 'فتح صفحة الإعداد',
    pasteStep: 'الصق رابط التثبيت',
    pasteStepOnly: 'رابط الإضافة',
    paste: 'لصق',
    send: 'إرسال إلى التلفاز',
    sending: 'جارٍ الإرسال…',
    sent: 'تم الإرسال. أكّد على التلفاز.',
    installed: 'تم التثبيت على تلفازك: {name}',
    declined: 'لم تُثبَّت: رُفضت على التلفاز.',
    failed: 'لم يجد التلفاز إضافة في هذا الرابط. تحقق منه وحاول مجددًا.',
    invalid: 'هذا لا يبدو رابطًا.',
    network: 'تعذّر الإرسال. تحقق من الاتصال وحاول مجددًا.',
    note: 'يُشفَّر الرابط على هذا الهاتف ولا يقرؤه إلا تلفازك.',
  },
  es: {
    title: 'Añadir a Thalco TV',
    intro: 'Pega el enlace de un complemento y aparecerá en tu televisor.',
    noCode: 'Abre esta página escaneando el código que muestra tu televisor: Ajustes, Complementos, Añadir desde el teléfono.',
    configureStep: 'Configura el complemento',
    configureText: 'Configura el complemento y copia su enlace de instalación. Consejo: mantén pulsado el botón Install y elige Copiar enlace.',
    configureOpen: 'Abrir configuración',
    pasteStep: 'Pega el enlace de instalación',
    pasteStepOnly: 'Enlace del complemento',
    paste: 'Pegar',
    send: 'Enviar al televisor',
    sending: 'Enviando…',
    sent: 'Enviado. Confirma en el televisor.',
    installed: 'Instalado en tu televisor: {name}',
    declined: 'No instalado: se rechazó en el televisor.',
    failed: 'El televisor no encontró un complemento en ese enlace. Revísalo e inténtalo de nuevo.',
    invalid: 'Eso no parece un enlace.',
    network: 'No se pudo enviar. Revisa la conexión e inténtalo de nuevo.',
    note: 'El enlace se cifra en este teléfono y solo tu televisor puede leerlo.',
  },
  fr: {
    title: 'Ajouter à Thalco TV',
    intro: 'Collez le lien d’une extension et elle apparaîtra sur votre téléviseur.',
    noCode: 'Ouvrez cette page en scannant le code affiché sur le téléviseur : Réglages, Extensions, Ajouter depuis le téléphone.',
    configureStep: 'Configurez l’extension',
    configureText: 'Configurez l’extension puis copiez son lien d’installation. Astuce : appui long sur le bouton Install, puis Copier le lien.',
    configureOpen: 'Ouvrir la configuration',
    pasteStep: 'Collez le lien d’installation',
    pasteStepOnly: 'Lien de l’extension',
    paste: 'Coller',
    send: 'Envoyer au téléviseur',
    sending: 'Envoi…',
    sent: 'Envoyé. Confirmez sur le téléviseur.',
    installed: 'Installée sur votre téléviseur : {name}',
    declined: 'Non installée : refusée sur le téléviseur.',
    failed: 'Le téléviseur n’a trouvé aucune extension à ce lien. Vérifiez-le et réessayez.',
    invalid: 'Cela ne ressemble pas à un lien.',
    network: 'Envoi impossible. Vérifiez la connexion et réessayez.',
    note: 'Le lien est chiffré sur ce téléphone et seul votre téléviseur peut le lire.',
  },
  de: {
    title: 'Zu Thalco TV hinzufügen',
    intro: 'Link eines Add-ons einfügen, dann erscheint es auf dem Fernseher.',
    noCode: 'Diese Seite über den Code auf dem Fernseher öffnen: Einstellungen, Add-ons, Vom Handy hinzufügen.',
    configureStep: 'Add-on einrichten',
    configureText: 'Add-on einrichten und den Installationslink kopieren. Tipp: Install gedrückt halten und Link kopieren wählen.',
    configureOpen: 'Einrichtung öffnen',
    pasteStep: 'Installationslink einfügen',
    pasteStepOnly: 'Add-on-Link',
    paste: 'Einfügen',
    send: 'An Fernseher senden',
    sending: 'Wird gesendet…',
    sent: 'Gesendet. Am Fernseher bestätigen.',
    installed: 'Auf dem Fernseher installiert: {name}',
    declined: 'Nicht installiert: am Fernseher abgelehnt.',
    failed: 'Der Fernseher hat unter diesem Link kein Add-on gefunden. Bitte prüfen und erneut versuchen.',
    invalid: 'Das sieht nicht nach einem Link aus.',
    network: 'Senden fehlgeschlagen. Verbindung prüfen und erneut versuchen.',
    note: 'Der Link wird auf diesem Handy verschlüsselt, nur dein Fernseher kann ihn lesen.',
  },
  pt: {
    title: 'Adicionar ao Thalco TV',
    intro: 'Cole o link de um complemento e ele aparecerá na sua TV.',
    noCode: 'Abra esta página lendo o código mostrado na TV: Ajustes, Complementos, Adicionar pelo celular.',
    configureStep: 'Configure o complemento',
    configureText: 'Configure o complemento e copie o link de instalação. Dica: segure o botão Install e escolha Copiar link.',
    configureOpen: 'Abrir configuração',
    pasteStep: 'Cole o link de instalação',
    pasteStepOnly: 'Link do complemento',
    paste: 'Colar',
    send: 'Enviar para a TV',
    sending: 'Enviando…',
    sent: 'Enviado. Confirme na TV.',
    installed: 'Instalado na sua TV: {name}',
    declined: 'Não instalado: recusado na TV.',
    failed: 'A TV não encontrou um complemento nesse link. Confira e tente de novo.',
    invalid: 'Isso não parece um link.',
    network: 'Não foi possível enviar. Verifique a conexão e tente de novo.',
    note: 'O link é criptografado neste celular e só a sua TV consegue ler.',
  },
};

function pickLanguage(): string {
  for (const l of navigator.languages ?? [navigator.language]) {
    const short = String(l).toLowerCase().split('-')[0];
    if (STRINGS[short]) return short;
  }
  return 'en';
}

const lang = pickLanguage();
const S = STRINGS[lang];
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const setText = (id: string, text: string) => {
  $(id).textContent = text;
};

/** Accepts https links, stremio:// install links and bare hosts. */
function looksLikeLink(text: string): boolean {
  return /^(https?:\/\/|stremio:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text) || /^https?:\/\/[\w.:-]+(\/\S*)?$/i.test(text);
}

function start(): void {
  setText('title', S.title);
  const parsed = parseFragment(location.hash);
  if (!parsed) {
    setText('intro', S.noCode);
    return;
  }
  const { channel, configureUrl } = parsed;
  setText('intro', S.intro);
  setText('note', S.note);
  $('form').hidden = false;
  setText('pasteStep', configureUrl ? S.pasteStep : S.pasteStepOnly);
  setText('pasteNum', configureUrl ? '2' : '1');
  label($('paste'), pasteSvg, S.paste);
  label($('send'), tvSvg, S.send);

  if (configureUrl) {
    $('configure').hidden = false;
    setText('configureStep', S.configureStep);
    setText('configureText', S.configureText);
    const link = $<HTMLAnchorElement>('configureLink');
    link.href = configureUrl;
    label(link, openSvg, S.configureOpen);
  }

  const field = $<HTMLTextAreaElement>('url');
  const sendButton = $<HTMLButtonElement>('send');
  const pasteButton = $<HTMLButtonElement>('paste');
  const status = $('status');
  const say = (text: string, kind: '' | 'ok' | 'bad' | 'busy' = '') => {
    status.className = 'toast' + (kind ? ' toast-' + kind : '');
    status.innerHTML = kind === 'ok' ? icon(okSvg) : kind === 'bad' ? icon(warnSvg) : kind === 'busy' ? '<span class="spinner"></span>' : '';
    status.appendChild(document.createTextNode(text));
  };

  if (!navigator.clipboard?.readText) pasteButton.hidden = true;
  pasteButton.addEventListener('click', async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) field.value = text;
    } catch {
      field.focus();
    }
  });

  listen(channel, 'ack', (msg) => {
    sendButton.disabled = false;
    if (msg.ok) {
      say(S.installed.replace('{name}', msg.name ?? ''), 'ok');
      field.value = '';
    } else {
      say(msg.name ? S.declined : S.failed, 'bad');
    }
  });

  sendButton.addEventListener('click', async () => {
    const url = field.value.trim();
    if (!looksLikeLink(url)) {
      say(S.invalid, 'bad');
      return;
    }
    sendButton.disabled = true;
    say(S.sending, 'busy');
    try {
      await send(channel, { t: 'add', url });
      say(S.sent, 'busy');
      setTimeout(() => {
        sendButton.disabled = false;
      }, 4000);
    } catch {
      sendButton.disabled = false;
      say(S.network, 'bad');
    }
  });
}

start();
