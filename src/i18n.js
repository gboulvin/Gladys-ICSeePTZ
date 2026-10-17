// -----------------------------------------------------------------------------
// User-facing texts, in the four languages of the Gladys UI.
//
// Gladys picks the user's language in every multi-language object
// (`{ en, fr, de, es }`) and falls back to English: messages under the
// manifest action buttons, scene and widget texts, toasts, connection status.
// test/i18n.test.js checks that every entry carries the four languages and the
// same placeholders.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const MESSAGES = {
  no_camera_configured: {
    en: 'No camera configured: add the address of your cameras in the configuration.',
    fr: "Aucune caméra configurée : ajoutez l'adresse de vos caméras dans la configuration.",
    de: 'Keine Kamera konfiguriert: Tragen Sie die Adresse Ihrer Kameras in der Konfiguration ein.',
    es: 'Ninguna cámara configurada: añada la dirección de sus cámaras en la configuración.',
  },
  invalid_hosts: {
    en: 'Ignored invalid addresses: {hosts}.',
    fr: 'Adresses invalides ignorées : {hosts}.',
    de: 'Ungültige Adressen ignoriert: {hosts}.',
    es: 'Direcciones no válidas ignoradas: {hosts}.',
  },
  test_summary: {
    en: '{online} of {total} camera(s) reachable. {details}',
    fr: '{online} caméra(s) joignable(s) sur {total}. {details}',
    de: '{online} von {total} Kamera(s) erreichbar. {details}',
    es: '{online} de {total} cámara(s) accesible(s). {details}',
  },
  camera_ok: {
    en: '{host}: OK ({model}, serial {serial})',
    fr: '{host} : OK ({model}, n° de série {serial})',
    de: '{host}: OK ({model}, Seriennummer {serial})',
    es: '{host}: OK ({model}, n.º de serie {serial})',
  },
  camera_error: {
    en: '{host}: unreachable ({error})',
    fr: '{host} : injoignable ({error})',
    de: '{host}: nicht erreichbar ({error})',
    es: '{host}: inaccesible ({error})',
  },
  connection_partial: {
    en: '{offline} of {total} camera(s) unreachable: {hosts}.',
    fr: '{offline} caméra(s) injoignable(s) sur {total} : {hosts}.',
    de: '{offline} von {total} Kamera(s) nicht erreichbar: {hosts}.',
    es: '{offline} de {total} cámara(s) inaccesible(s): {hosts}.',
  },
  initialization_failed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, prüfen Sie die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  discovery_none: {
    en: 'No camera answered the network search. Some firmwares do not answer it: enter the address shown in the iCSee app (Device settings > Network).',
    fr: "Aucune caméra n'a répondu à la recherche réseau. Certains firmwares n'y répondent pas : saisissez l'adresse affichée dans l'application iCSee (Paramètres de l'appareil > Réseau).",
    de: 'Keine Kamera hat auf die Netzwerksuche geantwortet. Manche Firmwares antworten nicht: Geben Sie die in der iCSee-App angezeigte Adresse ein (Geräteeinstellungen > Netzwerk).',
    es: 'Ninguna cámara ha respondido a la búsqueda en red. Algunos firmwares no responden: introduzca la dirección que muestra la app iCSee (Ajustes del dispositivo > Red).',
  },
  discovery_found: {
    en: 'Found {count} camera(s): {hosts}. Copy the new ones into the "Camera addresses" field and save.',
    fr: '{count} caméra(s) trouvée(s) : {hosts}. Copiez les nouvelles dans le champ « Adresses des caméras » puis enregistrez.',
    de: '{count} Kamera(s) gefunden: {hosts}. Kopieren Sie die neuen in das Feld „Kamera-Adressen“ und speichern Sie.',
    es: '{count} cámara(s) encontrada(s): {hosts}. Copie las nuevas en el campo «Direcciones de las cámaras» y guarde.',
  },
  discovery_failed: {
    en: 'The network search failed: {error}',
    fr: 'La recherche réseau a échoué : {error}',
    de: 'Die Netzwerksuche ist fehlgeschlagen: {error}',
    es: 'La búsqueda en red ha fallado: {error}',
  },
  unknown_camera: {
    en: 'Unknown camera: re-run the discovery of the integration.',
    fr: "Caméra inconnue : relancez la découverte de l'intégration.",
    de: 'Unbekannte Kamera: Starten Sie die Erkennung der Integration erneut.',
    es: 'Cámara desconocida: vuelva a lanzar la detección de la integración.',
  },
  camera_offline: {
    en: '{name} is offline.',
    fr: '{name} est hors ligne.',
    de: '{name} ist offline.',
    es: '{name} está desconectada.',
  },
  reboot_sent: {
    en: '{name} is restarting, it will be back in about a minute.',
    fr: '{name} redémarre, elle sera de retour dans une minute environ.',
    de: '{name} startet neu und ist in etwa einer Minute wieder da.',
    es: '{name} se está reiniciando, volverá en un minuto aproximadamente.',
  },
  moved: {
    en: 'Camera moved.',
    fr: 'Caméra déplacée.',
    de: 'Kamera bewegt.',
    es: 'Cámara movida.',
  },
  preset_reached: {
    en: 'Going to "{preset}".',
    fr: 'Direction « {preset} ».',
    de: 'Fahre zu „{preset}“.',
    es: 'Yendo a «{preset}».',
  },
  preset_saved: {
    en: 'Position saved in preset {preset}.',
    fr: 'Position enregistrée dans le preset {preset}.',
    de: 'Position in Preset {preset} gespeichert.',
    es: 'Posición guardada en el preset {preset}.',
  },
  snapshot_taken: {
    en: 'New image sent to Gladys.',
    fr: 'Nouvelle image envoyée à Gladys.',
    de: 'Neues Bild an Gladys gesendet.',
    es: 'Nueva imagen enviada a Gladys.',
  },
  action_failed: {
    en: 'The camera refused the command: {error}',
    fr: 'La caméra a refusé la commande : {error}',
    de: 'Die Kamera hat den Befehl abgelehnt: {error}',
    es: 'La cámara ha rechazado la orden: {error}',
  },
  // Widget texts.
  widget_pick_camera: {
    en: 'Choose a camera in the widget settings.',
    fr: 'Choisissez une caméra dans les réglages du widget.',
    de: 'Wählen Sie eine Kamera in den Widget-Einstellungen.',
    es: 'Elija una cámara en los ajustes del widget.',
  },
  widget_no_presets: {
    en: 'No preset configured: list them in the integration configuration ("1:Entrance, 2:Garden").',
    fr: "Aucun preset configuré : listez-les dans la configuration de l'intégration (« 1:Entrée, 2:Jardin »).",
    de: 'Kein Preset konfiguriert: Tragen Sie sie in der Konfiguration der Integration ein („1:Eingang, 2:Garten“).',
    es: 'Ningún preset configurado: indíquelos en la configuración de la integración («1:Entrada, 2:Jardín»).',
  },
  widget_status: {
    en: 'Status',
    fr: 'État',
    de: 'Status',
    es: 'Estado',
  },
  widget_online: {
    en: 'Online',
    fr: 'En ligne',
    de: 'Online',
    es: 'Conectada',
  },
  widget_offline: {
    en: 'Offline',
    fr: 'Hors ligne',
    de: 'Offline',
    es: 'Desconectada',
  },
  widget_model: {
    en: 'Model',
    fr: 'Modèle',
    de: 'Modell',
    es: 'Modelo',
  },
  widget_last_detection: {
    en: 'Last detection',
    fr: 'Dernière détection',
    de: 'Letzte Erkennung',
    es: 'Última detección',
  },
  ago_now: {
    en: '{kind}, just now',
    fr: '{kind}, à l’instant',
    de: '{kind}, gerade eben',
    es: '{kind}, ahora mismo',
  },
  ago_minutes: {
    en: '{kind}, {count} min ago',
    fr: 'il y a {count} min ({kind})',
    de: '{kind}, vor {count} Min.',
    es: '{kind}, hace {count} min',
  },
  ago_hours: {
    en: '{kind}, {count} h ago',
    fr: 'il y a {count} h ({kind})',
    de: '{kind}, vor {count} Std.',
    es: '{kind}, hace {count} h',
  },
  widget_never: {
    en: 'None yet',
    fr: 'Aucune',
    de: 'Noch keine',
    es: 'Ninguna',
  },
  widget_image_alt: {
    en: 'Latest image of {name}',
    fr: 'Dernière image de {name}',
    de: 'Letztes Bild von {name}',
    es: 'Última imagen de {name}',
  },
  widget_other_preset: {
    en: 'Other preset',
    fr: 'Autre preset',
    de: 'Anderes Preset',
    es: 'Otro preset',
  },
  widget_preset: {
    en: 'Preset',
    fr: 'Preset',
    de: 'Preset',
    es: 'Preset',
  },
  // Movement labels (widget buttons, scene options).
  move_left: { en: 'Left', fr: 'Gauche', de: 'Links', es: 'Izquierda' },
  move_right: { en: 'Right', fr: 'Droite', de: 'Rechts', es: 'Derecha' },
  move_up: { en: 'Up', fr: 'Haut', de: 'Hoch', es: 'Arriba' },
  move_down: { en: 'Down', fr: 'Bas', de: 'Runter', es: 'Abajo' },
  // Detection kinds.
  detection_motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  detection_person: { en: 'Person', fr: 'Personne', de: 'Person', es: 'Persona' },
};

