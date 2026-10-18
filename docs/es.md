# iCSee PTZ — guía de uso

Esta integración controla las cámaras motorizadas **iCSee** (vendidas también
con las marcas XMEye, Xiongmai, Jennov, Hiseeu, Floureon...) desde Gladys
Assistant, **en local**: Gladys se comunica con las cámaras de su red con su
protocolo nativo (DVRIP, puerto TCP 34567). Sin cuenta en la nube, sin
necesidad de internet.

## Qué obtiene

- **La imagen de la cámara** en Gladys: widget de cámara del panel, chat
  («muéstrame la cámara»), escenas («enviar una imagen de cámara»).
- **La orientación** (y el zoom en los modelos que lo tienen) desde el panel,
  las filas de dispositivos y las escenas. Cada movimiento se detiene solo:
  un «stop» perdido nunca deja la cámara girando.
- **Los presets**: un toque para orientar la cámara hacia una posición
  guardada.
- **La detección de movimiento y de personas**: un sensor de movimiento, y
  un disparador de escena que distingue un movimiento de una persona.
- **Dos widgets**: «Control PTZ iCSee» (imagen, estado, flechas) y «Presets
  iCSee».
- **Acciones de escena**: mover una cámara, ir a / guardar un preset,
  actualizar la imagen, reiniciar una cámara.
- **Disparadores de escena**: detección (movimiento / persona), cámara
  conectada / desconectada.

## Antes de empezar

1. Vincule cada cámara con la app **iCSee**, en la misma red que Gladys.
2. En su router, asigne a cada cámara una **dirección IP fija** (reserva
   DHCP). La integración también reconoce una cámara cuya dirección ha
   cambiado, pero una dirección fija evita cualquier corte.
3. Anote la **contraseña del dispositivo** definida en la app iCSee (vacía si
   nunca la definió). El usuario es `admin`.
4. Para recibir las detecciones, active la alarma de detección de movimiento
   / de personas de la cámara en la app iCSee.

## Configuración

Abra **Integraciones → iCSee PTZ → Configuración**:

| Campo                          | Qué introducir                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Direcciones de las cámaras     | Las direcciones IP, separadas por comas: `192.168.1.50, 192.168.1.51`. Añada `:puerto` si no es 34567. |
| Usuario                        | `admin`, salvo que haya creado otra cuenta.                                                            |
| Contraseña                     | La contraseña del dispositivo en la app iCSee. Vacía si no hay. Común a todas las cámaras.             |
| Actualización de la imagen (s) | Segundos entre dos imágenes enviadas a Gladys (60 por defecto, mínimo 5). `0` = solo bajo demanda.     |
| Captura de la imagen           | `Automático` usa la captura de la cámara, o el flujo RTSP si el firmware no la tiene.                  |
| Paso de movimiento (s)         | Cuánto gira la cámara con una orden de movimiento aislada (1 s por defecto).                           |
| Velocidad del motor (1-8)      | Velocidad de los motores PTZ.                                                                          |
| Zoom motorizado                | Márquelo solo si su modelo tiene zoom óptico.                                                          |
| Presets                        | Las posiciones guardadas en las cámaras, como `número:nombre`: `1:Entrada, 2:Jardín`.                  |
| Detección de movimiento        | Recibe las detecciones de las cámaras.                                                                 |

Guarde y use los botones:

- **Probar las cámaras** se conecta a cada dirección e indica cuáles
  responden (modelo y número de serie), o por qué no (contraseña incorrecta,
  inaccesible...).
- **Buscar en la red** enumera las cámaras iCSee de su red. Difunde la
  búsqueda iCSee y después prueba el puerto 34567 en cada dirección de la
  red: la que indique en «Red a analizar» (p. ej. `192.168.1.0/24`) o, por
  defecto, la red de las cámaras ya configuradas. Para su primera cámara,
  indique su red. La dirección también aparece en la app iCSee (Ajustes del
  dispositivo → Red) y en la lista de dispositivos de su router.
- **Reiniciar una cámara** reinicia la cámara elegida.

Después abra la pestaña **Detección** de la integración y añada sus cámaras.

## Mover la cámara

- **Panel**: añada el widget «Control PTZ iCSee» (o el dispositivo en un
  widget de habitación). Cada flecha gira la cámara durante el «Paso de
  movimiento».
- **Escenas**: la acción «Mover una cámara iCSee» recibe una dirección y una
  duración (5 s como máximo). La acción estándar «controlar un dispositivo»
  también funciona en la función PTZ (1 izquierda, 2 derecha, 3 arriba,
  4 abajo, 5 acercar, 6 alejar, 0 stop).

Venga de donde venga, un movimiento siempre se detiene solo como mucho a los
5 segundos.

## Presets

Un preset es una posición guardada **en la cámara**. Para crear uno:

1. oriente la cámara hacia la posición deseada (widget, app iCSee);
2. lance una escena con la acción **Guardar un preset iCSee** y un número
   (1 a 255), o guárdelo desde la app iCSee;
3. añada `número:nombre` al campo **Presets** de la configuración, por
   ejemplo `1:Entrada`.

Los presets aparecen entonces en la función PTZ del dispositivo, en el
widget «Presets iCSee», y la acción de escena **Ir a un preset iCSee**
orienta la cámara hacia ellos.

## Ideas de escenas

- Cuando se active la alarma, orientar todas las cámaras hacia la puerta (ir
  a un preset).
- Cuando una cámara detecte a una persona, enviar su imagen por Telegram
  («Actualizar una imagen iCSee», y después la acción «Enviar una imagen de
  cámara» de Gladys).
- Cuando una cámara se desconecte por la noche, reiniciarla.

## Solución de problemas

- **«wrong password»**: compruebe la contraseña del dispositivo en la app
  iCSee; el usuario es `admin`.
- **Cámara inaccesible**: compruebe la dirección, que la cámara esté
  alimentada y en la misma red, y que nada bloquee el puerto TCP 34567.
- **Sin imagen**: algunos firmwares no tienen orden de captura; la
  integración usa entonces el flujo RTSP (puerto 554). Fuerce «Flujo RTSP»
  en «Captura de la imagen» si hace falta.
- **Sin detección**: active la alarma de detección en la app iCSee y deje
  marcada «Detección de movimiento».
- Los registros de la integración están en **Ajustes → Sistema →
  Contenedores** (o `docker logs`).

El código fuente, el seguimiento de incidencias y el registro de cambios
están en [GitHub](https://github.com/gboulvin/Gladys-ICSeePTZ).
