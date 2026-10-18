# iCSee PTZ — guide d'utilisation

Cette intégration pilote les caméras motorisées **iCSee** (vendues aussi sous
les marques XMEye, Xiongmai, Jennov, Hiseeu, Floureon...) depuis Gladys
Assistant, **en local** : Gladys parle aux caméras sur votre réseau avec leur
protocole natif (DVRIP, port TCP 34567). Pas de compte cloud, pas besoin
d'internet.

## Ce que vous obtenez

- **L'image de la caméra** dans Gladys : widget caméra du tableau de bord,
  chat (« montre-moi la caméra »), scènes (« envoyer une image de caméra »).
- **L'orientation** (et le zoom sur les modèles qui en ont un) depuis le
  tableau de bord, les lignes d'appareils et les scènes. Chaque mouvement
  s'arrête tout seul : un « stop » perdu ne laisse jamais la caméra tourner.
- **Les presets** : un appui pour orienter la caméra vers une position
  enregistrée.
- **La détection de mouvement et de personne** : un capteur de mouvement, et
  un déclencheur de scène qui distingue un mouvement d'une personne.
- **Deux widgets** : « Pilotage PTZ iCSee » (image, état, flèches) et
  « Presets iCSee ».
- **Des actions de scène** : orienter une caméra, aller à / enregistrer un
  preset, rafraîchir l'image, redémarrer une caméra.
- **Des déclencheurs de scène** : détection (mouvement / personne), caméra
  en ligne / hors ligne.

## Avant de commencer

1. Associez chaque caméra avec l'application **iCSee**, sur le même réseau
   que Gladys.
2. Dans votre box, donnez à chaque caméra une **adresse IP fixe** (bail DHCP
   statique). L'intégration reconnaît aussi une caméra dont l'adresse a
   changé, mais une adresse fixe évite toute coupure.
3. Notez le **mot de passe de l'appareil** défini dans l'application iCSee
   (vide si vous n'en avez jamais défini). Le nom d'utilisateur est `admin`.
4. Pour recevoir les détections, activez l'alarme de détection de mouvement
   / de personne de la caméra dans l'application iCSee.

## Configuration

Ouvrez **Intégrations → iCSee PTZ → Configuration** :

| Champ                     | À saisir                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Adresses des caméras      | Les adresses IP, séparées par des virgules : `192.168.1.50, 192.168.1.51`. Ajoutez `:port` s'il n'est pas 34567. |
| Nom d'utilisateur         | `admin`, sauf si vous avez créé un autre compte.                                                                 |
| Mot de passe              | Le mot de passe de l'appareil dans l'application iCSee. Vide s'il n'y en a pas. Commun à toutes les caméras.     |
| Rafraîchissement (s)      | Secondes entre deux images envoyées à Gladys (60 par défaut, 5 minimum). `0` = seulement à la demande.           |
| Capture de l'image        | `Automatique` utilise la capture de la caméra, ou le flux RTSP si le firmware n'en a pas.                        |
| Pas de déplacement (s)    | Durée de rotation d'une commande de déplacement isolée (1 s par défaut).                                         |
| Vitesse du moteur (1-8)   | Vitesse des moteurs PTZ.                                                                                         |
| Zoom motorisé             | À cocher uniquement si votre modèle a un zoom optique.                                                           |
| Presets                   | Les positions enregistrées sur les caméras, sous la forme `numéro:nom` : `1:Entrée, 2:Jardin`.                   |
| Détection de mouvement    | Reçoit les détections des caméras.                                                                               |
| Caméras à double objectif | Découpe l'image des modèles à double objectif (objectif fixe en haut par défaut).                                |

Enregistrez, puis utilisez les boutons :

- **Tester les caméras** se connecte à chaque adresse et indique celles qui
  répondent (modèle et numéro de série), ou pourquoi (mauvais mot de passe,
  injoignable...).
- **Rechercher sur le réseau** liste les caméras iCSee de votre réseau. Il
  diffuse la recherche iCSee, puis essaie le port 34567 sur chaque adresse
  du réseau : celui que vous saisissez dans « Réseau à analyser » (ex.
  `192.168.1.0/24`), ou par défaut le réseau des caméras déjà configurées.
  Pour votre première caméra, saisissez votre réseau. L'adresse est aussi
  affichée dans l'application iCSee (Paramètres de l'appareil → Réseau) et
  dans la liste des appareils de votre box.
