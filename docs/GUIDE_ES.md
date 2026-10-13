# SCAN Rainbow Defense Toolkit v20 — Guía en español

## Descripción
SCAN es un conjunto de herramientas defensivas orientado a Windows y al procesamiento local. Ayuda a revisar el estado del equipo, archivos locales seleccionados, proyectos de código fuente, capturas de paquetes guardadas y disponibilidad de utilidades. Los informes se guardan localmente. Un resultado limpio no garantiza que un sistema sea seguro.

## Inicio rápido
1. Extrae el ZIP en una carpeta normal y ejecuta `SCAN.bat`.
2. Desplázate por la ventana de consentimiento y lee también los textos completos de las licencias incluidos al final.
3. Si aceptas, marca la casilla y pulsa `AGREE / 동의`; si no, pulsa `거부 / 종료`.
4. Selecciona solo las aplicaciones opcionales necesarias. `I` instala mediante WinGet, `D` solo descarga y `Q` cancela.
5. Introduce un número del menú. `p` página anterior, `d` siguiente, `r` actualiza el estado y `0` sale.

## Menú y conjuntos
Hay 60 acciones integradas y 16 aplicaciones opcionales. Los conjuntos de flujo de trabajo aparecen separados de las herramientas individuales. El conjunto 1 consulta metadatos públicos DNS/TLS/HTTP/RDAP sin iniciar sesión, rastrear páginas, enviar formularios, explotar vulnerabilidades ni seguir redirecciones. El conjunto 2 limita Nmap a un único host IPv4 local/privado autorizado. Los conjuntos 46, 47 y 48 cubren la línea base de Windows, la preparación de publicación del proyecto y el análisis estático de archivos. Las acciones 49–60 incluyen hashes duplicados, archivos grandes, validación JSON/XML/CSV, estimación heurística de entropía, certificados PEM, eventos de Windows, tareas programadas, nombres de archivos sensibles, subredes IPv4 y análisis de registros.

## Privacidad y uso autorizado
Los metadatos web pueden enviar el nombre de host introducido a servicios DNS, RDAP, TLS o HTTP. Los registros pueden contener nombres de usuario, rutas, dominios, direcciones IP, nombres de proyectos o metadatos de paquetes. No publiques `Logs` ni los informes. Analiza solo sistemas propios o con autorización explícita. SQLMap está limitado a aplicaciones de laboratorio locales iniciadas por ti en `localhost`, `127.0.0.1` o `::1`.

## Registros, licencia y exención
Los registros se recrean durante la ejecución. El ZIP no incluye registros antiguos ni archivos de historial innecesarios. El código de SCAN usa GNU GPL v3 o posterior; las herramientas de terceros conservan sus propias licencias. Consulta `LICENSE` y `LICENSES/`. El software se ofrece «tal cual», sin garantía de resultados completos o exactos. Haz copias de seguridad y revisa las acciones que puedan modificar el sistema.
