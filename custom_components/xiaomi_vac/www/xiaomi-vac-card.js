/**
 * Xiaomi Vac Card — "Atlas".
 * Map-forward, calm, native. Swipe between the vacuum image and the map(s);
 * persistent chrome (status/battery + vibrancy control tray). Infinite loop.
 *
 *   type: custom:xiaomi-vac-card
 *   vacuum: vacuum.kevin_jonas
 * Optional: map (camera), water/fan/mode (select), presets (list), display toggles
 *
 * Map data comes from the integration's vector endpoint
 * (/api/xiaomi_vac/map/{entry_id}) — room polygons, walls, path, dock, etc.
 */

// Wrapped in its own scope so re-evaluating this file (e.g. an old cached
// copy still loaded in a long-open tab alongside a newly re-registered
// resource URL) can never collide with a previous load — every const/class
// below is scoped to THIS invocation only, not the page global scope.
(function () {

// Explicit early exit if this file's already been evaluated once (belt and
// suspenders alongside the outer wrapper above — covers any loading path
// that might not isolate scope as cleanly as a normal <script type=module>
// tag would, e.g. a duplicate Lovelace resource registration pointing at
// this same file from two places at once).
if (customElements.get("xiaomi-vac-card")) return;


// --- i18n ------------------------------------------------------------------
// Matches the languages shipped in custom_components/xiaomi_vac/translations/.
// Follows the active Home Assistant UI language automatically (hass.language /
// hass.locale.language) — there's no separate card language setting. English
// is the guaranteed-complete fallback for any missing key in any language.
// pt/pt-BR reuse the exact wording already validated in this project's own
// dashboards; the rest are a solid-faith pass but, like any UI translation,
// would benefit from a native-speaker pass via PR if something reads oddly.
const CARD_I18N = {
  en: {
    status_cleaning: "Cleaning", status_paused: "Paused", status_docked: "Docked",
    status_idle: "Idle", status_returning: "Returning", status_unknown: "Unknown",
    status_error: "Error", error_fault: "Error · fault {n}",
    unit_min: "min", unit_hour: "h",
    viewport_aria: "Vacuum and map — use left and right arrow keys to switch",
    start_title: "Start / pause", start_aria: "Start or pause",
    dock_title: "Return to dock", locate_title: "Locate", locate_aria: "Locate vacuum",
    fan_title: "Suction", fan_aria: "Cycle suction level",
    water_title: "Water level", water_aria: "Cycle water level",
    mode_title: "Cleaning mode", mode_aria: "Cycle cleaning mode",
    presets_title: "Presets", presets_aria: "Open presets",
    sheet_mode: "Mode", sheet_suction: "Suction", sheet_water: "Water",
    sheet_remove: "Remove", sheet_confirm: "Add to clean",
    presets_empty: "No presets configured yet. Add them in the card's visual editor.",
    hint_prefix: "Set a ", hint_suffix: " entity in the card configuration.",
    map_badge_active: "Active", dots_vacuum: "Vacuum", dots_map: "Map {n}",
    room_clean_aria: "Clean {name}", roomtag_one: "Clean 1 room", roomtag_many: "Clean {n} rooms",
    toast_pref_failed: "Couldn't set room preferences",
    mode_sweep: "Sweep", mode_sweep_mop: "Sweep + Mop", mode_mop: "Mop", mode_sweep_then_mop: "Sweep then Mop",
    power_silent: "Silent", power_basic: "Basic", power_strong: "Strong", power_full: "Full Speed",
    editor_vacuum: "Vacuum", editor_map: "Map camera", editor_fan: "Fan speed select entity",
    editor_water: "Water level select entity", editor_mode: "Cleaning mode select entity",
    editor_show_vacuum_page: "Show vacuum page", editor_show_map: "Show map",
    editor_show_controls: "Show controls", editor_show_fan: "Show suction control",
    editor_show_water: "Show water control", editor_show_mode: "Show cleaning mode control",
    editor_show_room_labels: "Show room labels", editor_allow_room_cleaning: "Allow room cleaning",
    editor_presets: "Presets (list of {name, script})",
  },
  pt: {
    status_cleaning: "A limpar", status_paused: "Em pausa", status_docked: "Na base",
    status_idle: "Inativo", status_returning: "A regressar", status_unknown: "Desconhecido",
    status_error: "Erro", error_fault: "Erro · falha {n}",
    unit_min: "min", unit_hour: "h",
    viewport_aria: "Aspirador e mapa — use as setas esquerda e direita para alternar",
    start_title: "Iniciar / pausar", start_aria: "Iniciar ou pausar",
    dock_title: "Regressar à base", locate_title: "Localizar", locate_aria: "Localizar aspirador",
    fan_title: "Potência", fan_aria: "Alternar potência de sucção",
    water_title: "Nível de água", water_aria: "Alternar nível de água",
    mode_title: "Modo de limpeza", mode_aria: "Alternar modo de limpeza",
    presets_title: "Predefinições", presets_aria: "Abrir predefinições",
    sheet_mode: "Modo", sheet_suction: "Potência", sheet_water: "Água",
    sheet_remove: "Remover", sheet_confirm: "Adicionar à limpeza",
    presets_empty: "Ainda não há predefinições configuradas. Adicione-as no editor visual do cartão.",
    hint_prefix: "Defina uma entidade de ", hint_suffix: " na configuração do cartão.",
    map_badge_active: "Ativo", dots_vacuum: "Aspirador", dots_map: "Mapa {n}",
    room_clean_aria: "Limpar {name}", roomtag_one: "Limpar 1 divisão", roomtag_many: "Limpar {n} divisões",
    toast_pref_failed: "Não foi possível definir as preferências da divisão",
    mode_sweep: "Aspirar", mode_sweep_mop: "Aspirar e Esfregar", mode_mop: "Esfregar", mode_sweep_then_mop: "Aspirar Depois Esfregar",
    power_silent: "Silencioso", power_basic: "Básico", power_strong: "Forte", power_full: "Velocidade Máxima",
    editor_vacuum: "Aspirador", editor_map: "Câmara do mapa", editor_fan: "Entidade select de potência",
    editor_water: "Entidade select de nível de água", editor_mode: "Entidade select de modo de limpeza",
    editor_show_vacuum_page: "Mostrar página do aspirador", editor_show_map: "Mostrar mapa",
    editor_show_controls: "Mostrar controlos", editor_show_fan: "Mostrar controlo de potência",
    editor_show_water: "Mostrar controlo de água", editor_show_mode: "Mostrar controlo de modo de limpeza",
    editor_show_room_labels: "Mostrar nomes das divisões", editor_allow_room_cleaning: "Permitir limpeza por divisão",
    editor_presets: "Predefinições (lista de {name, script})",
  },
  "pt-br": {
    status_cleaning: "Limpando", status_paused: "Pausado", status_docked: "Na base",
    status_idle: "Ocioso", status_returning: "Retornando", status_unknown: "Desconhecido",
    status_error: "Erro", error_fault: "Erro · falha {n}",
    unit_min: "min", unit_hour: "h",
    viewport_aria: "Aspirador e mapa — use as setas esquerda e direita para alternar",
    start_title: "Iniciar / pausar", start_aria: "Iniciar ou pausar",
    dock_title: "Retornar à base", locate_title: "Localizar", locate_aria: "Localizar aspirador",
    fan_title: "Sucção", fan_aria: "Alternar potência de sucção",
    water_title: "Nível de água", water_aria: "Alternar nível de água",
    mode_title: "Modo de limpeza", mode_aria: "Alternar modo de limpeza",
    presets_title: "Predefinições", presets_aria: "Abrir predefinições",
    sheet_mode: "Modo", sheet_suction: "Sucção", sheet_water: "Água",
    sheet_remove: "Remover", sheet_confirm: "Adicionar à limpeza",
    presets_empty: "Nenhuma predefinição configurada ainda. Adicione no editor visual do cartão.",
    hint_prefix: "Defina uma entidade de ", hint_suffix: " na configuração do cartão.",
    map_badge_active: "Ativo", dots_vacuum: "Aspirador", dots_map: "Mapa {n}",
    room_clean_aria: "Limpar {name}", roomtag_one: "Limpar 1 cômodo", roomtag_many: "Limpar {n} cômodos",
    toast_pref_failed: "Não foi possível definir as preferências do cômodo",
    mode_sweep: "Aspirar", mode_sweep_mop: "Aspirar e Passar Pano", mode_mop: "Passar Pano", mode_sweep_then_mop: "Aspirar e Depois Passar Pano",
    power_silent: "Silencioso", power_basic: "Básico", power_strong: "Forte", power_full: "Velocidade Máxima",
    editor_vacuum: "Aspirador", editor_map: "Câmera do mapa", editor_fan: "Entidade select de sucção",
    editor_water: "Entidade select de nível de água", editor_mode: "Entidade select de modo de limpeza",
    editor_show_vacuum_page: "Mostrar página do aspirador", editor_show_map: "Mostrar mapa",
    editor_show_controls: "Mostrar controles", editor_show_fan: "Mostrar controle de sucção",
    editor_show_water: "Mostrar controle de água", editor_show_mode: "Mostrar controle de modo de limpeza",
    editor_show_room_labels: "Mostrar nomes dos cômodos", editor_allow_room_cleaning: "Permitir limpeza por cômodo",
    editor_presets: "Predefinições (lista de {name, script})",
  },
  de: {
    status_cleaning: "Reinigt", status_paused: "Pausiert", status_docked: "Angedockt",
    status_idle: "Bereit", status_returning: "Kehrt zurück", status_unknown: "Unbekannt",
    status_error: "Fehler", error_fault: "Fehler · Störung {n}",
    unit_min: "Min", unit_hour: "Std",
    viewport_aria: "Staubsauger und Karte — mit den Pfeiltasten links/rechts wechseln",
    start_title: "Start / Pause", start_aria: "Starten oder pausieren",
    dock_title: "Zur Ladestation", locate_title: "Orten", locate_aria: "Staubsauger orten",
    fan_title: "Saugkraft", fan_aria: "Saugkraft wechseln",
    water_title: "Wasserstand", water_aria: "Wasserstand wechseln",
    mode_title: "Reinigungsmodus", mode_aria: "Reinigungsmodus wechseln",
    presets_title: "Voreinstellungen", presets_aria: "Voreinstellungen öffnen",
    sheet_mode: "Modus", sheet_suction: "Saugkraft", sheet_water: "Wasser",
    sheet_remove: "Entfernen", sheet_confirm: "Zur Reinigung hinzufügen",
    presets_empty: "Noch keine Voreinstellungen konfiguriert. Im visuellen Editor der Karte hinzufügen.",
    hint_prefix: "Legen Sie eine ", hint_suffix: "-Entität in der Kartenkonfiguration fest.",
    map_badge_active: "Aktiv", dots_vacuum: "Staubsauger", dots_map: "Karte {n}",
    room_clean_aria: "{name} reinigen", roomtag_one: "1 Raum reinigen", roomtag_many: "{n} Räume reinigen",
    toast_pref_failed: "Raumeinstellungen konnten nicht gesetzt werden",
    mode_sweep: "Saugen", mode_sweep_mop: "Saugen + Wischen", mode_mop: "Wischen", mode_sweep_then_mop: "Saugen, dann Wischen",
    power_silent: "Leise", power_basic: "Standard", power_strong: "Stark", power_full: "Volle Leistung",
    editor_vacuum: "Staubsauger", editor_map: "Karten-Kamera", editor_fan: "Saugkraft-Auswahlentität",
    editor_water: "Wasserstand-Auswahlentität", editor_mode: "Reinigungsmodus-Auswahlentität",
    editor_show_vacuum_page: "Staubsaugerseite anzeigen", editor_show_map: "Karte anzeigen",
    editor_show_controls: "Steuerung anzeigen", editor_show_fan: "Saugkraftregler anzeigen",
    editor_show_water: "Wasserstandregler anzeigen", editor_show_mode: "Reinigungsmodusregler anzeigen",
    editor_show_room_labels: "Raumbezeichnungen anzeigen", editor_allow_room_cleaning: "Raumreinigung erlauben",
    editor_presets: "Voreinstellungen (Liste von {name, script})",
  },
  es: {
    status_cleaning: "Limpiando", status_paused: "Pausado", status_docked: "En la base",
    status_idle: "Inactivo", status_returning: "Regresando", status_unknown: "Desconocido",
    status_error: "Error", error_fault: "Error · fallo {n}",
    unit_min: "min", unit_hour: "h",
    viewport_aria: "Aspiradora y mapa — use las flechas izquierda y derecha para cambiar",
    start_title: "Iniciar / pausar", start_aria: "Iniciar o pausar",
    dock_title: "Volver a la base", locate_title: "Localizar", locate_aria: "Localizar aspiradora",
    fan_title: "Succión", fan_aria: "Cambiar nivel de succión",
    water_title: "Nivel de agua", water_aria: "Cambiar nivel de agua",
    mode_title: "Modo de limpieza", mode_aria: "Cambiar modo de limpieza",
    presets_title: "Preajustes", presets_aria: "Abrir preajustes",
    sheet_mode: "Modo", sheet_suction: "Succión", sheet_water: "Agua",
    sheet_remove: "Quitar", sheet_confirm: "Añadir a la limpieza",
    presets_empty: "Aún no hay preajustes configurados. Añádelos en el editor visual de la tarjeta.",
    hint_prefix: "Configura una entidad de ", hint_suffix: " en la configuración de la tarjeta.",
    map_badge_active: "Activo", dots_vacuum: "Aspiradora", dots_map: "Mapa {n}",
    room_clean_aria: "Limpiar {name}", roomtag_one: "Limpiar 1 habitación", roomtag_many: "Limpiar {n} habitaciones",
    toast_pref_failed: "No se pudieron establecer las preferencias de la habitación",
    mode_sweep: "Aspirar", mode_sweep_mop: "Aspirar y Fregar", mode_mop: "Fregar", mode_sweep_then_mop: "Aspirar y Luego Fregar",
    power_silent: "Silencioso", power_basic: "Básico", power_strong: "Fuerte", power_full: "Velocidad Máxima",
    editor_vacuum: "Aspiradora", editor_map: "Cámara del mapa", editor_fan: "Entidad select de succión",
    editor_water: "Entidad select de nivel de agua", editor_mode: "Entidad select de modo de limpieza",
    editor_show_vacuum_page: "Mostrar página de la aspiradora", editor_show_map: "Mostrar mapa",
    editor_show_controls: "Mostrar controles", editor_show_fan: "Mostrar control de succión",
    editor_show_water: "Mostrar control de agua", editor_show_mode: "Mostrar control de modo de limpieza",
    editor_show_room_labels: "Mostrar nombres de habitaciones", editor_allow_room_cleaning: "Permitir limpieza por habitación",
    editor_presets: "Preajustes (lista de {name, script})",
  },
  fr: {
    status_cleaning: "Nettoyage", status_paused: "En pause", status_docked: "À la base",
    status_idle: "Inactif", status_returning: "Retour en cours", status_unknown: "Inconnu",
    status_error: "Erreur", error_fault: "Erreur · défaut {n}",
    unit_min: "min", unit_hour: "h",
    viewport_aria: "Aspirateur et carte — utilisez les flèches gauche/droite pour changer",
    start_title: "Démarrer / pause", start_aria: "Démarrer ou mettre en pause",
    dock_title: "Retour à la base", locate_title: "Localiser", locate_aria: "Localiser l'aspirateur",
    fan_title: "Aspiration", fan_aria: "Changer le niveau d'aspiration",
    water_title: "Niveau d'eau", water_aria: "Changer le niveau d'eau",
    mode_title: "Mode de nettoyage", mode_aria: "Changer le mode de nettoyage",
    presets_title: "Préréglages", presets_aria: "Ouvrir les préréglages",
    sheet_mode: "Mode", sheet_suction: "Aspiration", sheet_water: "Eau",
    sheet_remove: "Retirer", sheet_confirm: "Ajouter au nettoyage",
    presets_empty: "Aucun préréglage configuré pour l'instant. Ajoutez-les dans l'éditeur visuel de la carte.",
    hint_prefix: "Définissez une entité ", hint_suffix: " dans la configuration de la carte.",
    map_badge_active: "Active", dots_vacuum: "Aspirateur", dots_map: "Carte {n}",
    room_clean_aria: "Nettoyer {name}", roomtag_one: "Nettoyer 1 pièce", roomtag_many: "Nettoyer {n} pièces",
    toast_pref_failed: "Impossible de définir les préférences de la pièce",
    mode_sweep: "Aspirer", mode_sweep_mop: "Aspirer + Laver", mode_mop: "Laver", mode_sweep_then_mop: "Aspirer puis Laver",
    power_silent: "Silencieux", power_basic: "Standard", power_strong: "Fort", power_full: "Vitesse Maximale",
    editor_vacuum: "Aspirateur", editor_map: "Caméra de la carte", editor_fan: "Entité select d'aspiration",
    editor_water: "Entité select de niveau d'eau", editor_mode: "Entité select de mode de nettoyage",
    editor_show_vacuum_page: "Afficher la page de l'aspirateur", editor_show_map: "Afficher la carte",
    editor_show_controls: "Afficher les contrôles", editor_show_fan: "Afficher le contrôle d'aspiration",
    editor_show_water: "Afficher le contrôle d'eau", editor_show_mode: "Afficher le contrôle du mode de nettoyage",
    editor_show_room_labels: "Afficher les noms des pièces", editor_allow_room_cleaning: "Autoriser le nettoyage par pièce",
    editor_presets: "Préréglages (liste de {name, script})",
  },
  it: {
    status_cleaning: "Pulizia in corso", status_paused: "In pausa", status_docked: "Sulla base",
    status_idle: "Inattivo", status_returning: "In rientro", status_unknown: "Sconosciuto",
    status_error: "Errore", error_fault: "Errore · guasto {n}",
    unit_min: "min", unit_hour: "h",
    viewport_aria: "Aspirapolvere e mappa — usa le frecce sinistra e destra per cambiare",
    start_title: "Avvia / pausa", start_aria: "Avvia o metti in pausa",
    dock_title: "Torna alla base", locate_title: "Localizza", locate_aria: "Localizza aspirapolvere",
    fan_title: "Aspirazione", fan_aria: "Cambia livello di aspirazione",
    water_title: "Livello acqua", water_aria: "Cambia livello acqua",
    mode_title: "Modalità di pulizia", mode_aria: "Cambia modalità di pulizia",
    presets_title: "Preimpostazioni", presets_aria: "Apri preimpostazioni",
    sheet_mode: "Modalità", sheet_suction: "Aspirazione", sheet_water: "Acqua",
    sheet_remove: "Rimuovi", sheet_confirm: "Aggiungi alla pulizia",
    presets_empty: "Nessuna preimpostazione configurata. Aggiungile nell'editor visuale della card.",
    hint_prefix: "Imposta un'entità ", hint_suffix: " nella configurazione della card.",
    map_badge_active: "Attiva", dots_vacuum: "Aspirapolvere", dots_map: "Mappa {n}",
    room_clean_aria: "Pulisci {name}", roomtag_one: "Pulisci 1 stanza", roomtag_many: "Pulisci {n} stanze",
    toast_pref_failed: "Impossibile impostare le preferenze della stanza",
    mode_sweep: "Aspira", mode_sweep_mop: "Aspira e Lava", mode_mop: "Lava", mode_sweep_then_mop: "Aspira poi Lava",
    power_silent: "Silenzioso", power_basic: "Base", power_strong: "Forte", power_full: "Velocità Massima",
    editor_vacuum: "Aspirapolvere", editor_map: "Fotocamera mappa", editor_fan: "Entità select aspirazione",
    editor_water: "Entità select livello acqua", editor_mode: "Entità select modalità di pulizia",
    editor_show_vacuum_page: "Mostra pagina aspirapolvere", editor_show_map: "Mostra mappa",
    editor_show_controls: "Mostra controlli", editor_show_fan: "Mostra controllo aspirazione",
    editor_show_water: "Mostra controllo acqua", editor_show_mode: "Mostra controllo modalità di pulizia",
    editor_show_room_labels: "Mostra nomi delle stanze", editor_allow_room_cleaning: "Consenti pulizia per stanza",
    editor_presets: "Preimpostazioni (elenco di {name, script})",
  },
  nl: {
    status_cleaning: "Bezig met reinigen", status_paused: "Gepauzeerd", status_docked: "Gedockt",
    status_idle: "Inactief", status_returning: "Keert terug", status_unknown: "Onbekend",
    status_error: "Fout", error_fault: "Fout · storing {n}",
    unit_min: "min", unit_hour: "u",
    viewport_aria: "Stofzuiger en kaart — gebruik de pijltjestoetsen links/rechts om te wisselen",
    start_title: "Start / pauze", start_aria: "Starten of pauzeren",
    dock_title: "Terug naar dock", locate_title: "Zoeken", locate_aria: "Stofzuiger zoeken",
    fan_title: "Zuigkracht", fan_aria: "Zuigkracht wisselen",
    water_title: "Waterniveau", water_aria: "Waterniveau wisselen",
    mode_title: "Reinigingsmodus", mode_aria: "Reinigingsmodus wisselen",
    presets_title: "Voorinstellingen", presets_aria: "Voorinstellingen openen",
    sheet_mode: "Modus", sheet_suction: "Zuigkracht", sheet_water: "Water",
    sheet_remove: "Verwijderen", sheet_confirm: "Toevoegen aan reiniging",
    presets_empty: "Nog geen voorinstellingen ingesteld. Voeg ze toe in de visuele editor van de kaart.",
    hint_prefix: "Stel een ", hint_suffix: "-entiteit in bij de kaartconfiguratie.",
    map_badge_active: "Actief", dots_vacuum: "Stofzuiger", dots_map: "Kaart {n}",
    room_clean_aria: "{name} reinigen", roomtag_one: "1 kamer reinigen", roomtag_many: "{n} kamers reinigen",
    toast_pref_failed: "Kamervoorkeuren konden niet worden ingesteld",
    mode_sweep: "Zuigen", mode_sweep_mop: "Zuigen + Dweilen", mode_mop: "Dweilen", mode_sweep_then_mop: "Zuigen, dan Dweilen",
    power_silent: "Stil", power_basic: "Standaard", power_strong: "Sterk", power_full: "Volle Kracht",
    editor_vacuum: "Stofzuiger", editor_map: "Kaartcamera", editor_fan: "Zuigkracht select-entiteit",
    editor_water: "Waterniveau select-entiteit", editor_mode: "Reinigingsmodus select-entiteit",
    editor_show_vacuum_page: "Stofzuigerpagina tonen", editor_show_map: "Kaart tonen",
    editor_show_controls: "Bediening tonen", editor_show_fan: "Zuigkrachtregeling tonen",
    editor_show_water: "Waterregeling tonen", editor_show_mode: "Reinigingsmodusregeling tonen",
    editor_show_room_labels: "Kamernamen tonen", editor_allow_room_cleaning: "Reiniging per kamer toestaan",
    editor_presets: "Voorinstellingen (lijst van {name, script})",
  },
  pl: {
    status_cleaning: "Sprzątanie", status_paused: "Wstrzymano", status_docked: "Na stacji",
    status_idle: "Bezczynny", status_returning: "Powrót do bazy", status_unknown: "Nieznany",
    status_error: "Błąd", error_fault: "Błąd · usterka {n}",
    unit_min: "min", unit_hour: "godz",
    viewport_aria: "Odkurzacz i mapa — użyj strzałek lewo/prawo, aby przełączać",
    start_title: "Start / pauza", start_aria: "Uruchom lub wstrzymaj",
    dock_title: "Wróć do stacji", locate_title: "Zlokalizuj", locate_aria: "Zlokalizuj odkurzacz",
    fan_title: "Moc ssania", fan_aria: "Zmień moc ssania",
    water_title: "Poziom wody", water_aria: "Zmień poziom wody",
    mode_title: "Tryb sprzątania", mode_aria: "Zmień tryb sprzątania",
    presets_title: "Ustawienia wstępne", presets_aria: "Otwórz ustawienia wstępne",
    sheet_mode: "Tryb", sheet_suction: "Moc ssania", sheet_water: "Woda",
    sheet_remove: "Usuń", sheet_confirm: "Dodaj do sprzątania",
    presets_empty: "Nie skonfigurowano jeszcze żadnych ustawień wstępnych. Dodaj je w edytorze wizualnym karty.",
    hint_prefix: "Ustaw encję ", hint_suffix: " w konfiguracji karty.",
    map_badge_active: "Aktywna", dots_vacuum: "Odkurzacz", dots_map: "Mapa {n}",
    room_clean_aria: "Sprzątnij {name}", roomtag_one: "Sprzątnij 1 pomieszczenie", roomtag_many: "Sprzątnij {n} pomieszczeń",
    toast_pref_failed: "Nie udało się ustawić preferencji pomieszczenia",
    mode_sweep: "Odkurzanie", mode_sweep_mop: "Odkurzanie + Mycie", mode_mop: "Mycie", mode_sweep_then_mop: "Odkurzanie, potem Mycie",
    power_silent: "Cichy", power_basic: "Podstawowy", power_strong: "Mocny", power_full: "Pełna Moc",
    editor_vacuum: "Odkurzacz", editor_map: "Kamera mapy", editor_fan: "Encja select mocy ssania",
    editor_water: "Encja select poziomu wody", editor_mode: "Encja select trybu sprzątania",
    editor_show_vacuum_page: "Pokaż stronę odkurzacza", editor_show_map: "Pokaż mapę",
    editor_show_controls: "Pokaż sterowanie", editor_show_fan: "Pokaż sterowanie mocą ssania",
    editor_show_water: "Pokaż sterowanie wodą", editor_show_mode: "Pokaż sterowanie trybem sprzątania",
    editor_show_room_labels: "Pokaż nazwy pomieszczeń", editor_allow_room_cleaning: "Zezwól na sprzątanie pomieszczeniami",
    editor_presets: "Ustawienia wstępne (lista {name, script})",
  },
  ru: {
    status_cleaning: "Уборка", status_paused: "Пауза", status_docked: "На базе",
    status_idle: "Ожидание", status_returning: "Возврат на базу", status_unknown: "Неизвестно",
    status_error: "Ошибка", error_fault: "Ошибка · сбой {n}",
    unit_min: "мин", unit_hour: "ч",
    viewport_aria: "Пылесос и карта — используйте стрелки влево/вправо для переключения",
    start_title: "Старт / пауза", start_aria: "Запустить или приостановить",
    dock_title: "Вернуться на базу", locate_title: "Найти", locate_aria: "Найти пылесос",
    fan_title: "Мощность всасывания", fan_aria: "Переключить мощность всасывания",
    water_title: "Уровень воды", water_aria: "Переключить уровень воды",
    mode_title: "Режим уборки", mode_aria: "Переключить режим уборки",
    presets_title: "Пресеты", presets_aria: "Открыть пресеты",
    sheet_mode: "Режим", sheet_suction: "Мощность", sheet_water: "Вода",
    sheet_remove: "Удалить", sheet_confirm: "Добавить к уборке",
    presets_empty: "Пресеты ещё не настроены. Добавьте их в визуальном редакторе карточки.",
    hint_prefix: "Укажите объект ", hint_suffix: " в настройках карточки.",
    map_badge_active: "Активна", dots_vacuum: "Пылесос", dots_map: "Карта {n}",
    room_clean_aria: "Убрать {name}", roomtag_one: "Убрать 1 комнату", roomtag_many: "Убрать комнат: {n}",
    toast_pref_failed: "Не удалось задать настройки комнаты",
    mode_sweep: "Пылесосить", mode_sweep_mop: "Пылесосить + Мыть", mode_mop: "Мыть", mode_sweep_then_mop: "Пылесосить, затем Мыть",
    power_silent: "Тихий", power_basic: "Стандартный", power_strong: "Сильный", power_full: "Максимальная Мощность",
    editor_vacuum: "Пылесос", editor_map: "Камера карты", editor_fan: "Объект select мощности всасывания",
    editor_water: "Объект select уровня воды", editor_mode: "Объект select режима уборки",
    editor_show_vacuum_page: "Показывать страницу пылесоса", editor_show_map: "Показывать карту",
    editor_show_controls: "Показывать управление", editor_show_fan: "Показывать управление мощностью",
    editor_show_water: "Показывать управление водой", editor_show_mode: "Показывать управление режимом уборки",
    editor_show_room_labels: "Показывать названия комнат", editor_allow_room_cleaning: "Разрешить уборку по комнатам",
    editor_presets: "Пресеты (список {name, script})",
  },
  ja: {
    status_cleaning: "清掃中", status_paused: "一時停止", status_docked: "ドッキング中",
    status_idle: "待機中", status_returning: "帰還中", status_unknown: "不明",
    status_error: "エラー", error_fault: "エラー · 故障 {n}",
    unit_min: "分", unit_hour: "時間",
    viewport_aria: "掃除機とマップ — 左右の矢印キーで切り替え",
    start_title: "開始 / 一時停止", start_aria: "開始または一時停止",
    dock_title: "充電ドックへ戻る", locate_title: "位置確認", locate_aria: "掃除機の位置を確認",
    fan_title: "吸引力", fan_aria: "吸引力を切り替え",
    water_title: "水量", water_aria: "水量を切り替え",
    mode_title: "清掃モード", mode_aria: "清掃モードを切り替え",
    presets_title: "プリセット", presets_aria: "プリセットを開く",
    sheet_mode: "モード", sheet_suction: "吸引力", sheet_water: "水量",
    sheet_remove: "削除", sheet_confirm: "清掃に追加",
    presets_empty: "プリセットはまだ設定されていません。カードのビジュアルエディタで追加してください。",
    hint_prefix: "カードの設定で", hint_suffix: " エンティティを指定してください。",
    map_badge_active: "アクティブ", dots_vacuum: "掃除機", dots_map: "マップ {n}",
    room_clean_aria: "{name}を清掃", roomtag_one: "1部屋を清掃", roomtag_many: "{n}部屋を清掃",
    toast_pref_failed: "部屋の設定を適用できませんでした",
    mode_sweep: "吸引", mode_sweep_mop: "吸引 + 水拭き", mode_mop: "水拭き", mode_sweep_then_mop: "吸引後に水拭き",
    power_silent: "静音", power_basic: "標準", power_strong: "強力", power_full: "最大出力",
    editor_vacuum: "掃除機", editor_map: "マップカメラ", editor_fan: "吸引力セレクトエンティティ",
    editor_water: "水量セレクトエンティティ", editor_mode: "清掃モードセレクトエンティティ",
    editor_show_vacuum_page: "掃除機ページを表示", editor_show_map: "マップを表示",
    editor_show_controls: "コントロールを表示", editor_show_fan: "吸引力コントロールを表示",
    editor_show_water: "水量コントロールを表示", editor_show_mode: "清掃モードコントロールを表示",
    editor_show_room_labels: "部屋名を表示", editor_allow_room_cleaning: "部屋ごとの清掃を許可",
    editor_presets: "プリセット（{name, script} のリスト）",
  },
  "zh-hans": {
    status_cleaning: "清扫中", status_paused: "已暂停", status_docked: "已入座",
    status_idle: "空闲", status_returning: "返回中", status_unknown: "未知",
    status_error: "错误", error_fault: "错误 · 故障 {n}",
    unit_min: "分钟", unit_hour: "小时",
    viewport_aria: "扫地机与地图 — 使用左右方向键切换",
    start_title: "开始 / 暂停", start_aria: "开始或暂停",
    dock_title: "返回基站", locate_title: "定位", locate_aria: "定位扫地机",
    fan_title: "吸力", fan_aria: "切换吸力等级",
    water_title: "水量", water_aria: "切换水量等级",
    mode_title: "清扫模式", mode_aria: "切换清扫模式",
    presets_title: "预设", presets_aria: "打开预设",
    sheet_mode: "模式", sheet_suction: "吸力", sheet_water: "水量",
    sheet_remove: "移除", sheet_confirm: "加入清扫",
    presets_empty: "尚未配置预设。请在卡片的可视化编辑器中添加。",
    hint_prefix: "请在卡片配置中设置一个 ", hint_suffix: " 实体。",
    map_badge_active: "当前地图", dots_vacuum: "扫地机", dots_map: "地图 {n}",
    room_clean_aria: "清扫{name}", roomtag_one: "清扫 1 个房间", roomtag_many: "清扫 {n} 个房间",
    toast_pref_failed: "无法设置房间偏好",
    mode_sweep: "扫地", mode_sweep_mop: "扫拖", mode_mop: "拖地", mode_sweep_then_mop: "先扫后拖",
    power_silent: "安静", power_basic: "标准", power_strong: "强力", power_full: "最大吸力",
    editor_vacuum: "扫地机", editor_map: "地图摄像头", editor_fan: "吸力选择实体",
    editor_water: "水量选择实体", editor_mode: "清扫模式选择实体",
    editor_show_vacuum_page: "显示扫地机页面", editor_show_map: "显示地图",
    editor_show_controls: "显示控制", editor_show_fan: "显示吸力控制",
    editor_show_water: "显示水量控制", editor_show_mode: "显示清扫模式控制",
    editor_show_room_labels: "显示房间名称", editor_allow_room_cleaning: "允许按房间清扫",
    editor_presets: "预设（{name, script} 列表）",
  },
};

function cardT(hass, key, vars) {
  const raw = (hass && (hass.language || (hass.locale && hass.locale.language))) || "en";
  const lang = String(raw).toLowerCase();
  const table = CARD_I18N[lang] || CARD_I18N[lang.split("-")[0]] || CARD_I18N.en;
  let s = table[key] != null ? table[key] : CARD_I18N.en[key] != null ? CARD_I18N.en[key] : key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}


const ACCENT = {            // state-driven accent (information, not decoration)
  cleaning: "#30b65a", returning: "#e8973a", paused: "#e8973a",
  error: "#e2483d", docked: "#5b6470", idle: "#5b6470", unknown: "#5b6470",
};
// room fill palette (translucent so it reads on light or dark floors)
const ROOM_TINTS = [
  ["rgba(90,150,220,.30)", "rgba(90,150,220,.85)"],
  ["rgba(70,185,160,.30)", "rgba(70,185,160,.85)"],
  ["rgba(210,170,90,.32)", "rgba(210,170,90,.9)"],
  ["rgba(170,130,220,.30)", "rgba(170,130,220,.85)"],
  ["rgba(225,120,140,.30)", "rgba(225,120,140,.85)"],
  ["rgba(120,190,90,.30)", "rgba(120,190,90,.85)"],
];
const HTML_ESCAPES = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};

// Packed room-preference numeric codes — matches xiaomi_vac's device.py
// format_room_preference() exactly, and the mode/power mapping confirmed
// against the user's own working AppDaemon script (mode_map/power_map).
// Water level has no confirmed textual naming from the device spec, so it
// stays numeric (0-3) rather than guessing English labels that might be wrong.
const MODE_OPTIONS = [
  { value: 0, label: "Sweep", key: "mode_sweep" },
  { value: 1, label: "Sweep + Mop", key: "mode_sweep_mop" },
  { value: 2, label: "Mop", key: "mode_mop" },
  { value: 3, label: "Sweep then Mop", key: "mode_sweep_then_mop" },
];
const POWER_OPTIONS = [
  { value: 0, label: "Silent", key: "power_silent" },
  { value: 1, label: "Basic", key: "power_basic" },
  { value: 2, label: "Strong", key: "power_strong" },
  { value: 3, label: "Full Speed", key: "power_full" },
];
const WATER_OPTIONS = [
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
];
const ROOM_SETTING_DEFAULTS = { clean_mode: 0, wind_power: 1, water_level: 2 };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
const roomIndexById = (rooms) => Object.fromEntries((rooms || []).map((r, i) => [r.id, i]));

// model short-form: "dreame.vacuum.mb1808" -> "dreame.mb1808" (strips the middle "vacuum" segment)
const modelShort = (m) => {
  if (!m) return "";
  const model = String(m);
  const p = model.split(".");
  return (p.length >= 3 && p[1] === "vacuum") ? p[0] + "." + p.slice(2).join(".") : model;
};
// shape 1 is the default fallback for unmapped models
const MODEL_SHAPE = Object.fromEntries([
  [1, ["dreame.mb1808","dreame.mc1808","xiaomi.ov21gl","xiaomi.ov43gb","dreame.md1808","dreame.p2008","dreame.p2140a","dreame.p2140o","dreame.p2140p","ijai.v10","ijai.v14"]],
  [2, ["dreame.p2029","dreame.p2028","dreame.p2028a","dreame.p2150b","dreame.p2150o"]],
  [3, ["ijai.v2","ijai.v3","xiaomi.c104","rockrobo.v1","xiaomi.d110ch","xiaomi.d103cn","xiaomi.d102gl","xiaomi.d102ev","xiaomi.d101","xiaomi.c107","xiaomi.c102gl","xiaomi.c102cn","xiaomi.c101eu","xiaomi.c101","dreame.p2114a","dreame.p2114o","dreame.r2210","dreame.r2209","dreame.r2211o","dreame.r2228","dreame.r2228o","dreame.r2228z","dreame.r2232a","dreame.r2233","dreame.r2246","dreame.r2247","dreame.r2254","dreame.s5"]],
  [4, ["ijai.v17","ijai.v18","ijai.v19","xiaomi.b106eu"]],
  [5, ["dreame.p2041","dreame.p2041o"]],
  [6, ["dreame.p2009","dreame.p2036"]],
  [7, ["dreame.p2157","dreame.p2259","dreame.p1250a"]],
  [8, ["ijai.v13","ijai.v1","viomi.v24"]],
  [9, ["dreame.p1248o"]],
  [10, ["xiaomi.d106gl","xiaomi.c103","xiaomi.b108gl"]],
  [11, ["viomi.v12","xiaomi.ov71gl","viomi.v13","xiaomi.b106bk","xiaomi.d109gl","dreame.r2215","dreame.r2216o","dreame.r2235"]],
  [12, ["xiaomi.b112","xiaomi.b112gl","xiaomi.c108","viomi.v45"]],
  [13, ["xiaomi.b112bk"]],
  [14, ["viomi.v19"]],
  [15, ["viomi.v40","viomi.v17","viomi.v38","viomi.v22","viomi.v15"]],
  [16, ["viomi.v35"]],
  [17, ["viomi.v23"]],
].flatMap(([shape, ids]) => ids.map((id) => [id, shape])));

const lottieSrc = (model, state) => {
  const shape = MODEL_SHAPE[modelShort(model)] || 1;
  const anim = { cleaning: "vacuuming", returning: "returning", paused: "paused" }[state] || "charging";
  return `/xiaomi-vac-card/lottie/shape-${shape}-${anim}.json`;
};
let _lottieP = null;
const _lottieData = {};
const loadLottie = () => {
  if (window.lottie) return Promise.resolve(window.lottie);
  return _lottieP || (_lottieP = new Promise((res) => {
    const s = document.createElement("script");
    s.src = "/xiaomi-vac-card/lottie.min.js";
    s.onload = () => res(window.lottie);
    s.onerror = () => { _lottieP = null; res(null); };
    document.head.appendChild(s);
  }));
};
const fetchLottie = (src) => {
  if (!_lottieData[src]) _lottieData[src] = fetch(src).then((r) => r.json()).catch(() => null);
  return _lottieData[src];
};
// "rgba(90,150,220,.30)" -> [r,g,b,a] for direct canvas pixel writes
const parseRGBA = (s) => {
  const n = (s.match(/[\d.]+/g) || []).map(Number);
  return [n[0] | 0, n[1] | 0, n[2] | 0, n[3] == null ? 1 : n[3]];
};

// Tray icons use HA's bundled MDI set via <ha-icon> so they render identically
// to native cards (the old hand-rolled SVGs were janky and inconsistent).
const MDI = {
  play: "mdi:play", pause: "mdi:pause", dock: "mdi:home-map-marker",
  locate: "mdi:map-marker-radius", fan: "mdi:fan", water: "mdi:water", map: "mdi:layers",
  mode: "mdi:broom", presets: "mdi:star-four-points-outline",
};
// `charging` overlays a bolt — docked-and-charging reads identically to
// docked-and-full otherwise (same grey accent, same fill bar).
const batteryIcon = (p, charging) =>
  `<svg viewBox="0 0 26 24"><rect x="1" y="6.5" width="20" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="22.5" y="9.5" width="2" height="5" rx="1" fill="currentColor"/><rect x="3" y="8.5" width="${Math.max(0, 0.16 * p)}" height="7" rx="1" fill="currentColor"/>` +
  (charging ? `<path d="M12.4,7 L8.4,12.6 L11,12.6 L10.4,17 L14.4,11.2 L11.8,11.2 Z" fill="var(--xv-card)" stroke="currentColor" stroke-width="0.7" stroke-linejoin="round"/>` : "") +
  `</svg>`;
const vacuumFallbackSvg = () =>
  `<svg class="vac-fallback" viewBox="0 0 220 220" aria-hidden="true">
    <circle cx="110" cy="112" r="86" fill="none" stroke="currentColor" stroke-width="3"/>
    <path d="M24 111c8 3 15 8 19 15 10 41 37 70 67 70s57-29 67-70c4-7 11-12 19-15" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
    <circle cx="110" cy="66" r="23" fill="var(--xv-card)" stroke="currentColor" stroke-width="3"/>
    <rect x="105" y="150" width="10" height="24" rx="5" fill="var(--xv-card)" stroke="currentColor" stroke-width="2"/>
    <path d="M47 102h126" stroke="currentColor" stroke-width="1.4" opacity=".25"/>
  </svg>`;
const TOGGLE_DEFAULTS = {
  show_vacuum_page: true,
  show_map: true,
  show_controls: true,
  show_fan: true,
  show_water: true,
  show_mode: true,
  show_room_labels: true,
  allow_room_cleaning: true,
};
// Not a boolean toggle, so kept out of TOGGLE_DEFAULTS' true/false merge —
// applied separately in setConfig(). List of {name, script} objects; edited
// as a raw list via the visual editor's object selector (see the editor
// class), since a variable-length repeating name+entity picker isn't
// available as a built-in ha-form selector.
const PRESETS_DEFAULT = [];

class XiaomiVacCard extends HTMLElement {
  static getConfigElement() { return document.createElement("xiaomi-vac-card-editor"); }
  static getStubConfig(hass) {
    const vac = Object.keys(hass.states).find((e) => e.startsWith("vacuum."));
    const map = Object.keys(hass.states).find((e) => e.startsWith("camera.") && e.endsWith("_map"));
    return { vacuum: vac || "vacuum.xiaomi_vac", ...(map ? { map } : {}) };
  }

  setConfig(config) {
    // Merge display-toggle defaults in explicitly — _enabled() only checks
    // "!== false", so an absent key (any config written before show_active_map
    // defaulted off, or any key added in a future version) silently fell back
    // to shown rather than to TOGGLE_DEFAULTS. This is what kept "Active map"
    // visible even after the default changed to false.
    this._config = { presets: PRESETS_DEFAULT, ...TOGGLE_DEFAULTS, ...(config || {}) };
    this._sel = new Set();        // selected room ids
    this._roomSettings = {};      // room id -> {clean_mode, wind_power, water_level}
    this._roomPopupId = null;     // room id currently shown in the settings popup, or null
    this._presetsOpen = false;
    this._pendSel = {};           // optimistic select values, keyed by entity_id
    this._pendSelT = {};
    this._mapsData = [];          // list of map vectors from the endpoint
    this._pages = [];
    this._pos = 1; this._real = 0;
    this._fetchedFor = null;
    if (this._anim) { this._anim.destroy(); this._anim = null; }
    this._animWrap = null; this._animSrc = null;
    if (this._root) { this.innerHTML = ""; this._root = null; }
  }
  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!this._root) this._build();
    if (this._hint) return;
    this._maybeFetch();
    // `hass` is replaced on EVERY state change anywhere in HA; only repaint when
    // an entity WE show actually changed (strict-equality per the frontend docs).
    if (prev && !this._relevantChanged(prev, hass)) return;
    try { this._update(); } catch (e) { console.error("[xiaomi-vac-card]", e); }
  }
  _relevantChanged(a, b) {
    const eids = [
      this._config.vacuum,
      `sensor.${this._base()}_battery`,
      this._config.water || `select.${this._base()}_water_level`,
      this._config.fan || `select.${this._base()}_fan_speed`,
      this._modeEid(),
      `sensor.${this._base()}_clean_time`,
      `sensor.${this._base()}_clean_area`,
      `sensor.${this._base()}_last_clean_time`,
      `sensor.${this._base()}_last_clean_area`,
    ];
    return eids.some((e) => (a.states[e]) !== (b.states[e]));
  }
  // Auto-detected via the entity registry (device_id + translation_key) rather
  // than guessing an entity_id from the vacuum's object_id — the select's slug
  // isn't guaranteed to match the vacuum's (renamed device, id collision, etc).
  _selectEid(configKey, cacheKey, translationKey, fallbackSuffix) {
    if (this._config[configKey]) return this._config[configKey];
    if (this[cacheKey] && this._st(this[cacheKey])) return this[cacheKey];
    const ents = this._hass && this._hass.entities;
    const vacEnt = ents && ents[this._config.vacuum];
    const deviceId = vacEnt && vacEnt.device_id;
    if (ents && deviceId) {
      const found = Object.keys(ents).find((eid) =>
        eid.startsWith("select.") &&
        ents[eid].device_id === deviceId &&
        ents[eid].translation_key === translationKey);
      if (found) { this[cacheKey] = found; return found; }
    }
    return `select.${this._base()}_${fallbackSuffix}`;   // fallback if registry lookup misses
  }
  _modeEid() { return this._selectEid("mode", "_cachedModeEid", "mode", "mode"); }
  getCardSize() { return 10; }   // ~50px/unit; the card is a fixed 520px
  connectedCallback() {
    this._poll = setInterval(() => this._refreshMap(), 8000);
    // Pause polling while scrolled off-screen (a long dashboard mounts every
    // card at once); _refreshMap also guards on document visibility.
    if ("IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => { this._onScreen = es.some((e) => e.isIntersecting); });
      this._io.observe(this);
    } else { this._onScreen = true; }
  }
  disconnectedCallback() {
    clearInterval(this._poll);
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._anim) { this._anim.destroy(); this._anim = null; }
  }

  _base() { return (this._config.vacuum || "").split(".")[1] || ""; }
  _st(eid) { return this._hass && this._hass.states[eid]; }
  // Safe numeric sensor read: null for missing entities, "unknown"/"unavailable"
  // states, or anything that isn't actually a finite number — so callers never
  // have to special-case those themselves, they just get "no data".
  _numState(eid) {
    const e = this._st(eid);
    if (!e) return null;
    const v = Number(e.state);
    return Number.isFinite(v) ? v : null;
  }
  _formatDuration(totalMinutes) {
    const mins = Math.max(0, Math.round(totalMinutes));
    const h = Math.floor(mins / 60), m = mins % 60;
    const uMin = cardT(this._hass, "unit_min"), uHour = cardT(this._hass, "unit_hour");
    return h > 0 ? `${h}${uHour} ${m}${uMin}` : `${m}${uMin}`;
  }
  _svc(d, s, data = {}) { return this._hass.callService(d, s, data); }
  _enabled(name) { return this._config[name] !== false; }
  _mapOffset() { return this._enabled("show_vacuum_page") ? 1 : 0; }
  _entryId() {
    const eid = this._config.map || this._config.vacuum;
    const ent = this._hass && this._hass.entities && this._hass.entities[eid];
    return ent && ent.config_entry_id;
  }

  /* ---------------- data ---------------- */
  _maybeFetch() {
    const target = this._config.map || this._config.vacuum;
    if (this._fetchedFor === target) return;
    this._fetchedFor = target;
    this._refreshMap();
  }
  async _refreshMap() {
    if (!this._hass || !this._config.vacuum) return;
    if (!this._enabled("show_map")) return;
    // Don't poll the API for a tab in the background or a card scrolled out of
    // view. `_onScreen` is undefined until the observer first fires — treat that
    // as visible so the very first fetch isn't skipped.
    if (document.visibilityState === "hidden" || this._onScreen === false) return;
    // Resolve server-side from the entity_id (robust); fall back to entry_id.
    const target = this._entryId() || this._config.map || this._config.vacuum;
    try {
      const r = await this._hass.callApi("GET", `xiaomi_vac/map/${encodeURIComponent(target)}`);
      const maps = (r && Array.isArray(r.maps)) ? r.maps : [];
      const changed = JSON.stringify(maps) !== JSON.stringify(this._mapsData);
      this._mapsData = maps;
      if (changed) { this._rebuild(); this._update(); }
    } catch (e) {
      if (!this._warned) { this._warned = true; console.warn("[xiaomi-vac-card] map fetch failed:", e && e.message ? e.message : e); }
      if (this._mapsData.length) { this._mapsData = []; this._rebuild(); this._update(); }
    }
  }
  // Rebuilding the track resets the DOM; never do it mid-swipe (it would yank the
  // carousel). Defer to the next settle, and keep the user on their current page.
  _rebuild() {
    const track = this._root && this._root.querySelector(".track");
    if (this._down || (track && track.classList.contains("anim"))) { this._pendingRebuild = true; return; }
    this._buildPages(true);
  }

  /* ---------------- build shell ---------------- */
  _build() {
    this._root = document.createElement("ha-card");
    if (!this._config.vacuum) {
      this._hint = true;
      this._root.innerHTML =
        `<div style="padding:18px;color:var(--secondary-text-color);font-size:14px">` +
        `${esc(cardT(this._hass, 'hint_prefix'))}<b style="color:var(--primary-text-color)">vacuum</b>${esc(cardT(this._hass, 'hint_suffix'))}</div>`;
      this.appendChild(this._root);
      return;
    }
    this._hint = false;
    this._root.innerHTML = `
      <style>
        :host,ha-card{--xv-accent:${ACCENT.docked};
          --xv-card:var(--ha-card-background,var(--card-background-color,#fff));
          --xv-ink:var(--primary-text-color);--xv-muted:var(--secondary-text-color);
          --xv-floor:var(--secondary-background-color,#eef1f5);}
        ha-card{overflow:hidden;position:relative;height:520px;border-radius:var(--ha-card-border-radius,20px);container-type:inline-size}
        .vp{position:absolute;inset:0;overflow:hidden;touch-action:pan-y}
        .track{display:flex;height:100%;will-change:transform}
        .track.anim{transition:transform .34s cubic-bezier(.32,.72,0,1)}
        .slide{flex:0 0 100%;height:100%;position:relative;overflow:hidden}
        .topbar{position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;
          justify-content:space-between;padding:16px 18px;pointer-events:none;
          background:linear-gradient(180deg,var(--xv-card),transparent)}
        .status{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:var(--xv-ink)}
        .stxt-detail{font-size:13px;font-weight:500;color:var(--xv-muted);display:none}
        .stxt-detail.show{display:inline}
        .dot{width:9px;height:9px;border-radius:50%;background:var(--xv-accent);
          box-shadow:0 0 0 4px color-mix(in srgb,var(--xv-accent) 18%,transparent);transition:background .3s}
        .batt{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:500;color:var(--xv-ink)}
        .batt .btxt{line-height:1;transform:translateY(1px)}
        .batt .bicon{display:flex}
        .batt svg{width:23px;height:23px;display:block}
        .pg-img{display:flex;flex-direction:column;align-items:center;justify-content:center;
          background:radial-gradient(120% 90% at 50% 0%,var(--xv-card),var(--xv-floor))}
        .pg-img .stage{width:200px;height:200px;display:grid;place-items:center}
        .lottie-wrap{width:100%;height:100%;transform:scale(3);transform-origin:50% 38%}
        .lottie-wrap svg{display:block}
        .vac-fallback{width:100%;height:100%;color:color-mix(in srgb,var(--xv-muted) 55%,transparent);
          transform:scale(.333);transform-origin:50% 38%}
        .pg-img .nm{margin-top:20px;font-size:20px;font-weight:600;color:var(--xv-ink)}
        .pg-img .sub{margin-top:2px;font-size:13px;color:var(--xv-muted)}
        /* pad the map into the visible window so room polygons never draw under
           the status bar or the floating tray — the SVG scales to fit the inset */
        .pg-map{background:radial-gradient(120% 90% at 50% 0%,var(--xv-card),var(--xv-floor));
          box-sizing:border-box;padding:56px 14px 92px}
        .pg-map svg{width:100%;height:100%;display:block}
        .map-badge{position:absolute;top:64px;right:20px;z-index:4;background:var(--xv-accent);color:#fff;
          font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:5px 10px;
          border-radius:9px;box-shadow:0 4px 12px color-mix(in srgb,var(--xv-accent) 40%,transparent);
          pointer-events:none}
        .rm{cursor:pointer;transition:stroke-width .12s}
        /* a mouse click triggers :focus (not :focus-visible), so the UA default
           outline paints a near-black ring hugging the path — kill it on tap */
        .rm:focus{outline:none}
        /* selection feedback is driven by the real selected state, not focus, so a
           mouse tap (no :focus-visible) still shows the room outlined in the accent */
        .rm[aria-pressed="true"]{stroke:var(--xv-accent)!important;stroke-width:0.2!important}
        /* keyboard focus ring (mouse taps never match :focus-visible) */
        .rm:focus-visible{outline:none;stroke:var(--xv-accent)!important;stroke-width:0.2!important}
        .dots{position:absolute;left:0;right:0;bottom:84px;z-index:6;display:flex;gap:7px;justify-content:center;pointer-events:none}
        .dots button{pointer-events:auto;padding:8px 3px;margin:-8px 0;border:0;background:none;cursor:pointer;display:flex;align-items:center}
        .dots i{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,var(--xv-ink) 25%,transparent);transition:.25s}
        .dots i.on{background:var(--xv-accent);width:18px;border-radius:3px}
        .dots button:focus-visible{outline:2px solid var(--xv-accent);outline-offset:3px;border-radius:6px}
        /* transient pill: fan/water level feedback (uniform tray has no inline labels) */
        .toast{position:absolute;left:50%;bottom:108px;z-index:6;transform:translateX(-50%) translateY(4px);
          background:var(--xv-ink);color:var(--xv-card);font-size:12px;font-weight:600;padding:7px 13px;border-radius:11px;
          opacity:0;transition:opacity .18s,transform .18s;pointer-events:none;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.25)}
        .toast.show{opacity:.96;transform:translateX(-50%) translateY(-2px)}
        .roomtag{position:absolute;left:50%;bottom:108px;z-index:6;transform:translateX(-50%);
          background:var(--xv-accent);color:#fff;font-size:13px;font-weight:600;padding:10px 16px;border-radius:12px;
          box-shadow:0 6px 18px rgba(0,0,0,.25);opacity:0;transition:opacity .18s,transform .18s;
          pointer-events:none;white-space:nowrap;cursor:pointer;border:0}
        .roomtag.show{opacity:1;transform:translateX(-50%) translateY(-5px);pointer-events:auto}
        /* uniform segmented control (cf. the native climate card): every button
           equal width, the active action filled with the state accent */
        .tray{position:absolute;left:14px;right:14px;bottom:14px;z-index:7;
          background:color-mix(in srgb,var(--xv-card) 70%,transparent);
          backdrop-filter:blur(22px) saturate(180%);-webkit-backdrop-filter:blur(22px) saturate(180%);
          border:.5px solid color-mix(in srgb,var(--xv-ink) 8%,transparent);border-radius:18px;
          box-shadow:0 8px 30px rgba(0,0,0,.12);display:flex;align-items:stretch;gap:6px;padding:6px}
        .b{flex:1 1 0;min-width:0;height:48px;border-radius:12px;border:0;cursor:pointer;
          background:color-mix(in srgb,var(--xv-ink) 7%,transparent);color:var(--xv-ink);display:grid;place-items:center;
          transition:transform .08s ease,background .2s,color .2s,box-shadow .2s}
        .b:hover{background:color-mix(in srgb,var(--xv-ink) 13%,transparent)}
        .b:active{transform:scale(.94)}
        .b ha-icon{--mdc-icon-size:24px}
        .b.on{background:var(--xv-accent);color:#fff;
          box-shadow:0 4px 14px color-mix(in srgb,var(--xv-accent) 42%,transparent)}
        .b.on:hover{background:var(--xv-accent)}
        .b:focus-visible{outline:2px solid var(--xv-accent);outline-offset:2px}
        /* narrow cards: shrink uniformly, then drop water before things spill */
        @container (max-width:340px){ .tray{gap:5px;padding:5px} .b{height:44px} .b ha-icon{--mdc-icon-size:22px} }
        @container (max-width:240px){ .cyc-water{display:none} }
        @media (prefers-reduced-motion:reduce){.track.anim{transition:none}.dot,.b{transition:none}
          .b:active{transform:none}}
        /* room settings + presets bottom sheets — same backdrop, same slide-up
           motion as native HA dialogs, kept lightweight (no <ha-dialog> dep) */
        .sheet-backdrop{position:absolute;inset:0;z-index:8;background:rgba(0,0,0,.45);
          opacity:0;pointer-events:none;transition:opacity .18s}
        .sheet-backdrop.show{opacity:1;pointer-events:auto}
        .room-sheet,.presets-sheet{position:absolute;left:0;right:0;bottom:0;z-index:9;
          background:var(--xv-card);border-radius:20px 20px 0 0;padding:18px 18px 16px;
          box-shadow:0 -8px 30px rgba(0,0,0,.25);transform:translateY(100%);
          transition:transform .22s cubic-bezier(.32,.72,0,1);max-height:80%;overflow-y:auto}
        .room-sheet.show,.presets-sheet.show{transform:translateY(0)}
        .sheet-title{font-size:16px;font-weight:700;color:var(--xv-ink);margin-bottom:14px}
        .sheet-group{margin-bottom:14px}
        .sheet-label{font-size:12px;font-weight:600;color:var(--xv-muted);
          text-transform:uppercase;letter-spacing:.03em;margin-bottom:7px}
        .sheet-opts{display:flex;gap:6px;flex-wrap:wrap}
        .sheet-opt{flex:1 1 0;min-width:64px;padding:9px 6px;border-radius:10px;border:0;
          cursor:pointer;background:color-mix(in srgb,var(--xv-ink) 7%,transparent);
          color:var(--xv-ink);font-size:12px;font-weight:600;text-align:center;
          transition:background .15s,color .15s}
        .sheet-opt:hover{background:color-mix(in srgb,var(--xv-ink) 13%,transparent)}
        .sheet-opt.on{background:var(--xv-accent);color:#fff}
        .sheet-actions{display:flex;gap:8px;margin-top:6px}
        .sheet-actions button{flex:1;height:44px;border-radius:12px;border:0;cursor:pointer;
          font-size:14px;font-weight:600}
        .sheet-confirm{background:var(--xv-accent);color:#fff}
        .sheet-remove{background:color-mix(in srgb,var(--xv-ink) 7%,transparent);
          color:var(--xv-ink);display:none}
        .sheet-remove.show{display:block}
        .presets-list{display:flex;flex-direction:column;gap:8px}
        .preset-item{height:48px;border-radius:12px;border:0;cursor:pointer;
          background:color-mix(in srgb,var(--xv-ink) 7%,transparent);color:var(--xv-ink);
          font-size:14px;font-weight:600;text-align:left;padding:0 16px;
          display:flex;align-items:center;gap:10px}
        .preset-item:hover{background:color-mix(in srgb,var(--xv-ink) 13%,transparent)}
        .preset-item ha-icon{--mdc-icon-size:20px;opacity:.7}
        .presets-empty{font-size:13px;color:var(--xv-muted)}
      </style>
      <div class="vp" tabindex="0" role="group" aria-label="${cardT(this._hass, 'viewport_aria')}"><div class="track"></div></div>
      <div class="topbar">
        <div class="status"><span class="dot"></span><span class="stxt" aria-live="polite">—</span><span class="stxt-detail" aria-live="polite"></span></div>
        <div class="batt"><span class="btxt">—</span><span class="bicon"></span></div>
      </div>
      <div class="dots"></div>
      <div class="toast"></div>
      <button class="roomtag"></button>
      <div class="sheet-backdrop"></div>
      <div class="room-sheet">
        <div class="sheet-title"></div>
        <div class="sheet-group" data-field="clean_mode">
          <div class="sheet-label">${cardT(this._hass, 'sheet_mode')}</div>
          <div class="sheet-opts"></div>
        </div>
        <div class="sheet-group" data-field="wind_power">
          <div class="sheet-label">${cardT(this._hass, 'sheet_suction')}</div>
          <div class="sheet-opts"></div>
        </div>
        <div class="sheet-group" data-field="water_level">
          <div class="sheet-label">${cardT(this._hass, 'sheet_water')}</div>
          <div class="sheet-opts"></div>
        </div>
        <div class="sheet-actions">
          <button class="sheet-remove">${cardT(this._hass, 'sheet_remove')}</button>
          <button class="sheet-confirm">${cardT(this._hass, 'sheet_confirm')}</button>
        </div>
      </div>
      <div class="presets-sheet">
        <div class="sheet-title">${cardT(this._hass, 'presets_title')}</div>
        <div class="presets-list"></div>
      </div>
      <div class="tray">
        <button class="b act-start" title="${cardT(this._hass, 'start_title')}" aria-label="${cardT(this._hass, 'start_aria')}"><ha-icon icon="${MDI.play}"></ha-icon></button>
        <button class="b act-dock" title="${cardT(this._hass, 'dock_title')}" aria-label="${cardT(this._hass, 'dock_title')}"><ha-icon icon="${MDI.dock}"></ha-icon></button>
        <button class="b act-locate" title="${cardT(this._hass, 'locate_title')}" aria-label="${cardT(this._hass, 'locate_aria')}"><ha-icon icon="${MDI.locate}"></ha-icon></button>
        <button class="b cyc-fan" title="${cardT(this._hass, 'fan_title')}" aria-label="${cardT(this._hass, 'fan_aria')}"><ha-icon icon="${MDI.fan}"></ha-icon></button>
        <button class="b cyc-water" title="${cardT(this._hass, 'water_title')}" aria-label="${cardT(this._hass, 'water_aria')}"><ha-icon icon="${MDI.water}"></ha-icon></button>
        <button class="b cyc-mode" title="${cardT(this._hass, 'mode_title')}" aria-label="${cardT(this._hass, 'mode_aria')}"><ha-icon icon="${MDI.mode}"></ha-icon></button>
        <button class="b open-presets" title="${cardT(this._hass, 'presets_title')}" aria-label="${cardT(this._hass, 'presets_aria')}"><ha-icon icon="${MDI.presets}"></ha-icon></button>
      </div>`;
    this.appendChild(this._root);

    const q = (s) => this._root.querySelector(s);
    q(".act-start").onclick = () => {
      const st = this._st(this._config.vacuum);
      const cleaning = st && st.state === "cleaning";
      if (cleaning) {
        this._setPending("paused");
        this._svc("vacuum", "pause", { entity_id: this._config.vacuum });
        return;
      }
      // resume_or_start (integration service) checks the device's own
      // "chosen rooms" state server-side and decides start-vs-resume there —
      // no response data to read back here, just a plain fire-and-forget
      // service call like every other button in this tray.
      this._setPending("cleaning");
      this._svc("xiaomi_vac", "resume_or_start", { entity_id: this._config.vacuum });
    };
    q(".act-dock").onclick = () => {
      this._setPending("returning");
      this._svc("vacuum", "return_to_base", { entity_id: this._config.vacuum });
    };
    q(".act-locate").onclick = () => this._svc("vacuum", "locate", { entity_id: this._config.vacuum });
    q(".cyc-fan").onclick = () => this._cycleFan();
    q(".cyc-water").onclick = () =>
      this._cycleSelect(this._config.water || `select.${this._base()}_water_level`);
    q(".cyc-mode").onclick = () => this._cycleSelect(this._modeEid());
    q(".roomtag").onclick = () => this._cleanSelected();
    q(".open-presets").onclick = () => this._openPresets();
    q(".sheet-backdrop").onclick = () => this._closeRoomSheet();
    q(".sheet-confirm").onclick = () => this._confirmRoomSheet();
    q(".sheet-remove").onclick = () => this._removeRoomSheet();

    this._setupSwipe();
    this._buildPages();
  }

  /* ---------------- pages / carousel ---------------- */
  _maps() {
    // active map first, then any other floors the device reported
    return (this._mapsData || [])
      .filter((m) => m && m.rooms)
      .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  }
  _buildPages(keep) {
    const vac = this._st(this._config.vacuum);
    const name = (vac && vac.attributes.friendly_name) || cardT(this._hass, 'dots_vacuum');
    const model = vac && vac.attributes.model;
    const imgPage = this._enabled("show_vacuum_page")
      ?
      `<div class="slide pg-img"><div class="stage"><div class="lottie-wrap">${vacuumFallbackSvg()}</div></div>` +
      `<div class="nm">${esc(name)}</div><div class="sub">${esc(model || "")}</div></div>`
      : "";
    const mapOffset = this._mapOffset();
    const mapPages = this._enabled("show_map")
      ? this._maps().map((m, i) =>
          `<div class="slide pg-map" data-mi="${i + mapOffset}">` +
          (m.active ? `<div class="map-badge">${cardT(this._hass, 'map_badge_active')}</div>` : "") +
          `${this._mapSVG(m)}</div>`)
      : [];
    this._pages = [...(imgPage ? [imgPage] : []), ...mapPages];

    const track = this._root.querySelector(".track");
    const N = this._pages.length;
    // on a live rebuild (map poll) keep the user on the page they were viewing
    const want = keep ? Math.min(Math.max(this._real | 0, 0), N - 1) : 0;
    if (N > 1) {
      // clone last+first onto the ends so the carousel loops seamlessly
      track.innerHTML = this._pages[N - 1] + this._pages.join("") + this._pages[0];
      this._pos = want + 1;
    } else {
      track.innerHTML = this._pages[0] || "";
      this._pos = 0;
    }
    this._real = N > 1 ? this._pos - 1 : 0;
    this._wirePage();
    this._renderDots();
    requestAnimationFrame(() => { this._w = this._root.querySelector(".vp").clientWidth; this._setX(false); });
  }
  _renderDots() {
    const dots = this._root.querySelector(".dots");
    const N = this._pages.length;
    dots.innerHTML = N > 1
      ? this._pages.map((_, i) =>
          `<button data-i="${i}" aria-label="${i === 0 ? cardT(this._hass, 'dots_vacuum') : cardT(this._hass, 'dots_map', {n: i})}"${i === this._real ? ' aria-current="true"' : ""}><i class="${i === this._real ? "on" : ""}"></i></button>`).join("")
      : "";
    dots.querySelectorAll("button").forEach((b) => { b.onclick = () => this._goTo(Number(b.dataset.i)); });
  }
  // Jump straight to a real page (dots / future buttons). Ignored mid-flight so a
  // tap during the snap can't strand the track on a clone.
  _goTo(i) {
    const N = this._pages.length;
    if (N <= 1 || i === this._real) return;
    const track = this._root.querySelector(".track");
    if (track.classList.contains("anim") || this._down) return;
    this._pos = i + 1;
    this._setX(true);
  }
  _wirePage() {
    this._root.querySelectorAll(".rm").forEach((r) => {
      const open = () => {
        if (this._blockClick || !this._enabled("allow_room_cleaning")) return;
        this._openRoomSheet(Number(r.dataset.id));
      };
      r.onclick = open;
      r.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      };
    });
  }
  _setX(anim) {
    const track = this._root.querySelector(".track");
    track.classList.toggle("anim", !!anim);
    if (anim) void track.offsetWidth;        // commit the class so the transition runs
    track.style.transform = `translateX(${-this._pos * this._w}px)`;
  }
  _setupSwipe() {
    const vp = this._root.querySelector(".vp");
    const track = this._root.querySelector(".track");
    // Pointer Events (one stream for mouse + touch + pen) with pointer capture —
    // no global window listeners, and a drag can begin mid-animation.
    let down = false, sx = 0, sy = 0, base = 0, moved = false, vert = false, t0 = 0, pid = null;
    const TH = 8, COMMIT = 0.16, VEL = 0.45;
    const N = () => this._pages.length;
    const realPos = () => { const n = N(); return ((this._pos - 1) % n + n) % n + 1; };

    const onDown = (e) => {
      if (N() <= 1) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Grabbing during the snap settles the in-flight swipe to a real slot first,
      // so we never start a drag from a clone (which would expose blank space).
      if (track.classList.contains("anim")) { track.classList.remove("anim"); this._pos = realPos(); }
      else if (this._pos === 0 || this._pos === N() + 1) this._pos = realPos();
      down = true; this._down = true; moved = false; vert = false; sx = e.clientX; sy = e.clientY; t0 = Date.now();
      base = -this._pos * this._w;
      track.style.transform = `translateX(${base}px)`;
      // Capture is DEFERRED until the gesture actually moves (see onMove). Capturing
      // on every press retargets the subsequent click to .vp, so a stationary tap
      // never reached the room path underneath and room selection silently failed.
      pid = e.pointerId;
    };
    const onMove = (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && !vert) {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > TH) { vert = true; down = false; this._down = false; return; }
        if (Math.abs(dx) > TH) { moved = true; try { vp.setPointerCapture(pid); } catch (_) {} }
      }
      if (moved) { if (e.cancelable) e.preventDefault(); track.style.transform = `translateX(${base + dx}px)`; }
    };
    const onUp = (e) => {
      if (!down) return; down = false; this._down = false;
      if (pid != null) { try { vp.releasePointerCapture(pid); } catch (_) {} pid = null; }
      if (!moved) return;
      const dx = e.clientX - sx, dt = Date.now() - t0, v = Math.abs(dx) / Math.max(dt, 1);
      this._blockClick = true; clearTimeout(this._bcT); this._bcT = setTimeout(() => (this._blockClick = false), 300);
      if (Math.abs(dx) > this._w * COMMIT || v > VEL) this._pos += dx < 0 ? 1 : -1;
      this._setX(true);
    };

    vp.addEventListener("pointerdown", onDown);
    vp.addEventListener("pointermove", onMove);
    vp.addEventListener("pointerup", onUp);
    vp.addEventListener("pointercancel", onUp);
    // Keyboard paging — only when the viewport itself holds focus, so arrowing
    // through a focused room polygon isn't hijacked.
    vp.addEventListener("keydown", (e) => {
      if (N() <= 1 || e.target !== vp) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const track = this._root.querySelector(".track");
      if (track.classList.contains("anim") || down) return;
      e.preventDefault();
      this._pos += e.key === "ArrowRight" ? 1 : -1;
      this._setX(true);
    });

    track.addEventListener("transitionend", (e) => {
      if (e.propertyName && e.propertyName !== "transform") return;
      const n = N();
      if (this._pos <= 0) { track.classList.remove("anim"); this._pos = n; track.style.transform = `translateX(${-this._pos * this._w}px)`; }
      else if (this._pos >= n + 1) { track.classList.remove("anim"); this._pos = 1; track.style.transform = `translateX(${-this._pos * this._w}px)`; }
      else track.classList.remove("anim");
      this._real = ((this._pos - 1) % n + n) % n;
      // Room selection is a pending clean request the user is building up —
      // swiping to check another page (vacuum status, a different floor)
      // shouldn't silently discard it. Just repaint the current page's fill
      // state (a swipe never changes what's selected, only what's visible).
      this._syncRooms(); this._renderDots();
      // a map refresh that arrived mid-gesture was deferred — apply it now
      if (this._pendingRebuild && !down) { this._pendingRebuild = false; this._buildPages(true); }
    });
    window.addEventListener("resize", () => { this._w = vp.clientWidth; if (!down) this._setX(false); });
    // window 'resize' misses layout changes that don't resize the window —
    // sections/masonry settling, sidebar toggle, the card's own width settling
    // after mount. Any of those leaves this._w stale, so the track under/over-
    // shifts and pages sit off-centre. Track the viewport's real width instead.
    if (this._ro) this._ro.disconnect();
    if ("ResizeObserver" in window) {
      this._ro = new ResizeObserver(() => {
        const w = vp.clientWidth;
        if (!w || w === this._w) return;     // ignore no-ops and hidden (0) states
        this._w = w;
        if (!down) this._setX(false);        // re-snap to the current page at the new width
      });
      this._ro.observe(vp);
    }
  }

  /* ---------------- room fill raster (the segment layer) ----------------
   * Rooms are painted as a pixel image from the labelled grid — exactly what
   * Valetudo does. One canvas pixel per grid cell, nearest-neighbour scaled, no
   * outline, no holes. A raster has no polygon, so it can't ever produce the
   * stray diagonal chords / pinch artefacts that vector tracing did. Selected
   * rooms paint in their saturated tint. Returns SVG <image> placement in metre
   * space, or null if the grid is unavailable (then _mapSVG falls back to vector
   * fills). */
  _roomRaster(m) {
    const g = m.grid_rle, sz = m.size, b = m.bounds, res = m.resolution || 0.05;
    if (!g || !sz || !b || typeof document === "undefined") return null;
    const W = sz.x, H = sz.y;
    if (!W || !H) return null;
    const grid = new Uint8Array(W * H);
    let pos = 0;
    for (let i = 0; i + 1 < g.length; i += 2) {
      const v = g[i], n = g[i + 1];
      grid.fill(v, pos, Math.min(pos + n, grid.length));
      pos += n;
    }
    const rooms = m.rooms || [];
    const idIndex = roomIndexById(rooms);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(W, H), d = img.data;
    // Some hardware's occupancy grid never carries per-cell room-id values at
    // all (seen on real xiaomi.vacuum.d106gl data: only outside/floor/unknown
    // values like 0/127/128 appear, never 10-59). In that case room_chains
    // still exists (the backend falls back to the firmware's own coarse
    // room-boundary metadata, entirely independent of this grid), so hasChain
    // being true does NOT guarantee this raster has anything to show for that
    // room. Track whether we ever painted a single pixel; if not, this raster
    // is a hollow success — return null so callers fall back to vector fills
    // instead of trusting an image that's actually fully transparent.
    let paintedAny = false;
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const v = grid[row * W + col];
        let lab = null;
        if (v >= 10 && v <= 59) lab = v;
        else if (v >= 60 && v <= 109) lab = v - 50;  // selected-room cell value
        if (lab == null) continue;
        paintedAny = true;
        const t = ROOM_TINTS[(idIndex[lab] ?? 0) % ROOM_TINTS.length];
        const [r, gg, bb, a] = parseRGBA(this._isSelected(m, lab) ? t[1] : t[0]);
        // grid row increases north (up); image row 0 is the top, so flip
        const o = ((H - 1 - row) * W + col) * 4;
        d[o] = r; d[o + 1] = gg; d[o + 2] = bb; d[o + 3] = Math.round(a * 255);
      }
    }
    if (!paintedAny) return null;   // hollow raster — no room-id pixels at all
    ctx.putImageData(img, 0, 0);
    const Wm = W * res, Hm = H * res;
    return { href: cv.toDataURL(), x: b.minX, y: -(b.minY + Hm), w: Wm, h: Hm };
  }
  // Re-paint the active map's fill after a selection change. The raster (cell-
  // precise rooms) gets a fresh <image> href; rooms with only a bbox fallback
  // (no labelled grid cells yet — see _mapSVG) have no raster coverage, so their
  // own path fill is repainted directly instead.
  _refreshFill() {
    const m = this._maps()[this._real - this._mapOffset()];
    if (!m) return;
    const r = this._roomRaster(m);
    if (r) {
      this._root.querySelectorAll(`.pg-map[data-mi="${this._real}"] image.rmfill`)
        .forEach((im) => im.setAttribute("href", r.href));
    }
    this._root.querySelectorAll(`.pg-map[data-mi="${this._real}"] path.rm[data-haschain="0"]`)
      .forEach((p) => {
        const id = Number(p.dataset.id);
        p.setAttribute("fill", this._isSelected(m, id) ? p.dataset.tint1 : p.dataset.tint0);
      });
  }

  /* ---------------- map svg (metre space, north up) ---------------- */
  _mapSVG(m) {
    const res = m.resolution || 0.05, b = m.bounds || { minX: 0, minY: 0 };
    const cell = (c) => [b.minX + c[0] * res, b.minY + c[1] * res]; // grid cell -> metre
    const chains = m.room_chains || [];
    const rooms = m.rooms || [];
    const idIndex = roomIndexById(rooms);
    const chainById = Object.fromEntries(chains.map((ch) => [ch.id, ch]));
    // Every room gets SOME polygon: its exact traced outline when the labelled
    // grid covers it (hasChain=true — raster paints it, path stays a transparent
    // hit target), otherwise a plain bbox rectangle (hasChain=false — the room
    // hasn't been grid-labelled yet, e.g. never individually cleaned, so there's
    // no raster coverage for it; the path itself carries a visible tint fill so
    // the map doesn't show a hole there). This used to be all-or-nothing (any
    // chains present -> ONLY chain rooms drawn, every other room invisible) —
    // that's what made most of a house disappear after cleaning just one room.
    let xs = [], ys = [];
    const polys = rooms
      .map((r) => {
        const ch = chainById[r.id];
        if (ch) return { id: r.id, rings: ch.rings.map((ring) => ring.map(cell)), hasChain: true };
        if (r.bbox) {
          return {
            id: r.id,
            rings: [[[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[1]], [r.bbox[2], r.bbox[3]], [r.bbox[0], r.bbox[3]]]],
            hasChain: false,
          };
        }
        return null;
      })
      .filter(Boolean);
    polys.forEach((p) => p.rings.forEach((ring) => ring.forEach(([x, y]) => { xs.push(x); ys.push(y); })));
    if (m.charger) { xs.push(m.charger.x); ys.push(m.charger.y); }
    if (!xs.length) return "";
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const PAD = 0.7;
    const vbx = minx - PAD, vby = -(maxy + PAD), vw = (maxx - minx) + 2 * PAD, vh = (maxy - miny) + 2 * PAD;
    const tx = (x) => x.toFixed(3), ty = (y) => (-y).toFixed(3);
    const ring = (pts) => "M" + pts.map(([x, y]) => `${tx(x)},${ty(y)}`).join("L") + "Z";
    const dpath = (rings) => rings.map(ring).join("");  // multi-ring → even-odd fill

    let s = `<svg viewBox="${vbx} ${vby} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">`;
    // Room fills: prefer the pixel raster (the segment layer) for chain-precision
    // rooms. bbox-fallback rooms have no raster coverage, so they carry their own
    // visible fill directly on the path (see the fill= decision below).
    const raster = this._roomRaster(m);
    if (raster) {
      // pointer-events:none — this is purely the visual room-color layer,
      // never meant to be interactive. Without this it uses the browser
      // default (responds to clicks wherever it has non-transparent
      // pixels), and a SELECTED room paints much more opaque here than an
      // unselected one — plausibly intercepting clicks meant for the
      // actual clickable path on top of it, exactly when a room is
      // selected and nowhere else.
      s += `<image class="rmfill" href="${raster.href}" x="${raster.x}" y="${raster.y}" width="${raster.w}" height="${raster.h}" preserveAspectRatio="none" style="image-rendering:crisp-edges;image-rendering:pixelated;pointer-events:none"/>`;
    }
    polys.forEach((p) => {
      const t = ROOM_TINTS[(idIndex[p.id] ?? 0) % ROOM_TINTS.length];
      const nm = (rooms[idIndex[p.id]] && rooms[idIndex[p.id]].name) || `Room ${p.id}`;
      const selected = this._isSelected(m, p.id);
      // raster covers chain-precision rooms -> transparent hit target (the
      // raster paints the tint per-pixel, honouring selection itself);
      // bbox-fallback rooms have no raster coverage -> paint the tint here
      const fill = (raster && p.hasChain) ? "transparent" : (selected ? t[1] : t[0]);
      // pointer-events="all" + an invisible padded stroke gives a forgiving
      // click target that extends past the exact traced boundary — the
      // device's own room boundary data can be tighter/more precise right
      // after actually cleaning a room than it was before, and relying
      // purely on that exact shape for hit-testing made already-cleaned
      // rooms hard to tap. Purely a hit-testing aid; the visible fill is
      // untouched, and the CSS selected-state outline (!important) still
      // overrides this stroke for the visual accent ring.
      s += `<path class="rm" data-id="${p.id}" data-haschain="${p.hasChain ? 1 : 0}" data-tint0="${t[0]}" data-tint1="${t[1]}" role="button" tabindex="0" aria-pressed="${selected ? "true" : "false"}" aria-label="${esc(cardT(this._hass, 'room_clean_aria', {name: nm}))}" d="${dpath(p.rings)}" fill="${fill}" stroke="transparent" stroke-width="0.3" pointer-events="all"/>`;
    });
    // virtual walls — a user-drawn no-cross line, not real geometry, so render it
    // as a faint dashed hint rather than a solid bar that fights the rooms
    (m.walls || []).forEach((w) => {
      s += `<line x1="${tx(w[0])}" y1="${ty(w[1])}" x2="${tx(w[2])}" y2="${ty(w[3])}" stroke="var(--xv-muted)" stroke-width="0.05" stroke-linecap="round" stroke-dasharray="0.16 0.13" opacity=".35"/>`;
    });
    // No-go zones (device won't enter at all) and no-mop zones (device won't
    // wet-mop here, e.g. rugs) — both come straight from what's already
    // configured on the device itself, not something drawn by this card.
    // Each is a 4-point quad [x0,y0,x1,y1,x2,y2,x3,y3], not necessarily
    // axis-aligned, so render as a polygon rather than assuming a rectangle.
    const zonePoly = (pts) => pts.reduce((acc, v, i) =>
      i % 2 === 0 ? acc : `${acc}${tx(pts[i - 1])},${ty(v)} `, "").trim();
    (m.no_go || []).forEach((a) => {
      s += `<polygon points="${zonePoly(a)}" fill="#f44336" fill-opacity="0.22" stroke="#f44336" stroke-width="0.05" stroke-dasharray="0.14 0.1"/>`;
    });
    (m.no_mop || []).forEach((a) => {
      s += `<polygon points="${zonePoly(a)}" fill="#29b6f6" fill-opacity="0.22" stroke="#29b6f6" stroke-width="0.05" stroke-dasharray="0.14 0.1"/>`;
    });
    if (m.path && m.path.length > 1) {
      s += `<polyline points="${m.path.map(([x, y]) => `${tx(x)},${ty(y)}`).join(" ")}" fill="none" stroke="var(--xv-accent)" stroke-width="0.07" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`;
    }
    if (this._enabled("show_room_labels")) rooms.forEach((r) => {
      if (r.cx == null || !r.name) return;
      // Full name, uppercased. Let it overflow the room rather than truncate —
      // text-anchor=middle keeps it centred so it spills evenly past the walls.
      const label = r.name.toUpperCase();
      s += `<text x="${tx(r.cx)}" y="${ty(r.cy)}" font-size="0.42" fill="var(--xv-ink)" font-weight="600" text-anchor="middle" dominant-baseline="middle" style="pointer-events:none">${esc(label)}</text>`;
    });
    if (m.charger) {
      s += `<g transform="translate(${tx(m.charger.x)},${ty(m.charger.y)})"><circle r="0.32" fill="var(--xv-card)" stroke="#30b65a" stroke-width="0.07"/><path d="M-0.15,0.04 L0,-0.13 L0.15,0.04 M-0.09,0.02 L-0.09,0.15 L0.09,0.15 L0.09,0.02" fill="none" stroke="#30b65a" stroke-width="0.05" stroke-linejoin="round"/></g>`;
    }
    if (m.vacuum) {
      s += `<g transform="translate(${tx(m.vacuum.x)},${ty(m.vacuum.y)})"><circle r="0.44" fill="var(--xv-accent)" opacity=".16"/><circle r="0.25" fill="var(--xv-accent)" stroke="var(--xv-card)" stroke-width="0.06"/></g>`;
    }
    return s + "</svg>";
  }

  /* ---------------- controls ---------------- */
  _cycleFan() { this._cycleSelect(this._config.fan || `select.${this._base()}_fan_speed`); }
  _cycleSelect(eid) {
    const e = this._st(eid); if (!e) return;
    const opts = e.attributes.options || []; if (!opts.length) return;
    const cur = this._pendSel[eid] != null ? this._pendSel[eid] : e.state;
    const next = opts[(opts.indexOf(cur) + 1) % opts.length];
    this._pendSel[eid] = next;
    clearTimeout(this._pendSelT[eid]);
    this._pendSelT[eid] = setTimeout(() => { delete this._pendSel[eid]; }, 6000);
    this._toast(cap(next));
    this._svc("select", "select_option", { entity_id: eid, option: next });
  }
  // brief pill of feedback for the icon-only cyclers (fan / water level / mode)
  _toast(text) {
    const t = this._root && this._root.querySelector(".toast"); if (!t) return;
    t.textContent = text; t.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove("show"), 1300);
  }
  _cleanSelected() {
    if (!this._sel.size || !this._enabled("allow_room_cleaning")) return;
    const active_rooms = [...this._sel].map((id) => ({
      room_id: id,
      ...(this._roomSettings[id] || ROOM_SETTING_DEFAULTS),
    }));
    const segments = [...this._sel];
    // Apply per-room mode/suction/water first (merge-safe — see the
    // apply_room_preferences service). If THAT fails, do not proceed to
    // start a clean at all — starting one anyway would run without the
    // room selection ever having been registered, which is how you can end
    // up with a full-home clean instead of the rooms you actually picked.
    // Matches the confirmed-working reference flow: it waits a beat after
    // the preference write before starting, rather than firing back-to-back
    // — the device/cloud seems to need a moment for the "chosen" rooms to
    // actually commit before a "start" call correctly picks them up.
    (async () => {
      try {
        await this._svc("xiaomi_vac", "apply_room_preferences", {
          entity_id: this._config.vacuum, active_rooms,
        });
      } catch (e) {
        console.error("[xiaomi-vac-card] apply_room_preferences failed, NOT starting a clean:", e);
        this._toast(cardT(this._hass, 'toast_pref_failed'));
        return;
      }
      await new Promise((res) => setTimeout(res, 1000));
      this._svc("xiaomi_vac", "clean_segment", { entity_id: this._config.vacuum, segments });
    })();
    this._sel.clear(); this._roomSettings = {}; this._syncRooms();
  }

  /* ---------------- room settings sheet ---------------- */
  _roomName(id) {
    const m = this._maps()[this._real - this._mapOffset()];
    const r = m && (m.rooms || []).find((x) => x.id === id);
    return (r && r.name) || `Room ${id}`;
  }
  // A room reads as "selected" for highlighting either because it's staged
  // locally (tapped, confirmed, not yet sent — this._sel) or because the
  // DEVICE itself currently has it chosen (m.rooms[].chosen, refreshed by
  // the integration on its own poll cycle — this is what makes the
  // highlight survive a page refresh or HA restart, matching how the
  // Xiaomi app's own selection persists).
  _roomData(m, id) { return m && (m.rooms || []).find((r) => r.id === id); }
  _isChosen(m, id) { const r = this._roomData(m, id); return !!(r && r.chosen); }
  _isSelected(m, id) { return this._sel.has(id) || this._isChosen(m, id); }
  _openRoomSheet(id) {
    this._roomPopupId = id;
    const m = this._maps()[this._real - this._mapOffset()];
    const roomData = this._roomData(m, id);
    // Prefer local staged settings (this session's own edit); otherwise fall
    // back to whatever the device actually has saved for this room (survives
    // a refresh/restart — see map_coordinator's chosen-rooms merge); only
    // fall back to hardcoded defaults if neither is available (a room that's
    // never been configured at all).
    const current = this._roomSettings[id] || (roomData && roomData.settings) || { ...ROOM_SETTING_DEFAULTS };
    this._sheetPending = { ...current };
    const q = (s) => this._root.querySelector(s);
    q(".sheet-title").textContent = this._roomName(id);
    q(".sheet-remove").classList.toggle("show", this._isSelected(m, id));
    const groups = [
      ["clean_mode", MODE_OPTIONS], ["wind_power", POWER_OPTIONS], ["water_level", WATER_OPTIONS],
    ];
    groups.forEach(([field, opts]) => {
      const wrap = this._root.querySelector(`.sheet-group[data-field="${field}"] .sheet-opts`);
      wrap.innerHTML = opts.map((o) =>
        `<button type="button" class="sheet-opt${this._sheetPending[field] === o.value ? " on" : ""}" data-value="${o.value}">${esc(o.key ? cardT(this._hass, o.key) : o.label)}</button>`
      ).join("");
      wrap.querySelectorAll(".sheet-opt").forEach((btn) => {
        btn.onclick = () => {
          this._sheetPending[field] = Number(btn.dataset.value);
          wrap.querySelectorAll(".sheet-opt").forEach((b) => b.classList.toggle("on", b === btn));
        };
      });
    });
    q(".sheet-backdrop").classList.add("show");
    q(".room-sheet").classList.add("show");
  }
  _closeRoomSheet() {
    this._roomPopupId = null;
    const q = (s) => this._root.querySelector(s);
    q(".sheet-backdrop").classList.remove("show");
    q(".room-sheet").classList.remove("show");
  }
  _confirmRoomSheet() {
    if (this._roomPopupId == null) return;
    this._roomSettings[this._roomPopupId] = { ...this._sheetPending };
    this._sel.add(this._roomPopupId);
    this._closeRoomSheet();
    this._syncRooms();
  }
  _removeRoomSheet() {
    if (this._roomPopupId == null) return;
    const id = this._roomPopupId;
    const m = this._maps()[this._real - this._mapOffset()];
    const wasChosen = this._isChosen(m, id);
    this._sel.delete(id);
    delete this._roomSettings[id];
    if (wasChosen) {
      // Actually active on the device, not just staged locally — properly
      // un-choose it there too. apply_room_preferences marks every room NOT
      // listed as inactive without touching its saved settings, so passing
      // every OTHER currently-chosen room (and none of THIS one) is exactly
      // "deactivate this one room, leave the rest running" — including the
      // edge case of removing the last one, which correctly clears to
      // nothing (an empty active_rooms list is valid: every currently-
      // chosen room just has no match and gets marked inactive).
      const remaining = (m.rooms || [])
        .filter((r) => r.chosen && r.id !== id)
        .map((r) => ({ room_id: r.id }));
      this._svc("xiaomi_vac", "apply_room_preferences", {
        entity_id: this._config.vacuum, active_rooms: remaining,
      }).catch((e) => {
        console.error("[xiaomi-vac-card] failed to remove room from the active clean:", e);
        this._toast(cardT(this._hass, "toast_pref_failed"));
      });
    }
    this._closeRoomSheet();
    this._syncRooms();
  }

  /* ---------------- presets sheet ---------------- */
  _openPresets() {
    const presets = this._config.presets || [];
    const list = this._root.querySelector(".presets-list");
    list.innerHTML = presets.length
      ? presets.map((p, i) =>
          `<button type="button" class="preset-item" data-i="${i}"><ha-icon icon="mdi:play-circle-outline"></ha-icon>${esc(p.name || p.script)}</button>`
        ).join("")
      : `<div class="presets-empty">${esc(cardT(this._hass, 'presets_empty'))}</div>`;
    list.querySelectorAll(".preset-item").forEach((btn) => {
      btn.onclick = () => this._runPreset(presets[Number(btn.dataset.i)]);
    });
    this._root.querySelector(".sheet-backdrop").classList.add("show");
    this._root.querySelector(".presets-sheet").classList.add("show");
    // reuse the same backdrop for both sheets; make sure it closes THIS one
    this._root.querySelector(".sheet-backdrop").onclick = () => this._closePresets();
  }
  _closePresets() {
    this._root.querySelector(".sheet-backdrop").classList.remove("show");
    this._root.querySelector(".presets-sheet").classList.remove("show");
    this._root.querySelector(".sheet-backdrop").onclick = () => this._closeRoomSheet();
  }
  _runPreset(preset) {
    if (!preset || !preset.script) return;
    this._svc("script", "turn_on", { entity_id: preset.script });
    this._closePresets();
  }

  /* ---------------- live update ---------------- */
  async _updateAnim(state, model) {
    const wrap = this._root && this._root.querySelector(".lottie-wrap");
    if (!wrap) return;
    const src = lottieSrc(model, state);
    if (this._animWrap === wrap && this._animSrc === src) return;
    if (this._anim) { this._anim.destroy(); this._anim = null; }
    this._animWrap = wrap;
    this._animSrc = src;
    wrap.innerHTML = vacuumFallbackSvg();
    const [L, data] = await Promise.all([loadLottie(), fetchLottie(src)]);
    if (!L || !data) return;
    if (!this._root || this._root.querySelector(".lottie-wrap") !== wrap) return;
    wrap.innerHTML = "";
    this._anim = L.loadAnimation({ container: wrap, renderer: "svg", loop: true, autoplay: true, animationData: data });
  }
  _syncRooms() {
    // Selection is shown by repainting the fill (raster for chain-precision
    // rooms, direct path fill for bbox-fallback rooms — see _refreshFill).
    const m = this._maps()[this._real - this._mapOffset()];
    this._root.querySelectorAll(".rm").forEach((r) => {
      r.setAttribute("aria-pressed", this._isSelected(m, Number(r.dataset.id)) ? "true" : "false");
    });
    this._refreshFill();
    // The "Clean N rooms" tag is specifically about NEWLY staged rooms ready
    // to send — not the total highlighted set, which also includes rooms
    // already chosen on the device from before. Those don't need a "Clean"
    // tap to keep running; only new additions do.
    const tag = this._root.querySelector(".roomtag");
    const n = this._sel.size;
    if (n) { tag.textContent = n === 1 ? cardT(this._hass, 'roomtag_one') : cardT(this._hass, 'roomtag_many', {n}); tag.classList.add("show"); }
    else tag.classList.remove("show");
  }
  // Optimistic feedback: a tap shows the intended state immediately, then the
  // real device state (after the MIoT round-trip + refresh) takes back over.
  _setPending(state) {
    // 5s was too short specifically for pause: the device itself takes a
    // few seconds to settle into a genuinely stable status after the
    // job-aware pause/resume calls (confirmed directly against real Mi
    // Home traffic — even the official app polls more than once before
    // it holds steady). Falling back to the real polled state too early
    // caught it mid-settle, showing "cleaning" again briefly before a
    // later poll finally reflected the settled "paused". 20s comfortably
    // covers a couple of poll cycles either way.
    this._pend = { state, expire: Date.now() + 20000 };
    clearTimeout(this._pendT);
    this._pendT = setTimeout(() => { try { this._update(); } catch (e) {} }, 20050);
    this._update();
  }
  _effState(vac) {
    const real = (vac && vac.state) || "unknown";
    if (this._pend) {
      if (real === this._pend.state || Date.now() > this._pend.expire) this._pend = null;
      else return this._pend.state;
    }
    return real;
  }
  _update() {
    const q = (s) => this._root.querySelector(s);
    const vac = this._st(this._config.vacuum);
    const state = this._effState(vac);
    this._root.style.setProperty("--xv-accent", ACCENT[state] || ACCENT.unknown);

    const battEnt = this._st(`sensor.${this._base()}_battery`);
    const batt = battEnt ? Number(battEnt.state) : (vac && vac.attributes.battery_level);
    const hasBatt = batt != null && !Number.isNaN(batt);
    // No charging flag from the device — docked-and-not-full is the charging tell.
    const charging = state === "docked" && hasBatt && batt < 100;
    q(".btxt").textContent = hasBatt ? `${batt}%` : "—";
    q(".bicon").innerHTML = batteryIcon(hasBatt ? batt : 0, charging);

    // On error, surface the fault code the device reported (0/none = no detail).
    const fault = vac && vac.attributes && vac.attributes.fault;
    const statusKey = { cleaning: "status_cleaning", paused: "status_paused", docked: "status_docked",
      idle: "status_idle", returning: "status_returning", unknown: "status_unknown", error: "status_error" }[state];
    q(".stxt").textContent =
      state === "error" && fault ? cardT(this._hass, 'error_fault', {n: fault})
      : statusKey ? cardT(this._hass, statusKey) : cap(state);

    // Elapsed-time detail next to the status word: live progress while
    // actively cleaning, or a summary of the last completed clean once
    // docked. Nothing shown for any other state (paused/returning/idle/
    // error/unknown), and nothing shown at all if the relevant sensor is
    // missing/unavailable/not a number — never surface a raw "unknown".
    const detailEl = q(".stxt-detail");
    let detail = "";
    if (state === "cleaning") {
      const mins = this._numState(`sensor.${this._base()}_clean_time`);
      const area = this._numState(`sensor.${this._base()}_clean_area`);
      const parts = [];
      if (mins != null) parts.push(this._formatDuration(mins));
      if (area != null) parts.push(`${area.toFixed(1)} m²`);
      if (parts.length) detail = `· ${parts.join(" · ")}`;
    } else if (state === "docked") {
      const secs = this._numState(`sensor.${this._base()}_last_clean_time`);
      const area = this._numState(`sensor.${this._base()}_last_clean_area`);
      const parts = [];
      if (secs != null) parts.push(this._formatDuration(secs / 60));
      if (area != null) parts.push(`${area.toFixed(1)} m²`);
      if (parts.length) detail = `· ${parts.join(" · ")}`;
    }
    detailEl.textContent = detail;
    detailEl.classList.toggle("show", !!detail);

    const cleaning = state === "cleaning";
    const startBtn = q(".act-start");
    startBtn.querySelector("ha-icon").setAttribute("icon", cleaning ? MDI.pause : MDI.play);
    startBtn.classList.toggle("on", cleaning);   // accent-fill the active action (cf. AC card)
    q(".tray").style.display = this._enabled("show_controls") ? "" : "none";
    q(".cyc-fan").style.display = this._enabled("show_fan") ? "" : "none";
    q(".cyc-water").style.display = this._enabled("show_water") ? "" : "none";
    q(".cyc-mode").style.display =
      this._enabled("show_mode") && this._st(this._modeEid()) ? "" : "none";
    q(".open-presets").style.display =
      (this._config.presets || []).length ? "" : "none";
    // keep image-page name fresh if it was a placeholder
    const nm = q(".pg-img .nm");
    if (nm && vac) nm.textContent = vac.attributes.friendly_name || cardT(this._hass, 'dots_vacuum');

    this._updateAnim(state, vac && vac.attributes.model);
  }
}
if (!customElements.get("xiaomi-vac-card"))
  customElements.define("xiaomi-vac-card", XiaomiVacCard);

class XiaomiVacCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._render(); }
  set hass(hass) { this._hass = hass; this._render(); }
  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) =>
        ({
          vacuum: cardT(this._hass, 'editor_vacuum'),
          map: cardT(this._hass, 'editor_map'),
          fan: cardT(this._hass, 'editor_fan'),
          water: cardT(this._hass, 'editor_water'),
          mode: cardT(this._hass, 'editor_mode'),
          show_vacuum_page: cardT(this._hass, 'editor_show_vacuum_page'),
          show_map: cardT(this._hass, 'editor_show_map'),
          show_controls: cardT(this._hass, 'editor_show_controls'),
          show_fan: cardT(this._hass, 'editor_show_fan'),
          show_water: cardT(this._hass, 'editor_show_water'),
          show_mode: cardT(this._hass, 'editor_show_mode'),
          show_room_labels: cardT(this._hass, 'editor_show_room_labels'),
          allow_room_cleaning: cardT(this._hass, 'editor_allow_room_cleaning'),
          presets: cardT(this._hass, 'editor_presets'),
        }[s.name] || s.name);
      this._form.addEventListener("value-changed", (e) =>
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: e.detail.value }, bubbles: true, composed: true })));
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { presets: PRESETS_DEFAULT, ...TOGGLE_DEFAULTS, ...this._config };
    this._form.schema = [
      { name: "vacuum", required: true, selector: { entity: { domain: "vacuum" } } },
      { name: "map", selector: { entity: { domain: "camera" } } },
      { name: "fan", selector: { entity: { domain: "select" } } },
      { name: "water", selector: { entity: { domain: "select" } } },
      { name: "mode", selector: { entity: { domain: "select" } } },
      { name: "show_vacuum_page", selector: { boolean: {} } },
      { name: "show_map", selector: { boolean: {} } },
      { name: "show_controls", selector: { boolean: {} } },
      { name: "show_fan", selector: { boolean: {} } },
      { name: "show_water", selector: { boolean: {} } },
      { name: "show_mode", selector: { boolean: {} } },
      { name: "show_room_labels", selector: { boolean: {} } },
      { name: "allow_room_cleaning", selector: { boolean: {} } },
      // No built-in ha-form selector supports a variable-length repeating
      // name+entity picker, so presets are edited as a raw list of objects —
      // e.g. [{name: "Quick Clean", script: "script.quick_clean"}, ...].
      // Still fully editable through the visual editor, just as a YAML/JSON
      // field rather than a polished per-row UI.
      { name: "presets", selector: { object: {} } },
    ];
  }
}
if (!customElements.get("xiaomi-vac-card-editor"))
  customElements.define("xiaomi-vac-card-editor", XiaomiVacCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "xiaomi-vac-card",
  name: "Xiaomi Vac Card",
  description: "Rich map based vacuum card - swipe between vacuum and map, tap-to-clean rooms.",
  preview: true,
});

})();
