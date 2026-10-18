# iCSee PTZ — Benutzerhandbuch

Diese Integration steuert die motorisierten **iCSee**-Kameras (auch unter den
Marken XMEye, Xiongmai, Jennov, Hiseeu, Floureon... verkauft) aus Gladys
Assistant, und zwar **lokal**: Gladys spricht mit den Kameras in Ihrem
Netzwerk über ihr natives Protokoll (DVRIP, TCP-Port 34567). Kein
Cloud-Konto, keine Internetverbindung nötig.

## Funktionen

- **Das Kamerabild** in Gladys: Kamera-Widget im Dashboard, Chat („Zeig mir
  die Kamera“), Szenen („Kamerabild senden“).
- **Schwenken / Neigen** (und Zoom bei Modellen mit Zoom) über das Dashboard,
  die Gerätezeilen und die Szenen. Jede Bewegung stoppt von selbst: Ein
  verlorenes „Stopp“ lässt die Kamera nie weiterdrehen.
- **Presets**: Ein Tipp richtet die Kamera auf eine gespeicherte Position
  aus.
- **Bewegungs- und Personenerkennung**: ein Bewegungssensor sowie ein
  Szenenauslöser, der eine Bewegung von einer Person unterscheidet.
- **Zwei Dashboard-Widgets**: „iCSee-PTZ-Steuerung“ (Bild, Status, Pfeile)
  und „iCSee-Presets“.
- **Szenenaktionen**: Kamera bewegen, Preset anfahren / speichern, Bild
  aktualisieren, Kamera neu starten.
- **Szenenauslöser**: Erkennung (Bewegung / Person), Kamera online /
  offline.

## Vorbereitung

1. Koppeln Sie jede Kamera mit der **iCSee**-App, im selben Netzwerk wie
   Gladys.
2. Geben Sie jeder Kamera in Ihrem Router eine **feste IP-Adresse**
   (DHCP-Reservierung). Die Integration erkennt auch eine Kamera mit
   geänderter Adresse, eine feste Adresse vermeidet aber jede Unterbrechung.
3. Notieren Sie das in der iCSee-App festgelegte **Gerätepasswort** (leer,
   wenn Sie nie eines festgelegt haben). Der Benutzername ist `admin`.
4. Um die Erkennungen zu erhalten, aktivieren Sie in der iCSee-App den
   Bewegungs- / Personenalarm der Kamera.

## Konfiguration

Öffnen Sie **Integrationen → iCSee PTZ → Konfiguration**:

| Feld                       | Eingabe                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Kamera-Adressen            | Die IP-Adressen, durch Kommas getrennt: `192.168.1.50, 192.168.1.51`. Fügen Sie `:Port` hinzu, wenn er nicht 34567 ist. |
| Benutzername               | `admin`, sofern Sie kein anderes Konto angelegt haben.                                                                  |
| Passwort                   | Das Gerätepasswort der iCSee-App. Leer lassen, wenn es keines gibt. Gilt für alle Kameras.                              |
| Bildaktualisierung (s)     | Sekunden zwischen zwei an Gladys gesendeten Bildern (standardmäßig 60, mindestens 5). `0` = nur bei Bedarf.             |
| Bilderfassung              | `Automatisch` nutzt den Schnappschuss der Kamera oder den RTSP-Stream, wenn die Firmware keinen hat.                    |
| Bewegungsschritt (s)       | Wie lange ein einzelner Bewegungsbefehl die Kamera dreht (standardmäßig 1 s).                                           |
| Motorgeschwindigkeit (1-8) | Geschwindigkeit der PTZ-Motoren.                                                                                        |
| Motorisierter Zoom         | Nur ankreuzen, wenn Ihr Modell einen optischen Zoom hat.                                                                |
| Presets                    | Die auf den Kameras gespeicherten Positionen als `Nummer:Name`: `1:Eingang, 2:Garten`.                                  |
| Bewegungserkennung         | Empfängt die Erkennungen der Kameras.                                                                                   |
| Kameras mit Doppelobjektiv | Teilt das Bild der Modelle mit Doppelobjektiv (festes Objektiv standardmäßig oben).                                     |

Speichern Sie und nutzen Sie dann die Schaltflächen:

- **Kameras testen** verbindet sich mit jeder Adresse und zeigt, welche
  antworten (Modell und Seriennummer) oder warum nicht (falsches Passwort,
  nicht erreichbar...).
- **Netzwerk durchsuchen** listet die iCSee-Kameras Ihres Netzwerks auf.
  Die Suche sendet die iCSee-Suchanfrage und prüft dann Port 34567 auf jeder
  Adresse des Netzwerks: dem unter „Zu durchsuchendes Netzwerk“
  eingegebenen (z. B. `192.168.1.0/24`) oder standardmäßig dem Netzwerk der
  bereits konfigurierten Kameras. Geben Sie für Ihre erste Kamera Ihr
  Netzwerk ein. Die Adresse wird auch in der iCSee-App
  (Geräteeinstellungen → Netzwerk) und in der Geräteliste Ihres Routers
  angezeigt.