- **Redémarrer une caméra** redémarre la caméra choisie.

Ouvrez ensuite l'onglet **Découverte** de l'intégration et ajoutez vos
caméras.

## Orienter la caméra

- **Tableau de bord** : ajoutez le widget « Pilotage PTZ iCSee » (ou
  l'appareil dans un widget de pièce). Chaque flèche fait tourner la caméra
  pendant le « Pas de déplacement ».
- **Scènes** : l'action « Orienter une caméra iCSee » prend une direction et
  une durée (5 s maximum). L'action standard « contrôler un appareil »
  fonctionne aussi sur la fonctionnalité PTZ (1 gauche, 2 droite, 3 haut,
  4 bas, 5 zoom avant, 6 zoom arrière, 0 stop).

Quelle que soit son origine, un mouvement s'arrête toujours de lui-même au
bout de 5 secondes au plus.

## Caméras à double objectif

Certains modèles (X6E-WEQ...) ont un objectif fixe et un objectif PTZ, mais
envoient les deux dans **une seule image**, l'un au-dessus de l'autre :
l'application iCSee la découpe sur le téléphone. L'intégration fait de même,
automatiquement : une image plus haute que large est une image à double
objectif.

- L'appareil caméra que vous avez déjà devient l'**objectif PTZ** (image,
  flèches, presets, mouvement) : vos scènes et tableaux de bord continuent
  de fonctionner.
- Un second appareil, **« objectif fixe »** (« fixed lens »), apparaît dans
  l'onglet Découverte avec l'image de l'objectif fixe : ajoutez-le comme le
  premier.
- Une seule capture alimente les deux images : le découpage ne coûte rien de
  plus qu'aujourd'hui.

Le réglage **Caméras à double objectif** indique où se trouve l'objectif
fixe (en haut par défaut, ou en bas) ou désactive le découpage.

La vidéo en direct n'est pas disponible avec cette intégration (les
intégrations externes de Gladys échangent des images fixes, 12 par minute au
plus). Pour le direct, ajoutez aussi la caméra à l'intégration **Caméra
RTSP** de Gladys, avec
`rtsp://<adresse>:554/user=admin&password=<mot de passe>&channel=1&stream=0.sdp?real_stream`
(les deux objectifs dans une seule image).

## Presets

Un preset est une position enregistrée **dans la caméra**. Pour en créer un :

1. orientez la caméra dans la position voulue (widget, application iCSee) ;
2. lancez une scène avec l'action **Enregistrer un preset iCSee** et un
   numéro (1 à 255), ou enregistrez-le depuis l'application iCSee ;
3. ajoutez `numéro:nom` au champ **Presets** de la configuration, par
   exemple `1:Entrée`.

Les presets apparaissent alors sur la fonctionnalité PTZ de l'appareil, dans
le widget « Presets iCSee », et l'action de scène **Aller à un preset iCSee**
y oriente la caméra.

## Idées de scènes

- Quand l'alarme s'active, tourner toutes les caméras vers la porte (aller à
  un preset).
- Quand une caméra détecte une personne, envoyer son image sur Telegram
  (« Rafraîchir une image iCSee », puis l'action « Envoyer une image de
  caméra » de Gladys).
- Quand une caméra passe hors ligne la nuit, la redémarrer.

## Dépannage

- **« wrong password »** : vérifiez le mot de passe de l'appareil dans
  l'application iCSee ; le nom d'utilisateur est `admin`.
- **Caméra injoignable** : vérifiez l'adresse, que la caméra est alimentée
  et sur le même réseau, et que rien ne bloque le port TCP 34567.
- **Pas d'image** : certains firmwares n'ont pas de commande de capture ;
  l'intégration utilise alors le flux RTSP (port 554). Forcez « Flux RTSP »
  dans « Capture de l'image » si besoin.
- **Pas de détection** : activez l'alarme de détection dans l'application
  iCSee, et laissez « Détection de mouvement » cochée.
- Les logs de l'intégration sont dans **Paramètres → Système → Conteneurs**
  (ou `docker logs`).

Le code source, le suivi des problèmes et le journal des modifications sont
sur [GitHub](https://github.com/gboulvin/Gladys-ICSeePTZ).
