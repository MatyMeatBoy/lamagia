# Evaluación: modo opcional de colección MTGO

## Decisión

No se debe ofrecer ahora un botón de “iniciar sesión con MTGO”, ni exigir una cuenta MTGO para jugar ProsshTCG. MTGO no expone en este flujo una integración web OAuth pública que permita sincronizar desde Android o navegador.

El proyecto [MTGOSDK](https://github.com/videre-project/MTGOSDK) es una herramienta .NET para un cliente MTGO que ya está ejecutándose en Windows. Su propia documentación indica que inspecciona el proceso mediante ClrMD y que la colección se carga tras iniciar sesión en ese cliente. Es útil como **compañero local y opcional**, no como dependencia del juego.

## Opción segura posterior

Un instalable de Windows separado, con código visible y consentimiento explícito, puede:

1. Conectarse sólo a una instancia MTGO local ya iniciada por el usuario.
2. Exportar una instantánea de lectura de `nombre de impresión + cantidad + identificador MTGO`; sin contraseña, credenciales ni datos de partida.
3. Mostrar al usuario el resumen y pedir confirmación antes de subirlo a ProsshTCG.
4. Convertir cada impresión al `scryfall_id`/`oracle_id` local y marcar la colección como “verificada por importación local”.

No debe leer estados de partidas en vivo para influir decisiones, automatizar acciones, ni usar esa colección para afirmar compatibilidad legal con MTGO. La licencia/EULA y el riesgo de que el SDK dependa de memoria del proceso requieren revisión legal antes de distribuirlo.

## Diseño de producto

- **Modo ProsshTCG normal:** mazos disponibles según las reglas del producto; funciona en web, Android y escritorio.
- **Modo Colección MTGO (futuro, Windows):** un filtro voluntario al construir mazos que sólo permite cantidades importadas. La sala muestra la procedencia como información, no como autenticación de cuenta MTGO.
- La sincronización es una importación puntual manual al principio; jamás una conexión en segundo plano ni un requisito para jugar.