/**
 * A message in every language, placeholders `{name}` replaced.
 * @param {keyof MESSAGES} key
 * @param {Record<string, string|number>} [vars]
 * @returns {{ en: string, fr: string, de: string, es: string }}
 */
export function t(key, vars = {}) {
  const entry = MESSAGES[key];
  if (!entry) {
    throw new Error(`Unknown message "${key}"`);
  }
  const result = {};
  for (const lang of LANGUAGES) {
    result[lang] = entry[lang].replace(/\{(\w+)\}/g, (match, name) => {
      const value = vars[name];
      if (value === undefined) {
        return match;
      }
      // A value can itself be a multi-language object (a nested message).
      return typeof value === 'object' && value !== null ? (value[lang] ?? value.en) : value;
    });
  }
  return result;
}

/**
 * Join multi-language objects (or plain strings) language by language.
 * @param {Array<object|string>} parts
 * @param {string} [separator]
 */
export function joinMessages(parts, separator = ' ') {
  const result = {};
  for (const lang of LANGUAGES) {
    result[lang] = parts
      .map((part) => (typeof part === 'string' ? part : (part[lang] ?? part.en)))
      .join(separator);
  }
  return result;
}

/**
 * Cut every language of a message to `max` characters (toasts: 200).
 * @param {object} message
 * @param {number} max
 */
export function truncateMessage(message, max) {
  const result = {};
  for (const [lang, text] of Object.entries(message)) {
    result[lang] = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  return result;
}