- **Kamera neu starten** startet die gewählte Kamera neu.

Öffnen Sie danach den Reiter **Erkennung** der Integration und fügen Sie
Ihre Kameras hinzu.

## Kamera bewegen

- **Dashboard**: Fügen Sie das Widget „iCSee-PTZ-Steuerung“ hinzu (oder das
  Gerät in einem Raum-Widget). Jeder Pfeil dreht die Kamera für die Dauer
  des „Bewegungsschritts“.
- **Szenen**: Die Aktion „iCSee-Kamera bewegen“ nimmt eine Richtung und eine
  Dauer (höchstens 5 s). Die Standardaktion „Gerät steuern“ funktioniert
  ebenfalls auf der PTZ-Funktion (1 links, 2 rechts, 3 hoch, 4 runter,
  5 heranzoomen, 6 herauszoomen, 0 Stopp).

Egal, woher der Befehl kommt: Eine Bewegung stoppt immer spätestens nach
5 Sekunden von selbst.

## Kameras mit Doppelobjektiv

Manche Modelle (X6E-WEQ...) haben ein festes und ein PTZ-Objektiv, senden
beide aber in **einem Bild** übereinander: Die iCSee-App teilt es auf dem
Telefon. Die Integration macht dasselbe, automatisch: Ein Bild, das höher als
breit ist, ist ein Doppelobjektiv-Bild.

- Das bereits vorhandene Kameragerät wird zum **PTZ-Objektiv** (Bild,
  Pfeile, Presets, Bewegung): Ihre Szenen und Dashboards funktionieren
  weiter.
- Ein zweites Gerät, **„fixed lens“** (festes Objektiv), erscheint im Reiter
  Erkennung mit dem Bild des festen Objektivs: Fügen Sie es wie das erste
  hinzu.
- Eine einzige Aufnahme liefert beide Bilder: Das Teilen kostet nicht mehr
  als bisher.

Die Einstellung **Kameras mit Doppelobjektiv** legt fest, wo sich das feste
Objektiv befindet (standardmäßig oben, oder unten), oder schaltet das Teilen
ab.

Live-Video ist mit dieser Integration nicht verfügbar (externe
Gladys-Integrationen tauschen Standbilder aus, höchstens 12 pro Minute). Für
Live-Video fügen Sie die Kamera zusätzlich der Gladys-Integration
**RTSP-Kamera** hinzu, mit
`rtsp://<Adresse>:554/user=admin&password=<Passwort>&channel=1&stream=0.sdp?real_stream`
(beide Objektive in einem Bild).

## Presets

Ein Preset ist eine **in der Kamera** gespeicherte Position. So legen Sie
eines an:

1. Richten Sie die Kamera auf die gewünschte Position aus (Widget,
   iCSee-App);
2. starten Sie eine Szene mit der Aktion **iCSee-Preset speichern** und einer
   Nummer (1 bis 255), oder speichern Sie es in der iCSee-App;
3. tragen Sie `Nummer:Name` in das Feld **Presets** der Konfiguration ein,
   z. B. `1:Eingang`.

Die Presets erscheinen dann auf der PTZ-Funktion des Geräts und im Widget
„iCSee-Presets“, und die Szenenaktion **iCSee-Preset anfahren** richtet die
Kamera darauf aus.

## Szenen-Ideen

- Wenn der Alarm aktiviert wird, alle Kameras auf die Tür richten (Preset
  anfahren).
- Wenn eine Kamera eine Person erkennt, ihr Bild per Telegram senden
  („iCSee-Bild aktualisieren“, dann die Gladys-Aktion „Kamerabild senden“).
- Wenn eine Kamera nachts offline geht, sie neu starten.

## Fehlerbehebung

- **„wrong password“**: Prüfen Sie das Gerätepasswort in der iCSee-App; der
  Benutzername ist `admin`.
- **Kamera nicht erreichbar**: Prüfen Sie die Adresse, ob die Kamera mit
  Strom versorgt und im selben Netzwerk ist und ob TCP-Port 34567 nicht
  blockiert wird.
- **Kein Bild**: Manche Firmwares haben keinen Schnappschuss-Befehl; die
  Integration nutzt dann den RTSP-Stream (Port 554). Erzwingen Sie bei
  Bedarf „RTSP-Stream“ unter „Bilderfassung“.
- **Keine Erkennung**: Aktivieren Sie den Erkennungsalarm in der iCSee-App
  und lassen Sie „Bewegungserkennung“ angekreuzt.
- Die Protokolle der Integration finden Sie unter **Einstellungen → System →
  Container** (oder `docker logs`).

Quellcode, Fehlerverfolgung und Änderungsprotokoll finden Sie auf
[GitHub](https://github.com/gboulvin/Gladys-ICSeePTZ).
